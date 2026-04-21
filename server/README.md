# NBA What If — Backend Server

Python/Flask API wrapping nba_api.

## Setup

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

## Run

```bash
# From the project root
source server/.venv/bin/activate
python3 -m server.app
```

Server starts on http://localhost:5001.

## Endpoints

- `GET /api/seasons` — available seasons and season types
- `GET /api/games?season=2024-25&season_type=Playoffs` — games for a season
- `GET /api/games/:gameId/playbyplay` — play-by-play + win prob curve
- `GET /api/games/:gameId/boxscore` — box score stats
- `GET /api/stats/winprob?season=...&threePointPct=35&fgPct=45&turnovers=14&rebounds=40&ftPct=75` — historical win rate

## Notes

- nba_api responses are cached in memory for the process lifetime. Restart to clear.
- nba_api rate-limits requests. If you get 503 errors, wait a few seconds and retry.
- stats.nba.com may block requests from certain networks (e.g. university/corporate IP blocks). Use a residential or VPN connection if requests time out.
