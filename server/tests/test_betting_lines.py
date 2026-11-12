import json
from unittest.mock import patch

import pytest

import server.betting_lines as bl
import server.nba_client as nc
from server.seed_betting_lines import select_line


def test_all_downloaded_games_have_exact_finite_closing_lines():
    count = 0
    for kind in ['Regular Season', 'Playoffs']:
        for game in nc.get_games('2025-26', kind):
            record = bl.get_cached_pregame_line(game['gameId'], game['teamA'], game['teamB'], game['date'])
            assert record is not None, game['gameId']
            assert record['type'] == 'closing'
            assert isinstance(record['line'], (int, float))
            assert -50 < record['line'] < 50
            assert record['sourceUrl'].startswith('https://')
            count += 1
    assert count == 1315


def test_cached_lines_reject_wrong_date_or_teams():
    assert bl.get_cached_pregame_line('0022500001', 'Oklahoma City Thunder', 'Houston Rockets', '2026-10-21') is None
    assert bl.get_cached_pregame_line('0022500001', 'Houston Rockets', 'Oklahoma City Thunder', '2025-10-21') is None


def test_dated_lookup_does_not_borrow_another_games_line():
    with patch.object(bl, '_get_lines', return_value=[('2026-11-01', 'OKC', 'HOU', -15.5)]):
        assert bl.get_pregame_line('Oklahoma City Thunder', 'Houston Rockets', '2025-10-21') == 0


@pytest.mark.parametrize('game_id', ['0022500001', '0022500431', '0042500236'])
def test_local_curve_uses_downloaded_line_without_network(game_id):
    with patch('requests.get', side_effect=AssertionError('No network')), \
         patch('server.wp_mlp.compute_wp_curve', return_value=[]) as model:
        game = nc._read_archived_play_by_play(game_id)
    assert game['bettingLine'] is not None
    assert game['bettingLineType'] == 'closing'
    model.assert_called_once_with(game['plays'], game['teamA'], line=game['bettingLine'])


def test_a_real_pickem_is_distinct_from_missing_line(tmp_path):
    payload = {
        'sources': {'test': {'label': 'Test sportsbook', 'url': 'https://example.com'}},
        'games': {'0022500001': {'homeTeam': 'Home', 'awayTeam': 'Away', 'date': '2025-10-21', 'homeSpread': 0, 'source': 'test'}}
    }
    (tmp_path / 'betting_lines_2025-26.json').write_text(json.dumps(payload))
    with patch.object(bl, '_CACHE_DIR', tmp_path):
        assert bl.get_cached_pregame_line('0022500001', 'Home', 'Away', '2025-10-21')['line'] == 0
        assert bl.get_cached_pregame_line('0022500002', 'Home', 'Away', '2025-10-21') is None


def test_source_selection_uses_closing_spread_and_verifies_matchup():
    game = {'gameId': '0022500001', 'teamA': 'Oklahoma City Thunder', 'teamB': 'Houston Rockets', 'date': '2025-10-21', 'finalScoreA': 125, 'finalScoreB': 124}
    record = {'provider_id': '58', 'home_team_id': '1', 'away_team_id': '2', 'open_spread': -7.5, 'close_spread': -6.5}
    ids = {'Oklahoma City Thunder': '1', 'Houston Rockets': '2'}
    assert select_line(game, {}, {game['gameId']: [record]}, ids) == (-6.5, '58')
    record['home_team_id'], record['away_team_id'] = '2', '1'
    assert select_line(game, {}, {game['gameId']: [record]}, ids) is None
