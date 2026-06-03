import json
from datetime import datetime
from pathlib import Path

import requests


_CACHE_DIR = Path(__file__).resolve().parent / "cache"
_CACHE_PATH = _CACHE_DIR / "rotowire_nba_lines.json"
_ROTOWIRE_URL = "https://www.rotowire.com/betting/nba/tables/games-archive.php"
_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15"
    ),
    "Accept": "application/json,text/plain,*/*",
}

_TEAM_ABBREV = {
    "Atlanta Hawks": "ATL",
    "Boston Celtics": "BOS",
    "Brooklyn Nets": "BKN",
    "Charlotte Hornets": "CHA",
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
    "Phoenix Suns": "PHX",
    "Portland Trail Blazers": "POR",
    "Sacramento Kings": "SAC",
    "San Antonio Spurs": "SAS",
    "Toronto Raptors": "TOR",
    "Utah Jazz": "UTA",
    "Washington Wizards": "WAS",
}

_lines_cache = None
_line_index = None


def get_pregame_line(home_team, away_team, game_date=None):
    """
    Return the Rotowire closing spread from the home team's perspective.
    Negative values mean the home team was favored. Missing rows return 0.
    """
    home_abbrev = _TEAM_ABBREV.get(home_team, home_team)
    away_abbrev = _TEAM_ABBREV.get(away_team, away_team)
    if not home_abbrev or not away_abbrev:
        return 0

    index = _get_line_index()
    date_key = _date_key(game_date)
    if date_key:
        line = index.get((date_key, home_abbrev, away_abbrev))
        if line is not None:
            return line

    # Fallback for callers that cannot resolve a date: use the latest matching
    # matchup. This is less precise, so dated lookups should be preferred.
    for row_date, row_home, row_away, line in reversed(_get_lines()):
        if row_home == home_abbrev and row_away == away_abbrev:
            return line
    return 0


def _get_line_index():
    global _line_index
    if _line_index is None:
        _line_index = {
            (date, home, away): line
            for date, home, away, line in _get_lines()
        }
    return _line_index


def _get_lines():
    global _lines_cache
    if _lines_cache is None:
        _lines_cache = _load_cached_lines()
    return _lines_cache


def _load_cached_lines():
    rows = _read_cache()
    if rows is None:
        rows = _fetch_archive()
        _write_cache(rows)

    lines = []
    for row in rows:
        try:
            game_date = _date_key(row.get("game_date"))
            home = row.get("home_team_abbrev") or row.get("home_team_stats_id")
            away = row.get("visit_team_abbrev") or row.get("visit_team_stats_id")
            line = float(row.get("line"))
        except (TypeError, ValueError):
            continue
        if game_date and home and away:
            lines.append((game_date, home, away, line))
    lines.sort(key=lambda item: item[0])
    return lines


def _fetch_archive():
    response = requests.get(_ROTOWIRE_URL, headers=_HEADERS, timeout=20)
    response.raise_for_status()
    return response.json()


def _read_cache():
    if not _CACHE_PATH.exists():
        return None
    with _CACHE_PATH.open("r", encoding="utf-8") as f:
        return json.load(f)


def _write_cache(rows):
    _CACHE_DIR.mkdir(parents=True, exist_ok=True)
    with _CACHE_PATH.open("w", encoding="utf-8") as f:
        json.dump(rows, f)


def _date_key(value):
    if not value:
        return None
    if isinstance(value, datetime):
        return value.date().isoformat()
    text = str(value)
    if len(text) >= 10:
        text = text[:10]
    try:
        return datetime.fromisoformat(text).date().isoformat()
    except ValueError:
        return None
