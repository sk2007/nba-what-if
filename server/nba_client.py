import re
import requests

_CDN_HEADERS = {"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15"}

_cache = {}


def _cached(key, fn):
    if key not in _cache:
        _cache[key] = fn()
    return _cache[key]


# Season string "2024-25" -> start year 2024
def _season_year(season):
    return int(season.split("-")[0])


# Playoff game IDs start with "0042", regular season with "0022"
_SEASON_TYPE_PREFIX = {"Regular Season": "0022", "Playoffs": "0042"}


def get_games(season, season_type):
    """
    Returns list of game dicts: { gameId, teamA, teamB, date, finalScoreA, finalScoreB }
    teamA = home team, teamB = away team. Sorted by date descending.
    """
    key = f"games:{season}:{season_type}"
    return _cached(key, lambda: _fetch_games(season, season_type))


def _fetch_games(season, season_type):
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


def get_play_by_play(game_id):
    """
    Returns dict: { gameId, teamA, teamB, plays, wpCurve }
    plays: list of play dicts (see spec)
    """
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


def _fetch_play_by_play(game_id):
    from server.win_probability import compute_wp_curve

    # Fetch play-by-play from cdn.nba.com (not blocked unlike stats.nba.com)
    pbp_url = f"https://cdn.nba.com/static/json/liveData/playbyplay/playbyplay_{game_id}.json"
    box_url = f"https://cdn.nba.com/static/json/liveData/boxscore/boxscore_{game_id}.json"

    pbp_r = requests.get(pbp_url, headers=_CDN_HEADERS, timeout=15)
    pbp_r.raise_for_status()
    actions = pbp_r.json()["game"]["actions"]

    box_r = requests.get(box_url, headers=_CDN_HEADERS, timeout=15)
    box_r.raise_for_status()
    box_game = box_r.json()["game"]

    home = box_game["homeTeam"]
    away = box_game["awayTeam"]
    team_a = f"{home['teamCity']} {home['teamName']}"  # home = teamA
    team_b = f"{away['teamCity']} {away['teamName']}"
    home_id = home["teamId"]

    plays = []
    score_a = 0
    score_b = 0

    for action in actions:
        action_type = action.get("actionType", "")
        quarter = action.get("period", 0)
        if not quarter:
            continue

        clock_display, clock_seconds, game_seconds = _parse_cdn_clock(action.get("clock", ""), quarter)

        # scoreHome = teamA (home), scoreAway = teamB (away)
        score_str_a = action.get("scoreHome", "")
        score_str_b = action.get("scoreAway", "")
        if score_str_a:
            try:
                score_a = int(score_str_a)
                score_b = int(score_str_b)
            except ValueError:
                pass

        event_type, editable, shot_pts = _classify_cdn_event(action)

        team_id = action.get("teamId")
        team_full = team_a if team_id == home_id else (team_b if team_id else None)

        player = action.get("playerNameI") or action.get("playerName") or None

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
        plays.append(play)

    wp_curve = compute_wp_curve(plays)

    return {
        "gameId": game_id,
        "teamA": team_a,
        "teamB": team_b,
        "plays": plays,
        "wpCurve": wp_curve,
    }


def _classify_cdn_event(action):
    """
    CDN actionType values: '2pt', '3pt', 'freethrow', 'rebound', 'turnover',
    'foul', 'timeout', 'substitution', 'jumpball', 'period', 'violation', etc.
    Returns (event_type_str, editable, shot_pts_or_None)
    """
    action_type = action.get("actionType", "")
    shot_result = action.get("shotResult", "")
    made = shot_result == "Made"

    if action_type in ("2pt", "3pt"):
        pts = (3 if action_type == "3pt" else 2) if made else 0
        return "shot", True, pts
    if action_type == "freethrow":
        return "free_throw", True, (1 if made else 0)
    if action_type == "rebound":
        return "rebound", False, None
    if action_type == "turnover":
        return "turnover", False, None
    if action_type == "foul":
        return "foul", False, None
    if action_type == "timeout":
        return "timeout", False, None
    if action_type == "substitution":
        return "substitution", False, None
    if action_type == "jumpball":
        return "jump_ball", False, None
    return "other", False, None


