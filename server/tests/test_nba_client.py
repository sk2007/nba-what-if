from unittest.mock import patch
import server.nba_client as nc


def _fake_pbp(status):
    return {
        "game": {
            "gameStatus": status,
            "actions": [
                {"actionNumber": 1, "period": 1, "clock": "PT12M00.00S",
                 "actionType": "2pt", "shotResult": "Made", "scoreHome": "2",
                 "scoreAway": "0", "teamId": 100, "description": "Made shot"},
            ],
        }
    }


def _fake_box():
    return {
        "game": {
            "gameTimeUTC": "2026-06-15T00:00:00Z",
            "homeTeam": {"teamId": 100, "teamCity": "Los Angeles",
                         "teamName": "Lakers", "players": []},
            "awayTeam": {"teamId": 200, "teamCity": "Boston",
                         "teamName": "Celtics", "players": []},
        }
    }


def test_build_game_reports_live_status():
    with patch.object(nc, "_raw_pbp", return_value=_fake_pbp(2)), \
         patch.object(nc, "_raw_box", return_value=_fake_box()), \
         patch("server.betting_lines.get_pregame_line", return_value=0):
        game, status = nc._build_game("0022200001")
    assert status == "live"
    assert game["teamA"] == "Los Angeles Lakers"
    assert game["plays"][0]["eventNum"] == 1


def test_build_game_reports_finished_status():
    with patch.object(nc, "_raw_pbp", return_value=_fake_pbp(3)), \
         patch.object(nc, "_raw_box", return_value=_fake_box()), \
         patch("server.betting_lines.get_pregame_line", return_value=0):
        _, status = nc._build_game("0022200001")
    assert status == "finished"


def test_nba_game_list_pairs_home_and_away_and_filters_unfinished():
    def row(game_id, team, matchup, points, outcome="W"):
        return {"GAME_ID": game_id, "TEAM_NAME": team, "MATCHUP": matchup,
                "PTS": points, "WL": outcome, "GAME_DATE": "2025-10-21"}

    rows = [
        row("0022500001", "Houston Rockets", "HOU @ OKC", 124, "L"),
        row("0022500001", "Oklahoma City Thunder", "OKC vs. HOU", 125),
        row("0022500002", "Los Angeles Lakers", "LAL vs. GSW", None, None),
        row("0022500003", "Boston Celtics", "BOS vs. NYK", 100),
        row("0042500001", "Boston Celtics", "BOS vs. NYK", 100),
    ]
    with patch("nba_api.stats.endpoints.leaguegamefinder.LeagueGameFinder") as endpoint:
        endpoint.return_value.get_normalized_dict.return_value = {
            "LeagueGameFinderResults": rows,
        }
        games = nc._fetch_nba_games("2025-26", "Regular Season")
    endpoint.assert_called_once_with(
        league_id_nullable="00", season_nullable="2025-26",
        season_type_nullable="Regular Season", timeout=15,
    )
    assert games == [{
        "gameId": "0022500001", "teamA": "Oklahoma City Thunder",
        "teamB": "Houston Rockets", "date": "2025-10-21",
        "finalScoreA": 125, "finalScoreB": 124,
    }]


def test_play_by_play_prefers_nba_api_for_cached_game():
    with patch.object(nc, "_read_archived_play_by_play", return_value=None), \
         patch.object(nc, "_build_game", return_value=({"gameId": "0022500001"}, "finished")), \
         patch.object(nc, "_build_bbr_game") as fallback:
        assert nc._fetch_play_by_play("0022500001") == {"gameId": "0022500001"}
    fallback.assert_not_called()


def test_play_by_play_keeps_existing_fallback_on_nba_failure():
    with patch.object(nc, "_build_game", side_effect=RuntimeError("NBA unavailable")), \
         patch.object(nc, "_build_bbr_game", return_value={"gameId": "0022400001"}):
        assert nc._fetch_play_by_play("0022400001") == {"gameId": "0022400001"}
