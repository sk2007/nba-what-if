# Kalshi Bet Advisor — Design Spec
**Date:** 2026-04-28
**Status:** Approved

---

## Overview

Extend the Kalshi Markets page to advise users on bet sizing and direction by computing the edge between Kalshi prediction market prices and sportsbook implied probabilities, then applying Kelly Criterion to recommend allocations.

---

## Edge Calculation

For each game, two edge values are computed:

**Sportsbook edge** (primary signal):
```
edge = sportsbook_implied_pct - kalshi_yes_pct
```
- Positive → Kalshi underprices YES (value on YES)
- Negative → Kalshi overprices YES (value on NO)

**Midpoint edge** (secondary signal):
```
midpoint = (sportsbook_implied_pct + kalshi_yes_pct) / 2
midpoint_edge = midpoint - kalshi_yes_pct
```
Shown alongside sportsbook edge so users can see where they land if they trust neither source completely.

**Sportsbook implied probability conversion** from American odds, vig-adjusted:
- Favorite (negative odds): `raw = 100 / (|odds| + 100)`
- Underdog (positive odds): `raw = odds / (odds + 100)`
- Vig adjustment: normalize both sides so they sum to 1.0

---

## Kelly Criterion & Bet Sizing

### Single-game mode
```
f = (edge * (b + 1) - 1) / b
```
Where `b = (1 / kalshi_yes_price) - 1` (payout odds on YES).

- Capped at 25% of bankroll
- Half-Kelly shown as the conservative recommendation
- Applied independently per game

### Portfolio mode
Fractional Kelly across all open markets simultaneously:
- Each game's allocation is computed relative to the others
- Total allocation across all bets capped at 100% of bankroll
- Prevents over-allocation when multiple edges exist on the same slate

### Recommendation badges
Based on sportsbook-as-truth edge:

| Edge | Badge |
|------|-------|
| > +8% | `STRONG YES` (green) |
| +3% to +8% | `LEAN YES` (green) |
| -3% to +3% | `PASS` (gray) |
| -3% to -8% | `LEAN NO` (red) |
| < -8% | `STRONG NO` (red) |

---

## UI Layout

### Bankroll input panel
Positioned above the game grid:
- Number input: "Your bankroll: $____"
- Toggle: **Single-game mode** / **Portfolio mode**
- Summary line (when bankroll entered): "3 edges detected tonight — recommended total allocation: $240 (24% of bankroll)"

### Per-card additions (below existing odds section)
1. **Recommendation badge** — colored pill (green/red/gray)
2. **Edge line** — "Sportsbook edge: +7.2% | Midpoint edge: +3.6%"
3. **Kelly sizing** — "Single-game: $48 (half-Kelly: $24)" or "Portfolio allocation: $31" depending on mode
4. **Plain-English rationale** — e.g. "Kalshi underprices Cleveland at 60¢ vs 67% sportsbook implied. Lean YES."

### No bankroll entered
- Badges and edge lines are always visible
- Kelly sizing section hidden
- Subtle prompt: "Enter bankroll above to see bet sizing."

---

## Data Flow

```
KalshiMarkets (state)
  ├── bankroll (number | null)
  ├── mode ('single' | 'portfolio')
  └── per event:
       ├── kalshi markets (yes_ask, yes_bid)
       ├── oddsGame (sportsbook h2h)
       └── computed: edge, kellyFraction, recommendation

computeEdge(kalshiPct, oddsGame) → { sbEdge, midpointEdge, sbImplied }
computeKelly(edge, kalshiPrice, bankroll, mode, allEdges) → { single, halfSingle, portfolio }
getRecommendation(sbEdge) → { label, direction, color }
```

Pure utility functions, no side effects — computed inline during render from existing state.

---

## Error Handling

- No sportsbook data → edge/badge hidden, card renders normally
- Kalshi price = 0 or missing → skip Kelly, show "Insufficient market data"
- Negative Kelly (no edge) → show PASS badge, hide sizing
- Bankroll = 0 or invalid → treat as no bankroll entered

---

## Out of Scope

- Bankroll persistence (localStorage) — per-session only for now
- Historical edge tracking
- Push notifications or alerts
- Multi-leg/parlay sizing
