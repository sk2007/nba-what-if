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

- `2025-26` includes downloaded lists and plays for all 1,230 regular-season and 85 playoff games. Historical plays load from `cache/pbp_2025-26.sqlite3` without a network request, and win probability is calculated locally.
- To repeat the season download, install the download-only dependency `pyarrow`, then run `python3 -m server.download_season --season 2025-26`. Flask/Vercel do not need pyarrow. See [cache/README.md](cache/README.md) for sources and limitations.
- Pregame closing spreads are cached for all 1,315 games and included in original and what-if predictions. Refresh them with `python3 -m server.seed_betting_lines --season 2025-26`; the UI shows both teams’ signed spreads and their source.
- Live/uncached games continue to use `nba_api`, with the existing Basketball-Reference fallback. The older `server.seed_cache` script fetches game lists directly through `nba_api`.
- nba_api responses are cached in memory for the process lifetime. Restart to clear.
- nba_api rate-limits requests. If you get 503 errors, wait a few seconds and retry.
- stats.nba.com may block requests from certain networks (e.g. university/corporate IP blocks). Use a residential or VPN connection if requests time out.
