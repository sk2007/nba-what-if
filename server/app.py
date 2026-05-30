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


@app.post('/api/wp/recompute')
def wp_recompute():
    """
    Recompute WP curve using the MLP given an edited play list.
    Body: { teamA: str, plays: [...], overrides: {eventNum: 'Made'|'Missed'} }
    Returns: { wpCurve: [{gameSeconds, wp}] }
    """
    from server.wp_mlp import compute_wp_curve as mlp_curve, available as mlp_available
    body = request.get_json(force=True, silent=True) or {}
    team_a = body.get('teamA', '')
    plays = body.get('plays', [])
    overrides = body.get('overrides', {})


    # Walk plays in game order, recomputing cumulative scores with overrides applied.
    # Use scoreA/scoreB from non-editable plays as anchors, then adjust for any
    # editable plays that changed since the last anchor.
    sorted_plays = sorted(plays, key=lambda p: p.get('gameSeconds', 0))

    # Compute per-play score deltas from overrides vs originals
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
            # Added plays' scoreA/B is the score at insertion point (not including their own pts)
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


def _pts_for_type(play):
    etype = play.get('addedEventType', play.get('eventType', ''))
    if etype == 'shot_3pt': return 3
    if etype == 'shot_2pt': return 2
    if etype in ('free_throw', 'freethrow'): return 1
    return play.get('shotPts', 0) or 2


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

    CRUNCH_CLOCK = 300   # ≤5 min remaining in quarter
    CRUNCH_MARGIN = 5    # within 5 points

    player_stats = {}
    errors = []

    for game in team_games:
        try:
            pbp = get_play_by_play(game['gameId'])
        except Exception as e:
            errors.append(str(e))
            continue

        plays = pbp.get('plays', [])
        team_a = pbp.get('teamA', '')
        sorted_curve = sorted(pbp.get('wpCurve', []), key=lambda p: p['gameSeconds'])
        if not sorted_curve:
            continue

        is_home = (team == team_a)

        def wp_before_play(gs):
            result = sorted_curve[0]['wp']
            for pt in sorted_curve:
                if pt['gameSeconds'] < gs:
                    result = pt['wp']
                else:
                    break
            return result

        def wp_at_play(gs):
            result = sorted_curve[0]['wp']
            for pt in sorted_curve:
                if pt['gameSeconds'] <= gs:
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
            delta = wp_at_play(gs) - wp_before_play(gs)
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
