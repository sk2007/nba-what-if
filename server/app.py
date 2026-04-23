from flask import Flask, jsonify, request
from flask_cors import CORS
import pandas as pd
from server.nba_client import get_games, get_play_by_play

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


def _int_param(name, default):
    val = request.args.get(name)
    try:
        return int(val) if val is not None else default
    except ValueError:
        return default


if __name__ == "__main__":
    app.run(port=5001, debug=True)
