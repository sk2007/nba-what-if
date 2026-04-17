# NBA What If — Python/Flask Backend Design

**Date:** 2026-04-16
**Scope:** Python Flask API server wrapping nba_api, serving play-by-play and stat model endpoints
**Depends on:** Nothing (standalone server)

---

## Overview

A small Flask API that wraps `nba_api` to serve play-by-play data and historical win-rate queries. The React frontend proxies `/api/*` requests to this server via Vite config.

---

## Architecture

- **Language/Framework:** Python 3 + Flask
- **Data source:** `nba_api` library (`PlayByPlayV2`, `BoxScoreTraditionalV2`, `LeagueGameFinder`, `TeamGameLog` for bulk season stats)
- **Caching:** In-memory Python dict — cache responses by URL params to avoid rate-limiting
- **Port:** `localhost:5001`
- **CORS:** Enabled for `localhost:5173` (Vite dev server)
- **Vite proxy:** `/api/*` → `http://localhost:5001` configured in `vite.config.js`

---

## File Structure

```
server/
  app.py              # Flask app, route definitions
  nba_client.py       # nba_api wrappers + in-memory cache
  win_probability.py  # Server-side win prob curve computation
  requirements.txt    # nba_api, flask, flask-cors
```

---

## Endpoints

### `GET /api/seasons`
Returns hardcoded list of available seasons.

**Response:**
```json
{
  "seasons": [
    { "id": "2024-25", "label": "2024-25" },
    { "id": "2023-24", "label": "2023-24" },
    ...
    { "id": "2014-15", "label": "2014-15" }
  ],
  "seasonTypes": ["Regular Season", "Playoffs"]
}
```

---

### `GET /api/games?season=2024-25&season_type=Regular+Season`
Returns all games for a season, using `LeagueGameFinder`.

**Query params:**
- `season` (required): e.g. `2024-25`
- `season_type` (required): `Regular Season` or `Playoffs`

**Response:**
```json
{
  "games": [
    {
      "gameId": "0022401001",
      "teamA": "Boston Celtics",
      "teamB": "Miami Heat",
      "date": "2024-10-22",
      "finalScoreA": 108,
      "finalScoreB": 95
    }
  ]
}
```

**Notes:**
- `LeagueGameFinder` returns duplicate rows (one per team); deduplicated server-side by pairing rows per game ID
- `teamA` = home team, `teamB` = away team
- Sorted by date descending

---

### `GET /api/games/:gameId/playbyplay`
Returns full play-by-play for a game, plus a precomputed win probability curve.

**Response:**
```json
{
  "gameId": "0022401001",
  "teamA": "Boston Celtics",
  "teamB": "Miami Heat",
  "plays": [
    {
      "eventNum": 1,
      "clock": "12:00",
      "quarter": 1,
      "clockSeconds": 720,
      "gameSeconds": 0,
      "description": "Jump Ball: Porzingis vs Adebayo",
      "scoreA": 0,
      "scoreB": 0,
      "eventType": "jump_ball",
      "editable": false,
      "team": null,
      "player": null
    },
    {
      "eventNum": 4,
      "clock": "11:32",
      "quarter": 1,
      "clockSeconds": 692,
      "gameSeconds": 28,
      "description": "Jayson Tatum 2PT Shot: Made (2 PTS)",
      "scoreA": 2,
      "scoreB": 0,
      "eventType": "shot",
      "editable": true,
      "team": "Boston Celtics",
      "player": "Jayson Tatum",
      "shotPts": 2
    }
  ],
  "wpCurve": [
    { "gameSeconds": 0, "wp": 50 },
    { "gameSeconds": 28, "wp": 53 }
  ]
}
```

**Notes:**
- `gameSeconds`: elapsed seconds from tip-off (0 = start, 2880 = end of regulation)
- `editable`: true for shots and free throws only
- `eventType`: one of `shot`, `free_throw`, `turnover`, `foul`, `rebound`, `timeout`, `substitution`, `other`
- `shotPts`: 1, 2, or 3 (only present for `shot` and `free_throw` events)
- Win probability uses logistic on score diff + seconds remaining

---

### `GET /api/games/:gameId/boxscore`
Returns box score stats for both teams.

**Response:**
```json
{
  "gameId": "0022401001",
  "teamA": {
    "teamName": "Boston Celtics",
    "FG_PCT": 0.487,
    "FG3_PCT": 0.412,
    "FT_PCT": 0.833,
    "REB": 44,
    "TOV": 11
  },
  "teamB": {
    "teamName": "Miami Heat",
    "FG_PCT": 0.431,
    "FG3_PCT": 0.321,
    "FT_PCT": 0.750,
    "REB": 38,
    "TOV": 14
  }
}
```

---

### `GET /api/stats/winprob?season=2024-25&season_type=Regular+Season&threePointPct=35&fgPct=45&turnovers=14&rebounds=40&ftPct=75`
Returns historical win rate for games where the queried team met all stat thresholds.

**Query params:**
- `season` (required)
- `season_type` (required)
- `threePointPct`: minimum FG3_PCT × 100 (integer, 0–100)
- `fgPct`: minimum FG_PCT × 100 (integer, 0–100)
- `turnovers`: maximum TOV (integer)
- `rebounds`: minimum REB (integer)
- `ftPct`: minimum FT_PCT × 100 (integer, 0–100)

**Response:**
```json
{
  "gamesMatched": 42,
  "wins": 28,
  "winRate": 66.7,
  "season": "2024-25",
  "seasonType": "Regular Season"
}
```

**Notes:**
- Uses `TeamGameLog` (one API call per season) to fetch all team game stats for the season, cached after first fetch
- Each row in `TeamGameLog` has `FG_PCT`, `FG3_PCT`, `FT_PCT`, `REB`, `TOV`, and `WL` (W/L)
- Filters rows where all thresholds are met, counts wins from the `WL` column
- If `gamesMatched` is 0, returns `winRate: null`

---

## Win Probability Formula (`win_probability.py`)

Logistic function on score differential weighted by time remaining:

```python
import math

def win_prob(score_diff, seconds_remaining, total_seconds=2880):
    # Tighter weighting late in the game
    k = 0.004 * (1 + (total_seconds - seconds_remaining) / total_seconds)
    p = 1 / (1 + math.exp(-k * score_diff * 100))
    return round(p * 100)
```

- `score_diff`: teamA score minus teamB score
- `seconds_remaining`: seconds left in regulation (OT handled by extending total)
- Returns integer 0–100

---

## Caching Strategy

```python
_cache = {}

def cached(key, fn):
    if key not in _cache:
        _cache[key] = fn()
    return _cache[key]
```

Cache key = endpoint + query params as a string. Cache lives for the process lifetime (restart server to clear). No TTL needed for historical data.

---

## Error Handling

- nba_api calls wrapped in try/except; return `{ "error": "message" }` with appropriate HTTP status
- Rate limit errors (HTTP 429 from NBA API) returned as 503 with `{ "error": "NBA API rate limited, retry shortly" }`
- Missing required query params return 400

---

## Out of Scope

- Authentication
- Persistent database
- Live game data (current season in-progress games)
- Player-level stat threshold queries
