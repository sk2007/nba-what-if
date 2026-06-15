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
