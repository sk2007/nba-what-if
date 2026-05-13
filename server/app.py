from flask import Flask, jsonify, request
from flask_cors import CORS
import os
import pandas as pd
import requests as http_requests
from dotenv import load_dotenv
from server.nba_client import get_games, get_play_by_play

load_dotenv()

app = Flask(__name__)
CORS(app, origins=["http://localhost:5173"])

SEASONS = [
    f"{y}-{str(y+1)[-2:]}" for y in range(2024, 2013, -1)
]  # ["2024-25", "2023-24", ..., "2014-15"]


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


@app.get("/api/games/<game_id>/boxscore")
def boxscore(game_id):
    from nba_api.stats.endpoints import BoxScoreTraditionalV2
    try:
        box = BoxScoreTraditionalV2(game_id=game_id, timeout=30)
        team_df = box.get_data_frames()[1]
        rows = team_df.to_dict(orient="records")
        if len(rows) < 2:
            return jsonify({"error": "Could not parse box score"}), 503

        def extract(row):
            return {
                "teamName": row["TEAM_NAME"],
                "FG_PCT": round(float(row["FG_PCT"]) if pd.notna(row["FG_PCT"]) else 0.0, 3),
                "FG3_PCT": round(float(row["FG3_PCT"]) if pd.notna(row["FG3_PCT"]) else 0.0, 3),
                "FT_PCT": round(float(row["FT_PCT"]) if pd.notna(row["FT_PCT"]) else 0.0, 3),
                "REB": int(row["REB"]) if pd.notna(row["REB"]) else 0,
                "TOV": int(row["TOV"]) if pd.notna(row["TOV"]) else 0,
            }

        # Use get_play_by_play (cached) to resolve home/away team names consistently.
        pbp = get_play_by_play(game_id)
        team_a_name = pbp["teamA"]
        team_b_name = pbp["teamB"]
        row_map = {r["TEAM_NAME"]: r for r in rows}
        if team_a_name not in row_map or team_b_name not in row_map:
            # Fallback: visitor=index 0, home=index 1
            return jsonify({
                "gameId": game_id,
                "teamA": extract(rows[1]),
                "teamB": extract(rows[0]),
            })
        return jsonify({
            "gameId": game_id,
            "teamA": extract(row_map[team_a_name]),
            "teamB": extract(row_map[team_b_name]),
        })
    except Exception as e:
        return jsonify({"error": str(e)}), 503


KALSHI_BASE = 'https://api.elections.kalshi.com/trade-api/v2'
KALSHI_HEADERS = {'accept': 'application/json'}


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


@app.get('/api/kalshi/props')
def kalshi_props():
    game_suffix = request.args.get('game_suffix')
    series = request.args.get('series')
    if not game_suffix or not series:
        return jsonify({'error': 'game_suffix and series required'}), 400
    event_ticker = f'{series}-{game_suffix}'
    try:
        r = http_requests.get(
            f'{KALSHI_BASE}/markets',
            params={'event_ticker': event_ticker, 'limit': 100, 'status': 'open'},
            headers=KALSHI_HEADERS,
            timeout=10,
        )
        r.raise_for_status()
        return jsonify(r.json())
    except Exception as e:
        return jsonify({'error': str(e)}), 503


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


def _int_param(name, default):
    val = request.args.get(name)
    try:
        return int(val) if val is not None else default
    except ValueError:
        return default


if __name__ == "__main__":
    app.run(port=5001, debug=True)
