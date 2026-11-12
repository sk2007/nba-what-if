# Downloaded 2025–26 season

The app bundles 1,230 regular-season games (622,187 play records) and 85
playoff games (43,289 play records), downloaded November 11, 2026.

- `games_2025-26_Regular_Season.json` and `games_2025-26_Playoffs.json` are the
  game lists used by the existing season/game endpoints.
- `pbp_2025-26.sqlite3` contains one zlib-compressed JSON payload per game.
  Python's built-in sqlite3 reads individual games in read-only mode; neither
  the NBA endpoints nor an external database is needed for these plays.
- Win-probability curves are computed locally using the current model when
  a game is requested, so cached plays do not freeze an older model's predictions.

The live NBA endpoints were unavailable from this network, so the completed
season download uses the NBA-derived archive maintained by
[ramirobentes/nba_data](https://github.com/ramirobentes/nba_data):

- [Regular season source](https://github.com/ramirobentes/nba_data/releases/download/pbp/pbp_regular_2026.parquet)
- [Playoffs source](https://github.com/ramirobentes/nba_data/releases/download/pbp/pbp_playoffs_2026.parquet)

This source uses the season's ending year: `2026` means `2025-26`. Original
download SHA-256 hashes and source URLs are recorded in the SQLite `metadata`
table. `nba_api` remains the client for live and uncached games.

The archive includes synthetic period-end records with repeated source IDs.
Normalized `eventNum` values are unique within a game so editing one play
cannot edit another. `sourceEventNum` preserves the source's identifier.
Synthetic period records are retained; record counts include them.

`betting_lines_2025-26.json` supplies exact, offline **closing pregame
spreads for all 1,315 games**. Negative means the home team was favored;
the away spread is its sign-reversed counterpart. The original and what-if
models both receive the home spread. Zero is a real pick'em, while an absent
spread is `null` in the API and visibly marked unavailable.

[RotoWire's archive](https://www.rotowire.com/betting/nba/archive.php)
provides 1,289 lines, matched on date, home/away teams, and final scores.
The remaining 26 use the
[archived ESPN betting-lines dataset](https://basketball-data.billmill.org/nba/espn/betting_lines/season=2026/data.parquet)
maintained by [llimllib/nba_data](https://github.com/llimllib/nba_data):
10 DraftKings lines and 16 ESPN BET lines, matched on NBA game ID and both
NBA team IDs. These are closing spreads, not opening spreads. Per-game
sources, retrieval timestamp, and SHA-256 hashes are stored in the JSON cache.
A dated lookup never borrows a line from another game or season.

The underlying play archive itself does not supply betting spreads; the line
cache overlays that field when a game is loaded, before computing its curve.
Play-by-play does not include complete box scores, so the separate box-score
endpoint still requires NBA access.

To rebuild (from the project root, with the server environment activated):

```bash
python3 -m pip install pyarrow
python3 -m server.download_season --season 2025-26
python3 -m server.seed_betting_lines --season 2025-26
```

Only these one-time downloads need pyarrow. Restart the server after rebuilding caches. The database and JSON lists are
included in Vercel's existing `server/**` deployment bundle.
