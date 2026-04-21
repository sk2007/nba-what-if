# NBA What If — Python/Flask Backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Python/Flask API server that wraps `nba_api` to serve play-by-play data, game listings, and historical win-rate queries to the React frontend.

**Architecture:** Four Flask routes in `server/app.py`, backed by `nba_client.py` (nba_api wrappers + in-memory cache) and `win_probability.py` (logistic win prob formula). Runs on port 5001 with CORS enabled for the Vite dev server.

**Tech Stack:** Python 3, Flask, flask-cors, nba_api

---

## File Map

| File | Responsibility |
|------|----------------|
| `server/requirements.txt` | Python dependencies |
| `server/win_probability.py` | Logistic win prob formula |
| `server/nba_client.py` | nba_api wrappers + in-memory cache |
| `server/app.py` | Flask app, all route definitions |

---

## Task 1: Set up server directory and install dependencies

**Files:**
- Create: `server/requirements.txt`

- [ ] **Step 1: Create `server/requirements.txt`**

```
flask==3.0.3
flask-cors==4.0.1
nba_api==1.4.1
```

- [ ] **Step 2: Create and activate a virtual environment, install deps**

```bash
cd /Users/sampath/BSA-Basketball-S26
python3 -m venv server/.venv
source server/.venv/bin/activate
pip install -r server/requirements.txt
```

Expected: All packages install with no errors. `nba_api`, `flask`, and `flask_cors` importable.

- [ ] **Step 3: Verify imports work**

```bash
python3 -c "import flask; import flask_cors; import nba_api; print('OK')"
```

Expected output: `OK`

- [ ] **Step 4: Commit**

```bash
git add server/requirements.txt
git commit -m "feat: add Flask backend requirements"
```

---

## Task 2: Implement `win_probability.py`

**Files:**
- Create: `server/win_probability.py`
- Test: run inline via `python3 -c`

- [ ] **Step 1: Create `server/win_probability.py`**

```python
import math


def win_prob(score_diff, seconds_remaining, total_seconds=2880):
    """
    Returns win probability (0-100 integer) for the team with score_diff advantage.
    score_diff: teamA_score - teamB_score
    seconds_remaining: seconds left in game (0 = end)
    total_seconds: total regulation seconds (2880 = 48 min)
    """
    k = 0.004 * (1 + (total_seconds - seconds_remaining) / total_seconds)
    p = 1 / (1 + math.exp(-k * score_diff * 100))
    return round(p * 100)


def compute_wp_curve(plays):
    """
    Given a list of play dicts (each with gameSeconds, scoreA, scoreB),
    returns a list of { gameSeconds, wp } dicts — one per play plus a
    starting point at gameSeconds=0, wp=50.
    """
    curve = [{"gameSeconds": 0, "wp": 50}]
    total_seconds = _total_seconds_for_plays(plays)
    for play in plays:
        elapsed = play["gameSeconds"]
        remaining = max(0, total_seconds - elapsed)
        diff = play["scoreA"] - play["scoreB"]
        curve.append({
            "gameSeconds": elapsed,
            "wp": win_prob(diff, remaining, total_seconds),
        })
    return curve


def _total_seconds_for_plays(plays):
    """Regulation is 2880s; extend by 300s per OT period detected."""
    if not plays:
        return 2880
    max_quarter = max(p.get("quarter", 4) for p in plays)
    if max_quarter <= 4:
        return 2880
    return 2880 + (max_quarter - 4) * 300
```

- [ ] **Step 2: Verify formula produces expected values**

```bash
cd /Users/sampath/BSA-Basketball-S26
source server/.venv/bin/activate
python3 -c "
from server.win_probability import win_prob
# Tied at start → 50%
assert win_prob(0, 2880) == 50, f'Expected 50, got {win_prob(0, 2880)}'
# Up 10 with 1 second left → near 100%
assert win_prob(10, 1) > 95, f'Expected >95, got {win_prob(10, 1)}'
# Down 10 with 1 second left → near 0%
assert win_prob(-10, 1) < 5, f'Expected <5, got {win_prob(-10, 1)}'
# Up 5 at halftime → slightly above 50%
result = win_prob(5, 1440)
assert 50 < result < 70, f'Expected 50-70, got {result}'
print('All assertions passed')
"
```

Expected output: `All assertions passed`

- [ ] **Step 3: Commit**

