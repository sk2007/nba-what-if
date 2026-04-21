from flask import Flask, jsonify, request
from flask_cors import CORS
from server.nba_client import get_games, get_play_by_play, get_win_prob_stats

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
        box = BoxScoreTraditionalV2(game_id=game_id)
        team_df = box.get_data_frames()[1]
        rows = team_df.to_dict(orient="records")
        if len(rows) < 2:
            return jsonify({"error": "Could not parse box score"}), 503
        def extract(row):
            return {
                "teamName": row["TEAM_NAME"],
                "FG_PCT": round(float(row["FG_PCT"] or 0), 3),
                "FG3_PCT": round(float(row["FG3_PCT"] or 0), 3),
                "FT_PCT": round(float(row["FT_PCT"] or 0), 3),
                "REB": int(row["REB"] or 0),
                "TOV": int(row["TOV"] or 0),
            }
        return jsonify({
            "gameId": game_id,
            "teamA": extract(rows[1]),
            "teamB": extract(rows[0]),
        })
    except Exception as e:
        return jsonify({"error": str(e)}), 503


@app.get("/api/stats/winprob")
def win_prob_stats():
    season = request.args.get("season")
    season_type = request.args.get("season_type")
    if not season or not season_type:
        return jsonify({"error": "season and season_type are required"}), 400
    thresholds = {
        "threePointPct": _int_param("threePointPct", 0),
        "fgPct": _int_param("fgPct", 0),
        "turnovers": _int_param("turnovers", 999),
        "rebounds": _int_param("rebounds", 0),
        "ftPct": _int_param("ftPct", 0),
    }
    try:
        return jsonify(get_win_prob_stats(season, season_type, thresholds))
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
