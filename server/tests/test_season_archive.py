import json
import sqlite3
import zlib
from collections import Counter
from contextlib import closing
from unittest.mock import patch

import pytest
import server.nba_client as nc


def test_downloaded_season_has_all_games_and_consistent_plays():
    regular = nc._read_cached_games('2025-26', 'Regular Season')
    playoffs = nc._read_cached_games('2025-26', 'Playoffs')
    assert len(regular) == 1230
    assert len(playoffs) == 85
    team_counts = Counter(team for game in regular for team in (game['teamA'], game['teamB']))
    assert len(team_counts) == 30
    assert set(team_counts.values()) == {82}
    expected = {game['gameId']: game for game in regular + playoffs}
    path = nc._CACHE_DIR / 'pbp_2025-26.sqlite3'
    with closing(sqlite3.connect(f'{path.as_uri()}?mode=ro', uri=True)) as connection:
        assert connection.execute('PRAGMA integrity_check').fetchone()[0] == 'ok'
        rows = connection.execute('SELECT game_id, payload FROM games').fetchall()
    assert len(rows) == len(expected)
    count = 0
    for game_id, payload in rows:
        game = json.loads(zlib.decompress(payload))
        plays = game['plays']
        assert game['gameId'] == game_id
        assert len({play['eventNum'] for play in plays}) == len(plays)
        assert all(a['gameSeconds'] <= b['gameSeconds'] for a, b in zip(plays, plays[1:]))
        assert plays[-1]['scoreA'] == expected[game_id]['finalScoreA']
        assert plays[-1]['scoreB'] == expected[game_id]['finalScoreB']
        assert game['status'] == 'finished'
        count += len(plays)
    assert count == 665476


@pytest.mark.parametrize('game_id', ['0022500001', '0022501200', '0042500121', '0042500405'])
def test_downloaded_game_loads_plays_and_wp_without_network(game_id):
    with patch('requests.get', side_effect=AssertionError('Network must not be used')), \
         patch.object(nc, '_build_game', side_effect=AssertionError('NBA must not be queried')):
        game = nc._fetch_play_by_play(game_id)
    assert game['gameId'] == game_id
    assert game['plays']
    assert len(game['wpCurve']) == len(game['plays']) + 1
    assert all(0 <= point['wp'] <= 100 for point in game['wpCurve'])


def test_live_fetch_bypasses_season_archive():
    with patch.object(nc, '_read_archived_play_by_play') as archive, \
         patch.object(nc, '_build_game', return_value=({'gameId': '0022500001'}, 'live')):
        assert nc.get_play_by_play('0022500001', live=True)['gameId'] == '0022500001'
    archive.assert_not_called()


@pytest.mark.parametrize('game_id', ['../../bad', 'g1', '0022400001'])
def test_missing_archive_keeps_existing_data_path(game_id):
    assert nc._read_archived_play_by_play(game_id) is None