```bash
git add server/win_probability.py
git commit -m "feat: add win probability formula"
```

---

## Task 3: Implement `nba_client.py`

**Files:**
- Create: `server/nba_client.py`

- [ ] **Step 1: Create `server/nba_client.py`**

```python
from nba_api.stats.endpoints import (
    LeagueGameFinder,
    PlayByPlayV2,
    BoxScoreTraditionalV2,
    TeamGameLog,
)
from nba_api.stats.static import teams as nba_teams
import time

_cache = {}


def _cached(key, fn):
    if key not in _cache:
        _cache[key] = fn()
    return _cache[key]


def _team_name_map():
    """Returns dict of teamId -> full team name."""
    return {t["id"]: t["full_name"] for t in nba_teams.get_teams()}


def get_games(season, season_type):
    """
    Returns list of game dicts: { gameId, teamA, teamB, date, finalScoreA, finalScoreB }
    teamA = home team, teamB = away team. Sorted by date descending.
    """
    key = f"games:{season}:{season_type}"
    return _cached(key, lambda: _fetch_games(season, season_type))


def _fetch_games(season, season_type):
    finder = LeagueGameFinder(
        season_nullable=season,
        season_type_nullable=season_type,
        league_id_nullable="00",
    )
    df = finder.get_data_frames()[0]

    # Each game appears twice (once per team). Pair by GAME_ID.
    seen = {}
    games = []
    for _, row in df.iterrows():
        gid = row["GAME_ID"]
        if gid not in seen:
            seen[gid] = row
        else:
            other = seen.pop(gid)
            # Determine home vs away from MATCHUP (e.g. "BOS vs. MIA" = home, "BOS @ MIA" = away)
            if "vs." in row["MATCHUP"]:
                home, away = row, other
            else:
                home, away = other, row
            games.append({
                "gameId": gid,
                "teamA": home["TEAM_NAME"],
                "teamB": away["TEAM_NAME"],
                "date": home["GAME_DATE"],
                "finalScoreA": int(home["PTS"]) if home["PTS"] else 0,
                "finalScoreB": int(away["PTS"]) if away["PTS"] else 0,
            })

    games.sort(key=lambda g: g["date"], reverse=True)
    return games


def get_play_by_play(game_id):
    """
    Returns dict: { gameId, teamA, teamB, plays, wpCurve }
    plays: list of play dicts (see spec)
    """
    key = f"pbp:{game_id}"
    return _cached(key, lambda: _fetch_play_by_play(game_id))


def _fetch_play_by_play(game_id):
    from server.win_probability import compute_wp_curve

    pbp = PlayByPlayV2(game_id=game_id)
    df = pbp.get_data_frames()[0]

    # Determine teamA/teamB from box score (home = teamA)
    box = BoxScoreTraditionalV2(game_id=game_id)
    team_df = box.get_data_frames()[1]  # team stats frame
    team_names = team_df["TEAM_NAME"].tolist()
    # Home team is listed second in BoxScoreTraditionalV2 team frame
    team_a = team_names[1] if len(team_names) >= 2 else team_names[0]
    team_b = team_names[0] if len(team_names) >= 2 else ""

    plays = []
    score_a = 0
    score_b = 0

    for _, row in df.iterrows():
        quarter = int(row["PERIOD"])
        clock_str = str(row["PCTIMESTRING"]) if row["PCTIMESTRING"] else "0:00"

        # Parse clock string "MM:SS" → seconds remaining in quarter
        parts = clock_str.split(":")
        clock_seconds = int(parts[0]) * 60 + int(parts[1]) if len(parts) == 2 else 0

        # Compute gameSeconds elapsed from tip-off
        quarter_start = (min(quarter, 5) - 1) * (5 * 60 if quarter > 4 else 12 * 60)
        quarter_duration = 5 * 60 if quarter > 4 else 12 * 60
        game_seconds = quarter_start + (quarter_duration - clock_seconds)

        # Parse score from SCORE column (e.g. "2 - 0")
        score_str = str(row.get("SCORE", "")) or ""
        if " - " in score_str:
            parts_score = score_str.split(" - ")
            try:
                score_a = int(parts_score[0])
                score_b = int(parts_score[1])
            except ValueError:
                pass

        description = str(row.get("HOMEDESCRIPTION") or row.get("VISITORDESCRIPTION") or row.get("NEUTRALDESCRIPTION") or "")
        team = str(row.get("PLAYER1_TEAM_NICKNAME") or "")
        player = str(row.get("PLAYER1_NAME") or "")
        event_type_id = int(row["EVENTMSGTYPE"]) if row["EVENTMSGTYPE"] else 0

        event_type, editable, shot_pts = _classify_event(event_type_id, description)

        # Resolve team abbreviation to full name
        team_full = team_a if team and team_a.endswith(team) else (team_b if team and team_b.endswith(team) else None)

        plays.append({
            "eventNum": int(row["EVENTNUM"]),
            "clock": clock_str,
            "quarter": quarter,
            "clockSeconds": clock_seconds,
            "gameSeconds": game_seconds,
            "description": description,
            "scoreA": score_a,
            "scoreB": score_b,
            "eventType": event_type,
            "editable": editable,
            "team": team_full,
            "player": player if player else None,
            **({"shotPts": shot_pts} if shot_pts is not None else {}),
        })

    wp_curve = compute_wp_curve(plays)

    return {
        "gameId": game_id,
        "teamA": team_a,
        "teamB": team_b,
        "plays": plays,
        "wpCurve": wp_curve,
    }


def _classify_event(event_type_id, description):
    """
    nba_api EVENTMSGTYPE codes:
    1=shot made, 2=shot missed, 3=free throw, 4=rebound, 5=turnover,
    6=foul, 7=violation, 8=substitution, 9=timeout, 10=jump ball, 12=period start/end
    Returns (event_type_str, editable, shot_pts_or_None)
    """
    desc_lower = description.lower()
    if event_type_id in (1, 2):
        editable = True
        if "3pt" in desc_lower or "3-pt" in desc_lower or "three" in desc_lower:
            pts = 3
        elif event_type_id == 1:
            pts = 2
        else:
            pts = 0
        return "shot", editable, (pts if event_type_id == 1 else 0)
    if event_type_id == 3:
        made = "made" in desc_lower
        return "free_throw", True, (1 if made else 0)
    if event_type_id == 4:
        return "rebound", False, None
    if event_type_id == 5:
        return "turnover", False, None
    if event_type_id == 6:
        return "foul", False, None
    if event_type_id == 9:
        return "timeout", False, None
    if event_type_id == 8:
        return "substitution", False, None
    if event_type_id == 10:
        return "jump_ball", False, None
    return "other", False, None


def get_win_prob_stats(season, season_type, thresholds):
    """
    Returns { gamesMatched, wins, winRate, season, seasonType }.
    thresholds: dict with keys threePointPct, fgPct, turnovers, rebounds, ftPct (all ints).
    Uses TeamGameLog to get all team-game rows for the season, then filters.
    """
    key = f"teamlog:{season}:{season_type}"
    rows = _cached(key, lambda: _fetch_team_game_log(season, season_type))
    return _filter_and_count(rows, thresholds, season, season_type)


def _fetch_team_game_log(season, season_type):
    # TeamGameLog requires a specific team; use LeagueGameLog instead via LeagueGameFinder
    # We fetch games and collect all team rows using BoxScore would be too slow.
    # Use nba_api's LeagueGameLog (available as LeagueGameLog endpoint).
    from nba_api.stats.endpoints import LeagueGameLog
    log = LeagueGameLog(
        season=season,
        season_type_all_star=season_type,
        league_id="00",
    )
    df = log.get_data_frames()[0]
    rows = []
    for _, row in df.iterrows():
        rows.append({
            "WL": str(row.get("WL", "")),
            "FG_PCT": float(row["FG_PCT"]) if row["FG_PCT"] else 0.0,
            "FG3_PCT": float(row["FG3_PCT"]) if row["FG3_PCT"] else 0.0,
            "FT_PCT": float(row["FT_PCT"]) if row["FT_PCT"] else 0.0,
            "REB": int(row["REB"]) if row["REB"] else 0,
            "TOV": int(row["TOV"]) if row["TOV"] else 0,
        })
    return rows


def _filter_and_count(rows, thresholds, season, season_type):
    three_pct = thresholds.get("threePointPct", 0) / 100
    fg_pct = thresholds.get("fgPct", 0) / 100
    max_tov = thresholds.get("turnovers", 999)
    min_reb = thresholds.get("rebounds", 0)
    ft_pct = thresholds.get("ftPct", 0) / 100

    matched = [
        r for r in rows
        if r["FG3_PCT"] >= three_pct
        and r["FG_PCT"] >= fg_pct
        and r["TOV"] <= max_tov
        and r["REB"] >= min_reb
        and r["FT_PCT"] >= ft_pct
    ]

    wins = sum(1 for r in matched if r["WL"] == "W")
    games_matched = len(matched)
    win_rate = round(wins / games_matched * 100, 1) if games_matched > 0 else None

    return {
        "gamesMatched": games_matched,
        "wins": wins,
        "winRate": win_rate,
        "season": season,
        "seasonType": season_type,
    }
```

