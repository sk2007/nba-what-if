# NBA What If — Frontend Upgrade Design (nba_api integration)

**Date:** 2026-04-16
**Scope:** React frontend upgrade — real play-by-play in Play Editor, real historical win rates in Stat Model
**Depends on:** nba-api-backend (must be running at localhost:5001)

---

## Overview

Replace hardcoded/CSV-derived data with live API calls to the Flask backend. Add a global season selector above the tabs. Upgrade Play Editor to show real play-by-play events with game clock. Upgrade Stat Model to show real historical win rates.

---

## Architecture

- **API communication:** `src/api/nbaApi.js` — thin fetch wrappers for each backend endpoint
- **State:** Local React state only (no Redux). Season/season-type state lifted to `App.jsx` and passed as props.
- **Vite proxy:** `/api/*` → `http://localhost:5001` in `vite.config.js`
- **Old data files:** `src/data/plays.js` deleted; `src/data/gameData.js` replaced by `src/api/nbaApi.js`; `src/data/statModel.js` kept for slider config only (formula removed)

---

## File Structure Changes

```
src/
  api/
    nbaApi.js           # fetch wrappers for all backend endpoints
  components/
    SeasonSelector.jsx  # NEW: season + season type dropdowns (shared)
    GameSelector.jsx    # NEW: game dropdown (populated from /api/games)
    PlayEditor.jsx      # REWRITE: real play-by-play, game clock x-axis
    StatModel.jsx       # UPDATE: calls /api/stats/winprob, shows match count
    TabNav.jsx          # unchanged
  data/
    statModel.js        # KEEP slider config only, remove calcWinProb/defaultValues formula
  App.jsx               # UPDATE: add season state, render SeasonSelector
```

---

## `src/api/nbaApi.js`

Thin fetch wrappers. All functions return parsed JSON or throw on error.

```js
export async function fetchSeasons() { ... }          // GET /api/seasons
export async function fetchGames(season, seasonType)  // GET /api/games
export async function fetchPlayByPlay(gameId)         // GET /api/games/:gameId/playbyplay
export async function fetchWinProb(params)            // GET /api/stats/winprob
```

---

## Global Season Selector (`SeasonSelector.jsx`)

Rendered in `App.jsx` above `TabNav`. Contains:
- Season dropdown: populated from `fetchSeasons()` on mount
- Season type dropdown: "Regular Season" / "Playoffs"

Both values stored in `App.jsx` state and passed as props to `PlayEditor` and `StatModel`.

---

## Play Editor (`PlayEditor.jsx`)

### Game Selector
`GameSelector.jsx` — separate component receiving `season` + `seasonType` as props. Calls `fetchGames(season, seasonType)` and renders a dropdown. Emits selected `gameId` to `PlayEditor`.

### Charts
- X-axis: `gameSeconds` (0–2880 for regulation, extended for OT)
- X-axis tick labels: quarter labels (Q1 at 0, Q2 at 720, Q3 at 1440, Q4 at 2160)
- Y-axis: 0–100% win probability for teamA
- `ReferenceLine` at each quarter boundary
- Original curve: precomputed `wpCurve` from API response
- What If curve: `recomputeWpCurve(plays, overrides)` — client-side, same logistic formula

### `recomputeWpCurve(plays, overrides)`
Lives in `src/api/nbaApi.js`. Takes plays array + overrides map `{ eventNum: 'Made' | 'Missed' }`. Re-runs score tracking from start, applying overrides to editable events. Returns array of `{ gameSeconds, wp }`.

### Play List (`ShotBrowser` renamed to `PlayList`)
- Shows all plays from the API, sorted by `gameSeconds` descending (latest first)
- Quarter filter buttons (All, Q1, Q2, Q3, Q4)
- Each row: `Q{n} {clock}` | description | outcome dropdown (Make/Miss) for editable events; plain text for non-editable
- Edited rows highlighted in amber
- "Reset edits" button clears overrides

---

## Stat Model (`StatModel.jsx`)

### Slider behavior
- On mount and on any slider change (debounced 300ms): calls `fetchWinProb({ season, seasonType, ...sliderValues })`
- Shows loading state while fetching
- Displays `winRate` as the large percentage (or `—` if `gamesMatched === 0`)
- Subtitle: `Based on {gamesMatched} matching games` (or `No matching games found` if 0)

### Slider config (`src/data/statModel.js`)
Keep `sliderConfig` array (key, label, min, max, default, unit, direction). Remove `calcWinProb` and `defaultValues` — state initialized from `sliderConfig` directly in `StatModel.jsx`.

---

## Vite Proxy Config (`vite.config.js`)

```js
server: {
  proxy: {
    '/api': 'http://localhost:5001'
  }
}
```

---

## Loading & Error States

- `PlayEditor`: "Loading games…" while `fetchGames` is in flight; "Loading plays…" while `fetchPlayByPlay` is in flight
- `StatModel`: shows previous win rate grayed out while debounced fetch is in flight; shows `—` on error
- Both: display a simple inline error message if the backend is unreachable (`Failed to fetch`)

---

## Out of Scope

- Persisting selected game/season across page reloads
- Player search or filtering within play list
- Mobile responsiveness
