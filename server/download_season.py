"""Download a completed season's NBA-derived play archive for offline app use.

Run from the project root after installing the download-only dependency pyarrow:
    python3 -m server.download_season --season 2025-26
    python3 -m server.seed_betting_lines --season 2025-26

Runtime reads compressed SQLite using Python's standard library; pyarrow is not
needed by Flask or Vercel. nba_api remains the client for live/uncached games.
"""
import argparse
from collections import defaultdict
from contextlib import closing
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import re
import sqlite3
import tempfile
import zlib

import requests

from server.nba_client import _CACHE_DIR, _classify_cdn_event

SOURCE = "https://github.com/ramirobentes/nba_data"
BASE = f"{SOURCE}/releases/download/pbp"
COLUMNS = [
    "game_id", "game_date", "team_home", "team_away", "team_abb",
    "event_num", "number_event", "period", "clock", "description",
    "hs", "vs", "action_type", "sub_type", "shot_result", "player1_name",
]


def normalize_game(rows, team_names):
    rows = sorted(rows, key=lambda row: row["number_event"])
    meta = rows[-1]
    if not any(row["action_type"] == "game" and row["sub_type"] == "end" for row in rows):
        raise ValueError(f"Incomplete game: {meta['game_id']}")
    home, away = team_names[meta["team_home"]], team_names[meta["team_away"]]
    plays = []
    for row in rows:
        quarter = int(row["period"])
        minutes, seconds = row["clock"].split(":", 1)
        remaining = int(int(minutes) * 60 + float(seconds))
        duration = 720 if quarter <= 4 else 300
        if not 0 <= remaining <= duration:
            raise ValueError(f"Invalid clock in {meta['game_id']}")
        start = (quarter - 1) * 720 if quarter <= 4 else 2880 + (quarter - 5) * 300
        event_type, editable, points, shot_type = _classify_cdn_event({
            "actionType": row["action_type"], "shotResult": row["shot_result"],
        })
        if row["action_type"] == "ejection":
            event_type = "ejection"
        play = {
            # The archive adds period-end events with repeated source ID 9999.
            # Assign unique stable IDs so editing one event cannot edit another.
            "eventNum": len(plays) + 1,
            "sourceEventNum": int(row["event_num"]),
            "quarter": quarter,
            "clock": f"{remaining // 60}:{remaining % 60:02d}",
            "clockSeconds": remaining,
            "gameSeconds": start + duration - remaining,
            "description": row["description"] or "",
            "scoreA": int(row["hs"]), "scoreB": int(row["vs"]),
            "eventType": event_type, "editable": editable,
            "team": team_names.get(row["team_abb"]),
            "player": re.sub(r"^\d+\s+", "", row["player1_name"]) if row["player1_name"] else None,
        }
        if points is not None:
            play["shotPts"] = points
        if shot_type:
            play["addedEventType"] = shot_type
        plays.append(play)
    if any(a["gameSeconds"] > b["gameSeconds"] for a, b in zip(plays, plays[1:])):
        raise ValueError(f"Plays out of chronological order: {meta['game_id']}")
    game = {
        "gameId": meta["game_id"], "teamA": home, "teamB": away,
        "date": meta["game_date"].isoformat(), "plays": plays,
        "status": "finished", "bettingLine": 0,
        "dataSource": "NBA-derived archive: ramirobentes/nba_data",
    }
    listing = {
        "gameId": game["gameId"], "teamA": home, "teamB": away, "date": game["date"],
        "finalScoreA": plays[-1]["scoreA"], "finalScoreB": plays[-1]["scoreB"],
    }
    return game, listing


def download_season(season, output_dir=_CACHE_DIR, input_dir=None):
    import pyarrow.parquet as pq
    from nba_api.stats.static import teams

    if not re.fullmatch(r"20\d{2}-\d{2}", season):
        raise ValueError("Use a season such as 2025-26")
    year = int(season[:4])
    if season != f"{year}-{str(year + 1)[-2:]}":
        raise ValueError("Season end year must follow its start year")
    names = {team["abbreviation"]: team["full_name"] for team in teams.get_teams()}
    output_dir = Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    database = output_dir / f"pbp_{season}.sqlite3"
    staged = database.with_suffix(".sqlite3.tmp")
    staged.unlink(missing_ok=True)
    lists, sources, counts = {}, [], {}
    try:
        with tempfile.TemporaryDirectory(prefix="nba-season-") as workdir, closing(sqlite3.connect(staged)) as connection:
            connection.execute("CREATE TABLE games (game_id TEXT PRIMARY KEY, payload BLOB NOT NULL)")
            connection.execute("CREATE TABLE metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL)")
            for kind, label, prefix in [("regular", "Regular Season", "002"), ("playoffs", "Playoffs", "004")]:
                url = f"{BASE}/pbp_{kind}_{year + 1}.parquet"
                if input_dir:
                    path = Path(input_dir) / f"{kind}.parquet"
                else:
                    print(f"Downloading {url}", flush=True)
                    response = requests.get(url, timeout=120)
                    response.raise_for_status()
                    path = Path(workdir) / f"{kind}.parquet"
                    path.write_bytes(response.content)
                sources.append({"url": url, "sha256": hashlib.sha256(path.read_bytes()).hexdigest()})
                grouped = defaultdict(list)
                for row in pq.read_table(path, columns=COLUMNS).to_pylist():
                    if not re.fullmatch(prefix + str(year)[-2:] + r"\d{5}", row["game_id"]):
                        raise ValueError(f"Wrong season or competition: {row['game_id']}")
                    grouped[row["game_id"]].append(row)
                listing, play_count = [], 0
                for rows in grouped.values():
                    game, item = normalize_game(rows, names)
                    payload = json.dumps(game, separators=(",", ":"), allow_nan=False).encode()
                    connection.execute("INSERT INTO games VALUES (?, ?)", (game["gameId"], zlib.compress(payload, 9)))
                    listing.append(item)
                    play_count += len(game["plays"])
                listing.sort(key=lambda game: (game["date"], game["gameId"]), reverse=True)
                lists[label] = listing
                counts[label] = {"games": len(listing), "plays": play_count}
                print(f"  {label}: {len(listing):,} games, {play_count:,} plays", flush=True)
            metadata = {"season": season, "source": SOURCE, "files": sources, "counts": counts,
                        "downloadedAt": datetime.now(timezone.utc).isoformat(),
                        "bettingLine": "Not supplied by the archive; neutral 0 used"}
            connection.execute("INSERT INTO metadata VALUES (?, ?)", ("provenance", json.dumps(metadata)))
            connection.commit()
        staged.replace(database)
        for label, listing in lists.items():
            path = output_dir / f"games_{season}_{label.replace(' ', '_')}.json"
            temporary = path.with_suffix(".json.tmp")
            temporary.write_text(json.dumps(listing), encoding="utf-8")
            temporary.replace(path)
        print(f"Saved {database} ({database.stat().st_size / 1024 / 1024:.1f} MiB)", flush=True)
        return counts
    finally:
        staged.unlink(missing_ok=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--season", default="2025-26")
    parser.add_argument("--input-dir", type=Path, help="Reuse downloaded regular.parquet/playoffs.parquet")
    args = parser.parse_args()
    download_season(args.season, input_dir=args.input_dir)