- [ ] **Step 2: Verify the module imports without error**

```bash
cd /Users/sampath/BSA-Basketball-S26
source server/.venv/bin/activate
python3 -c "from server.nba_client import get_games, get_play_by_play, get_win_prob_stats; print('imports OK')"
```

Expected output: `imports OK`

- [ ] **Step 3: Commit**

```bash
git add server/nba_client.py
git commit -m "feat: add nba_api client with caching"
```

---

## Task 4: Implement `app.py` (Flask routes)

**Files:**
- Create: `server/app.py`
- Create: `server/__init__.py`

- [ ] **Step 1: Create `server/__init__.py`** (empty, makes `server` a package)

```bash
touch /Users/sampath/BSA-Basketball-S26/server/__init__.py
```

- [ ] **Step 2: Create `server/app.py`**

```python
from flask import Flask, jsonify, request
from flask_cors import CORS
from server.nba_client import get_games, get_play_by_play, get_win_prob_stats

app = Flask(__name__)
CORS(app, origins=["http://localhost:5173"])

SEASONS = [
    f"{y}-{str(y+1)[-2:]}" for y in range(2024, 2013, -1)
]  # ["2024-25", "2023-24", ..., "2014-15"]


@app.get("/api/seasons")
def seasons():
    return jsonify({
        "seasons": [{"id": s, "label": s} for s in SEASONS],
        "seasonTypes": ["Regular Season", "Playoffs"],
    })


@app.get("/api/games")
def games():
    season = request.args.get("season")
    season_type = request.args.get("season_type")
    if not season or not season_type:
        return jsonify({"error": "season and season_type are required"}), 400
    try:
        return jsonify({"games": get_games(season, season_type)})
    except Exception as e:
        return jsonify({"error": str(e)}), 503


@app.get("/api/games/<game_id>/playbyplay")
def play_by_play(game_id):
    try:
        return jsonify(get_play_by_play(game_id))
    except Exception as e:
        return jsonify({"error": str(e)}), 503


@app.get("/api/games/<game_id>/boxscore")
def boxscore(game_id):
    from nba_api.stats.endpoints import BoxScoreTraditionalV2
    try:
        box = BoxScoreTraditionalV2(game_id=game_id)
        team_df = box.get_data_frames()[1]
        rows = team_df.to_dict(orient="records")
        if len(rows) < 2:
            return jsonify({"error": "Could not parse box score"}), 503
        def extract(row):
            return {
                "teamName": row["TEAM_NAME"],
                "FG_PCT": round(float(row["FG_PCT"] or 0), 3),
                "FG3_PCT": round(float(row["FG3_PCT"] or 0), 3),
                "FT_PCT": round(float(row["FT_PCT"] or 0), 3),
                "REB": int(row["REB"] or 0),
                "TOV": int(row["TOV"] or 0),
            }
        return jsonify({
            "gameId": game_id,
            "teamA": extract(rows[1]),
            "teamB": extract(rows[0]),
        })
    except Exception as e:
        return jsonify({"error": str(e)}), 503


@app.get("/api/stats/winprob")
def win_prob_stats():
    season = request.args.get("season")
    season_type = request.args.get("season_type")
    if not season or not season_type:
        return jsonify({"error": "season and season_type are required"}), 400
    thresholds = {
        "threePointPct": _int_param("threePointPct", 0),
        "fgPct": _int_param("fgPct", 0),
        "turnovers": _int_param("turnovers", 999),
        "rebounds": _int_param("rebounds", 0),
        "ftPct": _int_param("ftPct", 0),
    }
    try:
        return jsonify(get_win_prob_stats(season, season_type, thresholds))
    except Exception as e:
        return jsonify({"error": str(e)}), 503


def _int_param(name, default):
    val = request.args.get(name)
    try:
        return int(val) if val is not None else default
    except ValueError:
        return default


if __name__ == "__main__":
    app.run(port=5001, debug=True)
```

