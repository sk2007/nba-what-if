import json
from pathlib import Path
import re
import requests
from html import unescape
from html.parser import HTMLParser

_CDN_HEADERS = {"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15"}
_NBA_LIVE_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Accept": "application/json,text/plain,*/*",
    "Accept-Language": "en-US,en;q=0.9",
    "Referer": "https://www.nba.com/",
    "Origin": "https://www.nba.com",
}

_cache = {}
_CACHE_DIR = Path(__file__).resolve().parent / "cache"
MIN_SELECTABLE_SEASON_START = 2020
_GAME_STATUS = {1: "upcoming", 2: "live", 3: "finished"}


def _cached(key, fn):
    if key not in _cache:
        _cache[key] = fn()
    return _cache[key]


# Season string "2024-25" -> start year 2024
def _season_year(season):
    return int(season.split("-")[0])


def get_available_seasons():
    seasons = set()
    for path in _CACHE_DIR.glob("games_*_Regular_Season.json"):
        name = path.stem
        prefix = "games_"
        suffix = "_Regular_Season"
        if name.startswith(prefix) and name.endswith(suffix):
            season = name[len(prefix):-len(suffix)]
            if _season_year(season) >= MIN_SELECTABLE_SEASON_START:
                seasons.add(season)
    return sorted(seasons, reverse=True)


def is_selectable_season(season):
    return _season_year(season) >= MIN_SELECTABLE_SEASON_START


# Playoff game IDs start with "0042", regular season with "0022"
_SEASON_TYPE_PREFIX = {"Regular Season": "0022", "Playoffs": "0042"}

_TEAM_ABBREV = {
    "Atlanta Hawks": "ATL",
    "Boston Celtics": "BOS",
    "Brooklyn Nets": "BRK",
    "Charlotte Hornets": "CHO",
    "Chicago Bulls": "CHI",
    "Cleveland Cavaliers": "CLE",
    "Dallas Mavericks": "DAL",
    "Denver Nuggets": "DEN",
    "Detroit Pistons": "DET",
    "Golden State Warriors": "GSW",
    "Houston Rockets": "HOU",
    "Indiana Pacers": "IND",
    "LA Clippers": "LAC",
    "Los Angeles Clippers": "LAC",
    "Los Angeles Lakers": "LAL",
    "Memphis Grizzlies": "MEM",
    "Miami Heat": "MIA",
    "Milwaukee Bucks": "MIL",
    "Minnesota Timberwolves": "MIN",
    "New Orleans Pelicans": "NOP",
    "New Orleans Hornets": "NOH",
    "New York Knicks": "NYK",
    "Oklahoma City Thunder": "OKC",
    "Orlando Magic": "ORL",
    "Philadelphia 76ers": "PHI",
    "Phoenix Suns": "PHO",
    "Portland Trail Blazers": "POR",
    "Sacramento Kings": "SAC",
    "San Antonio Spurs": "SAS",
    "Toronto Raptors": "TOR",
    "Utah Jazz": "UTA",
    "Washington Wizards": "WAS",
}


def get_games(season, season_type):
    """
    Returns list of game dicts: { gameId, teamA, teamB, date, finalScoreA, finalScoreB }
    teamA = home team, teamB = away team. Sorted by date descending.
    """
    key = f"games:{season}:{season_type}"
    return _cached(key, lambda: _fetch_games(season, season_type))


def _fetch_games(season, season_type):
    cached_games = _read_cached_games(season, season_type)
    if cached_games is not None:
        return cached_games

    year = _season_year(season)
    url = f"https://data.nba.com/data/v2015/json/mobile_teams/nba/{year}/league/00_full_schedule.json"
    r = requests.get(url, headers=_CDN_HEADERS, timeout=15)
    r.raise_for_status()
    data = r.json()

    prefix = _SEASON_TYPE_PREFIX.get(season_type, "002")
    games = []
    for month in data["lscd"]:
        for g in month["mscd"]["g"]:
            if not g["gid"].startswith(prefix):
                continue
            # Only include completed games (st="3" means final)
            if str(g.get("st")) != "3":
                continue
            home = g["h"]
            away = g["v"]
            games.append({
                "gameId": g["gid"],
                "teamA": f"{home['tc']} {home['tn']}",
                "teamB": f"{away['tc']} {away['tn']}",
                "date": g["gdte"],
                "finalScoreA": int(home["s"]) if home.get("s") else 0,
                "finalScoreB": int(away["s"]) if away.get("s") else 0,
            })

    games.sort(key=lambda g: g["date"], reverse=True)
    return games


def _read_cached_games(season, season_type):
    cache_name = f"games_{season}_{season_type.replace(' ', '_')}.json"
    cache_path = _CACHE_DIR / cache_name
    if not cache_path.exists():
        return None
    with cache_path.open("r", encoding="utf-8") as f:
        return json.load(f)


def get_play_by_play(game_id, live=False):
    """
    Returns dict: { gameId, teamA, teamB, bettingLine, plays, wpCurve, status }
    When live=True, bypass the in-memory cache (always re-fetch).
    """
    if live:
        return _fetch_play_by_play(game_id)
    key = f"pbp:{game_id}"
    return _cached(key, lambda: _fetch_play_by_play(game_id))


def _parse_cdn_clock(clock_str, quarter):
    """
    Parse ISO 8601 duration e.g. 'PT11M44.00S' → (clock_display, clock_seconds, game_seconds).
    clock_seconds = seconds remaining in the quarter.
    game_seconds = elapsed seconds from tip-off.
    """
    m = re.match(r"PT(\d+)M([\d.]+)S", clock_str or "PT0M0.00S")
    if m:
        mins = int(m.group(1))
        secs = float(m.group(2))
        clock_seconds = int(mins * 60 + secs)
    else:
        clock_seconds = 0

    display = f"{clock_seconds // 60}:{clock_seconds % 60:02d}"

    if quarter <= 4:
        quarter_start = (quarter - 1) * 720
        quarter_duration = 720
    else:
        quarter_start = 2880 + (quarter - 5) * 300
        quarter_duration = 300

    game_seconds = quarter_start + (quarter_duration - clock_seconds)
    return display, clock_seconds, game_seconds


def _raw_pbp(game_id):
    from nba_api.live.nba.endpoints import playbyplay
    return playbyplay.PlayByPlay(
        game_id=game_id,
        headers=_NBA_LIVE_HEADERS,
        timeout=15,
    ).nba_response.get_dict()


def _raw_box(game_id):
    from nba_api.live.nba.endpoints import boxscore
    return boxscore.BoxScore(
        game_id=game_id,
        headers=_NBA_LIVE_HEADERS,
        timeout=15,
    ).nba_response.get_dict()


def _build_game(game_id):
    """Fetch live PBP + boxscore and build the game dict.
    Returns (game_dict, status) where status is upcoming|live|finished."""
    from server.betting_lines import get_pregame_line
    from server.wp_mlp import compute_wp_curve

    pbp_data = _raw_pbp(game_id)
    game_node = pbp_data["game"]
    status = _GAME_STATUS.get(game_node.get("gameStatus", 3), "finished")
    actions = game_node["actions"]

    box_game = _raw_box(game_id)["game"]
    home = box_game["homeTeam"]
    away = box_game["awayTeam"]
    team_a = f"{home['teamCity']} {home['teamName']}"
    team_b = f"{away['teamCity']} {away['teamName']}"
    home_id = home["teamId"]
    game_date = (
        box_game.get("gameTimeUTC")
        or box_game.get("gameEt")
        or box_game.get("gameDate")
        or ""
    )[:10]
    betting_line = get_pregame_line(team_a, team_b, game_date)

    name_map = {}
    for p in home.get("players", []) + away.get("players", []):
        name_i = p.get("nameI", "")
        full = p.get("name", "") or f"{p.get('firstName', '')} {p.get('familyName', '')}".strip()
        if name_i and full:
            name_map[name_i] = full

    plays = []
    score_a = 0
    score_b = 0
    for action in actions:
        quarter = action.get("period", 0)
        if not quarter:
            continue
        clock_display, clock_seconds, game_seconds = _parse_cdn_clock(action.get("clock", ""), quarter)
        score_str_a = action.get("scoreHome", "")
        score_str_b = action.get("scoreAway", "")
        if score_str_a:
            try:
                score_a = int(score_str_a)
                score_b = int(score_str_b)
            except ValueError:
                pass
        event_type, editable, shot_pts, added_event_type = _classify_cdn_event(action)
        team_id = action.get("teamId")
        team_full = team_a if team_id == home_id else (team_b if team_id else None)
        name_i = action.get("playerNameI") or None
        player = name_map.get(name_i, name_i) if name_i else None
        play = {
            "eventNum": action.get("actionNumber", 0),
            "clock": clock_display,
            "quarter": quarter,
            "clockSeconds": clock_seconds,
            "gameSeconds": game_seconds,
            "description": action.get("description", ""),
            "scoreA": score_a,
            "scoreB": score_b,
            "eventType": event_type,
            "editable": editable,
            "team": team_full,
            "player": player,
        }
        if shot_pts is not None:
            play["shotPts"] = shot_pts
        if added_event_type:
            play["addedEventType"] = added_event_type
        plays.append(play)

    wp_curve = compute_wp_curve(plays, team_a, line=betting_line)
    game = {
        "gameId": game_id,
        "teamA": team_a,
        "teamB": team_b,
        "bettingLine": betting_line,
        "plays": plays,
        "wpCurve": wp_curve,
        "status": status,
    }
    return game, status


def _fetch_play_by_play(game_id):
    # Archived games in the bundled cache are completed games. Prefer the
    # Basketball-Reference page in that case so serverless deployments do not
    # wait on NBA live endpoints that often return blocked or empty responses.
    cached_game = _find_cached_game(game_id)
    if cached_game is not None:
        fallback = _build_bbr_game(game_id, cached_game)
        if fallback is not None:
            return fallback

    try:
        game, _ = _build_game(game_id)
        return game
    except Exception as nba_error:
        fallback = _build_bbr_game(game_id, cached_game)
        if fallback is not None:
            return fallback
        raise RuntimeError(
            "Could not fetch play-by-play from NBA live data or Basketball-Reference fallback"
        ) from nba_error


def get_game_status(game_id):
    """Return upcoming|live|finished from the live PBP payload only (no box fetch)."""
    status_code = _raw_pbp(game_id)["game"].get("gameStatus", 3)
    return _GAME_STATUS.get(status_code, "finished")


def _classify_cdn_event(action):
    """
    CDN actionType values: '2pt', '3pt', 'freethrow', 'rebound', 'turnover',
    'foul', 'timeout', 'substitution', 'jumpball', 'period', 'violation', etc.
    Returns (event_type_str, editable, shot_pts_or_None, added_event_type_or_None)
    """
    action_type = action.get("actionType", "")
    shot_result = action.get("shotResult", "")
    made = shot_result == "Made"

    if action_type in ("2pt", "3pt"):
        pts = (3 if action_type == "3pt" else 2) if made else 0
        return "shot", True, pts, ("shot_3pt" if action_type == "3pt" else "shot_2pt")
    if action_type == "freethrow":
        return "free_throw", True, (1 if made else 0), "free_throw"
    if action_type == "rebound":
        return "rebound", False, None, None
    if action_type == "turnover":
        return "turnover", False, None, None
    if action_type == "foul":
        return "foul", False, None, None
    if action_type == "timeout":
        return "timeout", False, None, None
    if action_type == "substitution":
        return "substitution", False, None, None
    if action_type == "jumpball":
        return "jump_ball", False, None, None
    return "other", False, None, None


class _BBRPBPParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.rows = []
        self._in_pbp = False
        self._in_row = False
        self._in_cell = False
        self._current_row = None
        self._current_cell = None
        self._quarter = 1

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == "table" and attrs.get("id") == "pbp":
            self._in_pbp = True
            return
        if not self._in_pbp:
            return
        if tag == "tr":
            row_id = attrs.get("id", "")
            if row_id.startswith("q") and row_id[1:].isdigit():
                self._quarter = int(row_id[1:])
            self._in_row = True
            self._current_row = {"quarter": self._quarter, "cells": []}
        elif tag in ("td", "th") and self._in_row:
            self._in_cell = True
            self._current_cell = []

    def handle_endtag(self, tag):
        if not self._in_pbp:
            return
        if tag in ("td", "th") and self._in_cell:
            text = unescape("".join(self._current_cell)).replace("\xa0", " ")
            self._current_row["cells"].append(" ".join(text.split()))
            self._in_cell = False
            self._current_cell = None
        elif tag == "tr" and self._in_row:
            cells = self._current_row["cells"]
            if cells and cells[0] != "Time" and not cells[0].endswith("Q"):
                self.rows.append(self._current_row)
            self._in_row = False
            self._current_row = None
        elif tag == "table":
            self._in_pbp = False

    def handle_data(self, data):
        if self._in_cell and self._current_cell is not None:
            self._current_cell.append(data)


def _build_bbr_game(game_id, meta=None):
    meta = meta or _find_cached_game(game_id)
    if meta is None:
        return None

    home_abbrev = _TEAM_ABBREV.get(meta["teamA"])
    if not home_abbrev:
        return None

    date_part = meta["date"].replace("-", "")
    url = f"https://www.basketball-reference.com/boxscores/pbp/{date_part}0{home_abbrev}.html"
    response = requests.get(url, headers=_CDN_HEADERS, timeout=20)
    response.raise_for_status()

    parser = _BBRPBPParser()
    parser.feed(response.text)
    plays = _parse_bbr_rows(parser.rows, meta["teamA"], meta["teamB"])
    if not plays:
        return None

    try:
        from server.betting_lines import get_pregame_line
        betting_line = get_pregame_line(meta["teamA"], meta["teamB"], meta.get("date"))
    except Exception:
        betting_line = 0

    from server.wp_mlp import compute_wp_curve

    return {
        "gameId": game_id,
        "teamA": meta["teamA"],
        "teamB": meta["teamB"],
        "bettingLine": betting_line,
        "plays": plays,
        "wpCurve": compute_wp_curve(plays, meta["teamA"], line=betting_line),
        "status": "finished",
    }


def _find_cached_game(game_id):
    for path in _CACHE_DIR.glob("games_*.json"):
        with path.open("r", encoding="utf-8") as f:
            games = json.load(f)
        for game in games:
            if game.get("gameId") == game_id:
                return game
    return None


def _parse_bbr_rows(rows, home_team, away_team):
    plays = []
    score_a = 0
    score_b = 0
    event_num = 1

    for row in rows:
        cells = row["cells"]
        if not cells or not _is_bbr_clock(cells[0]):
            continue

        quarter = row["quarter"]
        clock_display, clock_seconds, game_seconds = _parse_bbr_clock(cells[0], quarter)
        away_desc = ""
        home_desc = ""
        score = ""

        if len(cells) >= 6:
            away_desc = cells[1]
            score = cells[3]
            home_desc = cells[5]
        elif len(cells) >= 2:
            away_desc = cells[1]

        if score and re.match(r"^\d+-\d+$", score):
            away_score, home_score = score.split("-", 1)
            score_b = int(away_score)
            score_a = int(home_score)

        desc = home_desc or away_desc
        if not desc:
            continue

        team = home_team if home_desc else (away_team if away_desc else None)
        event_type, editable, shot_pts, added_event_type = _classify_bbr_event(desc)
        play = {
            "eventNum": event_num,
            "clock": clock_display,
            "quarter": quarter,
            "clockSeconds": clock_seconds,
            "gameSeconds": game_seconds,
            "description": desc,
            "scoreA": score_a,
            "scoreB": score_b,
            "eventType": event_type,
            "editable": editable,
            "team": team,
            "player": _extract_bbr_player(desc),
        }
        if shot_pts is not None:
            play["shotPts"] = shot_pts
        if added_event_type:
            play["addedEventType"] = added_event_type
        plays.append(play)
        event_num += 1

    return plays


def _is_bbr_clock(value):
    return bool(re.match(r"^\d{1,2}:\d{2}(?:\.\d)?$", value or ""))


def _parse_bbr_clock(clock, quarter):
    mins, secs = clock.split(":", 1)
    clock_seconds = int(int(mins) * 60 + float(secs))
    display = f"{clock_seconds // 60}:{clock_seconds % 60:02d}"
    if quarter <= 4:
        quarter_start = (quarter - 1) * 720
        quarter_duration = 720
    else:
        quarter_start = 2880 + (quarter - 5) * 300
        quarter_duration = 300
    return display, clock_seconds, quarter_start + (quarter_duration - clock_seconds)


def _classify_bbr_event(desc):
    text = desc.lower()
    made = " makes " in f" {text} "
    missed = " misses " in f" {text} "
    if "free throw" in text:
        return "free_throw", True, (1 if made else 0), "free_throw"
    if made or missed:
        if "3-pt" in text:
            return "shot", True, (3 if made else 0), "shot_3pt"
        if "2-pt" in text:
            return "shot", True, (2 if made else 0), "shot_2pt"
    if "rebound" in text:
        return "rebound", False, None, None
    if "turnover" in text:
        return "turnover", False, None, None
    if "foul" in text:
        return "foul", False, None, None
    if "timeout" in text:
        return "timeout", False, None, None
    if "jump ball" in text:
        return "jump_ball", False, None, None
    return "other", False, None, None


def _extract_bbr_player(desc):
    match = re.match(r"([A-Z]\. [A-Za-z][A-Za-z .'-]*?)(?: makes| misses| free throw| offensive| defensive| turnover| foul| enters| blocks| steals| vs\.|$)", desc)
    if match:
        return match.group(1).strip()
    match = re.search(r"by ([A-Z]\. [A-Za-z][A-Za-z .'-]*)", desc)
    return match.group(1).strip() if match else None
