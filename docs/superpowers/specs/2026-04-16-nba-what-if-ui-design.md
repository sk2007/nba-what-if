# NBA What If — Static UI Mockup Design

**Date:** 2026-04-16  
**Scope:** Static React mockup (no backend, no real ML model)  
**Tech Stack:** Vite + React, Recharts, hardcoded data

---

## Overview

A single-page React app with two tabs:
1. **Play Editor** — side-by-side win probability charts comparing original vs. edited game scenarios
2. **Stat Model** — sliders for key stats that update a live win probability estimate

---

## Architecture

- **Framework:** Vite + React (no routing library)
- **Charts:** Recharts
- **State:** Local React state only (no Redux, no Context needed)
- **Data:** Hardcoded in `src/data/` — one file for play-by-play curves, one for stat model config
- **No backend** — all logic runs in the browser

### File Structure

```
src/
  data/
    plays.js          # Hardcoded play list + win probability curves (original + what-if variants)
    statModel.js      # Slider config and win probability formula
  components/
    TabNav.jsx        # Tab switcher (Play Editor / Stat Model)
    PlayEditor.jsx    # Side-by-side chart + play list
    StatModel.jsx     # Sliders + win probability display
  App.jsx
  main.jsx
```

---

## Tab 1: Play Editor

### Layout
Two side-by-side panels, each containing a Recharts `LineChart`.

- **Left panel — "Original"**: Win probability curve for Team A over 48 minutes of game time, with annotations at key inflection plays
- **Right panel — "What If"**: Starts identical to the original; swaps to an alternate hardcoded curve when the user edits a play

### Play List
Below both charts: a list of ~5 hardcoded plays. Each row shows:
- Time (e.g., "Q4 2:30")
- Description (e.g., "Missed free throw — LeBron James")
- Dropdown to change outcome (e.g., "Missed" → "Made")

Selecting a different outcome swaps the right panel's curve to the corresponding pre-built "what if" dataset.

### Chart Specs
- Y-axis: 0–100% (Team A win probability)
- X-axis: Game time in minutes (0–48), divided by quarter
- Both charts share the same axis scale for easy visual comparison
- Each chart has a title ("Original" / "What If Scenario")

### Data Shape (`src/data/plays.js`)
```js
export const originalCurve = [ { minute: 0, prob: 50 }, ... ]; // ~50 data points
export const plays = [
  {
    id: 1,
    time: "Q4 2:30",
    description: "Missed free throw — LeBron James",
    outcomes: ["Missed", "Made"],
    whatIfCurves: {
      Missed: originalCurve,
      Made: [ { minute: 0, prob: 50 }, ... ], // alternate curve
    }
  },
  // ...4 more plays
];
```

---

## Tab 2: Stat Model

### Layout
Single panel with:
- 5 labeled sliders at the top
- Large win probability percentage in the center
- Brief explanatory label below

### Sliders
| Stat | Range | Default |
|------|-------|---------|
| 3-Point % | 0–100 | 35 |
| Field Goal % | 0–100 | 45 |
| Turnovers | 0–30 | 14 |
| Rebounds | 0–60 | 40 |
| Free Throw % | 0–100 | 75 |

Each slider displays its current value inline (e.g., "3-Point %: 38%").

### Win Probability Formula
A deterministic JS function in `src/data/statModel.js` — weighted sum of normalized stats, clamped to 0–100%. Not a real model; designed to produce plausible-looking output.

```js
export function calcWinProb({ threePointPct, fgPct, turnovers, rebounds, ftPct }) {
  // weights tuned so average inputs produce ~50%
}
```

### Display
- Large bold percentage (e.g., "63%") centered on the panel
- Label: "Estimated win probability based on stat thresholds"
- Updates live as any slider moves

---

## Out of Scope (for this mockup)
- Backend / API calls
- Real NBA data ingestion
- Actual ML win probability model
- User accounts or persistence
- Mobile responsiveness (desktop-only for now)