- [ ] **Step 3: Start the server and verify `/api/seasons` responds**

```bash
cd /Users/sampath/BSA-Basketball-S26
source server/.venv/bin/activate
python3 -m server.app &
sleep 2
curl -s http://localhost:5001/api/seasons | python3 -m json.tool | head -20
```

Expected: JSON with `seasons` array containing `2024-25` through `2014-15` and `seasonTypes` list.

Kill the server after verifying: `kill %1`

- [ ] **Step 4: Commit**

```bash
git add server/__init__.py server/app.py
git commit -m "feat: add Flask API routes for seasons, games, play-by-play, and stat model"
```

---

## Task 5: Smoke-test live nba_api calls

**Files:** No new files — integration test only.

- [ ] **Step 1: Start the server**

```bash
cd /Users/sampath/BSA-Basketball-S26
source server/.venv/bin/activate
python3 -m server.app &
sleep 2
```

- [ ] **Step 2: Test `/api/games` with 2024-25 Playoffs**

```bash
curl -s "http://localhost:5001/api/games?season=2024-25&season_type=Playoffs" | python3 -c "
import json, sys
data = json.load(sys.stdin)
games = data.get('games', [])
print(f'Games returned: {len(games)}')
if games:
    g = games[0]
    print(f'First game: {g[\"teamA\"]} vs {g[\"teamB\"]} on {g[\"date\"]} ({g[\"finalScoreA\"]}-{g[\"finalScoreB\"]})')
"
```

