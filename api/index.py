from flask import Flask, jsonify, request
from flask_cors import CORS
import sys
import os
import requests as http_requests

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from server.nba_client import get_games, get_play_by_play

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
        "seasonTypes": ["Regular Season", "Playoffs"],
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
