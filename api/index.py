from flask import Flask, jsonify, request
from flask_cors import CORS
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from server.nba_client import get_games, get_play_by_play

app = Flask(__name__)
CORS(app)

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
