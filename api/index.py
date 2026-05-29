from flask import Flask, jsonify, request
from flask_cors import CORS
import sys
import os
import requests as http_requests

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from server.nba_client import get_games, get_play_by_play
from server.wp_mlp import compute_wp_curve

app = Flask(__name__)
CORS(app)

KALSHI_BASE = 'https://api.elections.kalshi.com/trade-api/v2'
KALSHI_HEADERS = {'accept': 'application/json'}

SEASONS = [
    f"{y}-{str(y+1)[-2:]}" for y in range(2024, 2014, -1)
]


@app.get("/api/seasons")
def seasons():
    return jsonify({
        "seasons": [{"id": s, "label": s} for s in SEASONS],
        "seasonTypes": ["Regular Season"],
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


ODDS_API_BASE = 'https://api.the-odds-api.com/v4'


@app.get('/api/odds/nba')
def nba_odds():
    key = os.environ.get('ODDS_API_KEY', '')
    if not key or key == 'your_key_here':
        return jsonify({'error': 'ODDS_API_KEY not configured'}), 503
    try:
        r = http_requests.get(
            f'{ODDS_API_BASE}/sports/basketball_nba/odds/',
            params={
                'apiKey': key,
                'regions': 'us',
                'markets': 'h2h,spreads,totals',
                'oddsFormat': 'american',
            },
            timeout=10,
        )
        r.raise_for_status()
        return jsonify(r.json())
    except Exception as e:
        return jsonify({'error': str(e)}), 503


@app.get('/api/kalshi/nba/events')
def kalshi_nba_events():
    limit = request.args.get('limit', 20)
    try:
        r = http_requests.get(
            f'{KALSHI_BASE}/events',
            params={'series_ticker': 'KXNBAGAME', 'limit': limit},
            headers=KALSHI_HEADERS,
            timeout=10,
        )
        r.raise_for_status()
        return jsonify(r.json())
    except Exception as e:
        return jsonify({'error': str(e)}), 503


@app.get('/api/kalshi/markets')
def kalshi_markets():
    event_ticker = request.args.get('event_ticker')
    if not event_ticker:
        return jsonify({'error': 'event_ticker required'}), 400
    try:
        r = http_requests.get(
            f'{KALSHI_BASE}/markets',
            params={'event_ticker': event_ticker, 'limit': 10},
            headers=KALSHI_HEADERS,
            timeout=10,
        )
        r.raise_for_status()
        return jsonify(r.json())
    except Exception as e:
        return jsonify({'error': str(e)}), 503


@app.post('/api/wp/recompute')
def wp_recompute():
    from server.wp_mlp import compute_wp_curve as mlp_curve, available as mlp_available
    body = request.get_json(force=True, silent=True) or {}
    team_a = body.get('teamA', '')
    plays = body.get('plays', [])
    overrides = body.get('overrides', {})

    sorted_plays = sorted(plays, key=lambda p: p.get('gameSeconds', 0))

    score_delta_a = 0
    score_delta_b = 0
    last_anchor_a = 0
    last_anchor_b = 0
    score_a = 0
    score_b = 0
    enriched = []

    for play in sorted_plays:
        if play.get('editable'):
            event_num = str(play.get('eventNum', ''))
            override = overrides.get(event_num)
            orig_pts = play.get('shotPts', 0)
            orig_made = orig_pts > 0
            made = (override == 'Made') if override is not None else orig_made
            actual_pts = _pts_for_type(play) if made else 0
            orig_contribution = 0 if play.get('added') else orig_pts

            if play.get('team') == team_a:
                score_delta_a += actual_pts - orig_contribution
            else:
                score_delta_b += actual_pts - orig_contribution

            score_a = play.get('scoreA', last_anchor_a) + score_delta_a
            score_b = play.get('scoreB', last_anchor_b) + score_delta_b
        else:
            last_anchor_a = play.get('scoreA', last_anchor_a)
            last_anchor_b = play.get('scoreB', last_anchor_b)
            score_a = last_anchor_a + score_delta_a
            score_b = last_anchor_b + score_delta_b

        enriched.append({**play, 'scoreA': score_a, 'scoreB': score_b})

    if mlp_available():
        curve = mlp_curve(enriched, team_a)
    else:
        from server.win_probability import compute_wp_curve as sigmoid_curve
        curve = sigmoid_curve(enriched)

    return jsonify({'wpCurve': curve})


@app.get('/api/clutch')
def clutch_index():
    season = request.args.get('season')
    season_type = request.args.get('season_type', 'Regular Season')
    team = request.args.get('team')
    if not season or not team:
        return jsonify({'error': 'season and team are required'}), 400

    try:
        all_games = get_games(season, season_type)
    except Exception as e:
        return jsonify({'error': str(e)}), 503

    team_games = [g for g in all_games if team in (g['teamA'], g['teamB'])]

    # Crunch time: Q4 (or OT), clock ≤ 300s remaining, score within 5 pts
    CRUNCH_CLOCK = 300
    CRUNCH_MARGIN = 5

    player_stats = {}  # player -> {wp_added_total, plays, games}

    errors = []
    for game in team_games:
        try:
            pbp = get_play_by_play(game['gameId'])
        except Exception as e:
            errors.append(str(e))
            continue

        plays = pbp.get('plays', [])
        team_a = pbp.get('teamA', '')
        wp_curve = pbp.get('wpCurve', [])

        # Build a quick lookup: gameSeconds -> wp
        sorted_curve = sorted(wp_curve, key=lambda p: p['gameSeconds'])

        def wp_at(gs):
            # binary-search-style: last curve point <= gs
            result = 50.0
            for pt in sorted_curve:
                if pt['gameSeconds'] <= gs:
                    result = pt['wp']
                else:
                    break
            return result

        # Identify which side of the team-A/B split the requested team is on
        is_home = (team == team_a)

        def wp_before_play(gs):
            result = sorted_curve[0]['wp'] if sorted_curve else 50.0
            for pt in sorted_curve:
                if pt['gameSeconds'] < gs:
                    result = pt['wp']
                else:
                    break
            return result

        for play in plays:
            if not play.get('player'):
                continue
            if play.get('team') != team:
                continue
            if not play.get('editable'):
                continue
            quarter = play.get('quarter', 0)
            if quarter < 4:
                continue
            if play.get('clockSeconds', 999) > CRUNCH_CLOCK:
                continue
            if abs(play.get('scoreA', 0) - play.get('scoreB', 0)) > CRUNCH_MARGIN:
                continue

            gs = play.get('gameSeconds', 0)
            delta = wp_at(gs) - wp_before_play(gs)
            if not is_home:
                delta = -delta

            player = play['player']
            if player not in player_stats:
                player_stats[player] = {'wpAdded': 0.0, 'plays': 0, 'games': set()}
            player_stats[player]['wpAdded'] += delta
            player_stats[player]['plays'] += 1
            player_stats[player]['games'].add(game['gameId'])

    results = []
    for player, stats in player_stats.items():
        if stats['plays'] < 3:
            continue
        results.append({
            'player': player,
            'wpAdded': round(stats['wpAdded'], 1),
            'avgWpAdded': round(stats['wpAdded'] / stats['plays'], 2),
            'plays': stats['plays'],
            'games': len(stats['games']),
        })

    results.sort(key=lambda r: r['wpAdded'], reverse=True)
    return jsonify({'players': results, 'gamesAnalyzed': len(team_games), 'errors': len(errors)})


def _pts_for_type(play):
    etype = play.get('addedEventType', play.get('eventType', ''))
    if etype == 'shot_3pt': return 3
    if etype == 'shot_2pt': return 2
    if etype in ('free_throw', 'freethrow'): return 1
    return play.get('shotPts', 0) or 2


PROP_SERIES = {'KXNBAPTS', 'KXNBAREB', 'KXNBAAST', 'KXNBA3PT', 'KXNBAPRA'}


@app.get('/api/kalshi/props')
def kalshi_props():
    game_suffix = request.args.get('game_suffix')
    series = request.args.get('series')
    if not game_suffix or not series:
        return jsonify({'error': 'game_suffix and series are required'}), 400
    if series not in PROP_SERIES:
        return jsonify({'error': f'series must be one of {sorted(PROP_SERIES)}'}), 400
    event_ticker = f'{series}-{game_suffix}'
    try:
        r = http_requests.get(
            f'{KALSHI_BASE}/markets',
            params={'event_ticker': event_ticker, 'limit': 50},
            headers=KALSHI_HEADERS,
            timeout=10,
        )
        r.raise_for_status()
        all_markets = r.json().get('markets', [])
        active = [m for m in all_markets if m.get('status') == 'active']
        return jsonify({'markets': active})
    except Exception as e:
        return jsonify({'error': str(e)}), 503
