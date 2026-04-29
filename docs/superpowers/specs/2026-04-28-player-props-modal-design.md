# Player Props Modal — Design Spec
**Date:** 2026-04-28
**Status:** Approved

---

## Overview

Add a "View Props" button to each active game card on the Kalshi Markets page. Clicking it opens a modal showing Kalshi player prop markets for that game, organized by stat type in tabs. Only active markets are shown. No sportsbook odds in this version.

---

## Prop Series

Five series, fetched on demand per tab:

| Tab Label | Kalshi Series Ticker |
|-----------|----------------------|
| Points    | `KXNBAPTS`           |
| Rebounds  | `KXNBAREB`           |
| Assists   | `KXNBAAST`           |
| Threes    | `KXNBA3PT`           |
| PRA       | `KXNBAPRA`           |

---

## Game Suffix Extraction

Each game's Kalshi event ticker has the form `KXNBAGAME-26APR30DENMIN`. The suffix (`26APR30DENMIN`) is shared across all prop series for that game:

```
KXNBAPTS-26APR30DENMIN
KXNBAREB-26APR30DENMIN
...
```

Extraction: `event.event_ticker.split('-').slice(1).join('-')`

---

## Backend

**New route:** `GET /api/kalshi/props`

**Params:**
- `game_suffix` — e.g. `26APR30DENMIN`
- `series` — e.g. `KXNBAPTS`

**Behavior:**
- Constructs event ticker: `{series}-{game_suffix}`
- Fetches markets from Kalshi: `GET /trade-api/v2/markets?event_ticker={ticker}&limit=50`
- Filters to `status === 'active'` markets only
- Returns `{ markets: [...] }`

**Error handling:**
- Missing params → 400
- Kalshi fetch fails → 503

---

## Frontend

### "View Props" Button

Added at the bottom of each `GameCard`, below `AdvisorSection`. Styled as a small secondary button. On click: sets modal open with that event's data.

### `PropsModal` Component

Defined inside `KalshiMarkets.jsx`. State lives inside `GameCard`:
- `modalOpen` (boolean)
- `activeTab` (string, default `'KXNBAPTS'`)
- `propsByTab` (object: `{ [series]: markets[] }`)

**Layout:**
- Full-screen backdrop (semi-transparent dark overlay), closes on click
- Centered white panel, max-width 640px, max-height 80vh, scrollable
- Header: game title + X close button
- 5 tabs: Points | Rebounds | Assists | Threes | PRA
- Active tab underlined, switching fetches that series if not yet cached in `propsByTab`
- Prop rows: player name (left) + probability bar (center) + mid-price in ¢ (right)
- Same bar/color pattern as existing game market rows (`pctColor`)
- Loading state: "Loading…" shown while fetch in progress per tab
- Empty state: "No active markets" if fetch returns empty array

### Data fetching

On tab switch, if `propsByTab[series]` is undefined, fetch `/api/kalshi/props?game_suffix=...&series=...`. Cache result in `propsByTab`. Already-loaded tabs never re-fetch.

Mid-price: `Math.round((yes_ask_dollars + yes_bid_dollars) / 2 * 100)`

---

## New API helper

Add `fetchKalshiProps(gameSuffix, series)` to `src/api/nbaApi.js`:

```js
export async function fetchKalshiProps(gameSuffix, series) {
  const params = new URLSearchParams({ game_suffix: gameSuffix, series });
  const res = await fetch(`/api/kalshi/props?${params}`);
  if (!res.ok) throw new Error(`Kalshi props HTTP ${res.status}`);
  const data = await res.json();
  return data.markets || [];
}
```

---

## Out of Scope

- DraftKings / sportsbook odds for props
- Bet advisor / Kelly sizing for props
- Combo display of multiple stat types at once
- Steals (`KXNBASTL`), Blocks (`KXNBABLK`), and combo props beyond PRA
