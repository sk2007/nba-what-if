"""Cache exact pregame closing spreads for a downloaded season.

Usage: python3 -m server.seed_betting_lines --season 2025-26
Download-only dependency: pyarrow. Runtime uses plain JSON.
"""
import argparse
from collections import Counter, defaultdict
from datetime import datetime, timezone
import hashlib
import io
import json
import math
from pathlib import Path
import re

import requests

from server.betting_lines import _ROTOWIRE_URL, _HEADERS, _TEAM_ABBREV
from server.nba_client import _CACHE_DIR

ESPN_ARCHIVE = "https://basketball-data.billmill.org/nba/espn/betting_lines/season={year}/data.parquet"


def select_line(game, rotowire, espn, team_ids):
    key = (game['date'], _TEAM_ABBREV[game['teamA']], _TEAM_ABBREV[game['teamB']])
    for row in rotowire.get(key, []):
        if (row.get('home_team_score'), row.get('visit_team_score')) != (game['finalScoreA'], game['finalScoreB']):
            continue
        try:
            line = float(row['line'])
        except (TypeError, ValueError):
            continue
        if math.isfinite(line):
            return line, 'rotowire'
    # ESPN's archived line is already signed from the home team's perspective.
    # Prefer a named sportsbook to a consensus; never substitute the opening line.
    for row in sorted(espn.get(game['gameId'], []), key=lambda row: {'100': 0, '58': 1, 'odds_api_consensus': 2}.get(row['provider_id'], 3)):
        if (row['home_team_id'], row['away_team_id']) != (team_ids[game['teamA']], team_ids[game['teamB']]):
            continue
        line = row['close_spread']
        if isinstance(line, (int, float)) and math.isfinite(line):
            return line, row['provider_id']
    return None


def seed_lines(season):
    import pyarrow.parquet as pq
    from nba_api.stats.static import teams

    if not re.fullmatch(r'20\d{2}-\d{2}', season):
        raise ValueError('Use a season such as 2025-26')
    year = int(season[:4])
    if season != f'{year}-{str(year + 1)[-2:]}':
        raise ValueError('Invalid season end year')
    games = []
    for kind in ['Regular_Season', 'Playoffs']:
        games += json.loads((_CACHE_DIR / f'games_{season}_{kind}.json').read_text())
    roto_response = requests.get(_ROTOWIRE_URL, headers=_HEADERS, timeout=30)
    roto_response.raise_for_status()
    roto = defaultdict(list)
    for row in roto_response.json():
        roto[(row['game_date'][:10], row['home_team_abbrev'], row['visit_team_abbrev'])].append(row)
    url = ESPN_ARCHIVE.format(year=year + 1)
    espn_response = requests.get(url, timeout=30)
    espn_response.raise_for_status()
    espn = defaultdict(list)
    for row in pq.read_table(io.BytesIO(espn_response.content)).to_pylist():
        espn[row['game_id']].append(row)
    team_ids = {team['full_name']: str(team['id']) for team in teams.get_teams()}
    team_ids['LA Clippers'] = team_ids['Los Angeles Clippers']
    cached, missing = {}, []
    for game in games:
        selected = select_line(game, roto, espn, team_ids)
        if selected is None:
            missing.append(game['gameId'])
            continue
        line, source = selected
        cached[game['gameId']] = {
            'homeSpread': line, 'source': source,
            'date': game['date'], 'homeTeam': game['teamA'], 'awayTeam': game['teamB'],
        }
    if missing:
        raise RuntimeError(f'No exact closing spread for {len(missing)} games: {missing}. Cache was not changed.')
    checksum = lambda content: hashlib.sha256(content).hexdigest()
    data = {
        'season': season, 'lineType': 'closing', 'perspective': 'home',
        'retrievedAt': datetime.now(timezone.utc).isoformat(),
        'sources': {
            'rotowire': {'label': 'RotoWire', 'url': 'https://www.rotowire.com/betting/nba/archive.php',
                         'downloadUrl': _ROTOWIRE_URL, 'sha256': checksum(roto_response.content)},
            '100': {'label': 'DraftKings via ESPN archive', 'url': url, 'sha256': checksum(espn_response.content)},
            '58': {'label': 'ESPN BET via ESPN archive', 'url': url, 'sha256': checksum(espn_response.content)},
            'odds_api_consensus': {'label': 'The Odds API consensus archive', 'url': url, 'sha256': checksum(espn_response.content)},
        },
        'coverage': {'games': len(cached), 'missing': len(missing), 'bySource': dict(Counter(row['source'] for row in cached.values()))},
        'games': cached,
    }
    path = _CACHE_DIR / f'betting_lines_{season}.json'
    temporary = path.with_suffix('.json.tmp')
    temporary.write_text(json.dumps(data, indent=2, allow_nan=False) + '\n', encoding='utf-8')
    temporary.replace(path)
    print(f'Saved {len(cached):,} closing spreads to {path}')
    print(data['coverage'])


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--season', default='2025-26')
    seed_lines(parser.parse_args().season)
