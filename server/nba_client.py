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
    Uses LeagueGameLog to get all team-game rows for the season, then filters.
    """
    key = f"teamlog:{season}:{season_type}"
    rows = _cached(key, lambda: _fetch_team_game_log(season, season_type))
    return _filter_and_count(rows, thresholds, season, season_type)


def _fetch_team_game_log(season, season_type):
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