Expected: At least 1 game returned, with team names, date, and scores.

- [ ] **Step 3: Test `/api/games/:gameId/playbyplay` with the first game ID from step 2**

```bash
# Replace GAME_ID with the actual ID from step 2
GAME_ID=$(curl -s "http://localhost:5001/api/games?season=2024-25&season_type=Playoffs" | python3 -c "import json,sys; print(json.load(sys.stdin)['games'][0]['gameId'])")
curl -s "http://localhost:5001/api/games/$GAME_ID/playbyplay" | python3 -c "
import json, sys
data = json.load(sys.stdin)
if 'error' in data:
    print('ERROR:', data['error'])
    sys.exit(1)
plays = data.get('plays', [])
curve = data.get('wpCurve', [])
print(f'Plays: {len(plays)}, WP curve points: {len(curve)}')
print(f'TeamA: {data[\"teamA\"]}, TeamB: {data[\"teamB\"]}')
# Show first editable play
editable = [p for p in plays if p['editable']]
if editable:
    print(f'First editable: {editable[0][\"description\"]}')
"
```

Expected: Hundreds of plays, WP curve points, teamA/teamB names, at least one editable play.

- [ ] **Step 4: Test `/api/stats/winprob`**

```bash
curl -s "http://localhost:5001/api/stats/winprob?season=2024-25&season_type=Regular+Season&threePointPct=35&fgPct=45&turnovers=14&rebounds=40&ftPct=75" | python3 -m json.tool
```

Expected: JSON with `gamesMatched > 0`, `winRate` between 0 and 100.

- [ ] **Step 5: Kill the server**

```bash
kill %1
```

---

## Task 6: Add a README for running the server

**Files:**
- Create: `server/README.md`

- [ ] **Step 1: Create `server/README.md`**

```markdown
# NBA What If — Backend Server

Python/Flask API wrapping nba_api.

## Setup

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

## Run

```bash
# From the project root
source server/.venv/bin/activate
python3 -m server.app
```

Server starts on http://localhost:5001.

## Endpoints

- `GET /api/seasons` — available seasons and season types
- `GET /api/games?season=2024-25&season_type=Playoffs` — games for a season
- `GET /api/games/:gameId/playbyplay` — play-by-play + win prob curve
- `GET /api/games/:gameId/boxscore` — box score stats
- `GET /api/stats/winprob?season=...&threePointPct=35&fgPct=45&turnovers=14&rebounds=40&ftPct=75` — historical win rate

## Notes

- nba_api responses are cached in memory for the process lifetime. Restart to clear.
- nba_api rate-limits requests. If you get 503 errors, wait a few seconds and retry.
```

- [ ] **Step 2: Commit**

```bash
git add server/README.md
git commit -m "docs: add server README with setup and run instructions"
```
