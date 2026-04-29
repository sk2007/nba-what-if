# Props Modal Accordion Design

**Date:** 2026-04-28  
**Status:** Approved  

## Problem

The player props modal displays every market as a flat list — every player and every line threshold gets its own row. With 5+ players and 5+ lines each, the list is overwhelming to scan.

## Goal

Group lines under each player in a collapsible accordion. Players start collapsed; clicking a player header expands their lines and collapses any other open player.

## Approach

Parse player name from `yes_sub_title` by splitting on `": "` (e.g. `"Jonathan Kuminga: 4+"` → `"Jonathan Kuminga"`). No server changes needed.

## Data Grouping

Inside `PropsModal`, after fetching markets for the active tab, group into an ordered array:

```
[ { player: "Jonathan Kuminga", lines: [market, market, ...] }, ... ]
```

Order matches the order Kalshi returns markets. No sorting applied.

## Accordion UI

- Each player renders a **header row**: player name on the left, chevron (`▶` collapsed / `▼` expanded) on the right.
- Single state variable `openPlayer` (string | null) tracks which player is open.
- Clicking a header sets `openPlayer` to that player's name, or `null` if they were already open (toggle).
- Only one player can be open at a time (accordion).
- When expanded, lines render beneath the header using the existing bar + price display, with slight left indentation.

## State

- `openPlayer` lives in `PropsModal`.
- Reset to `null` on active tab change (different tabs have different player sets).
- `propsByTab` caching behavior is unchanged.

## Files Changed

- `src/components/KalshiMarkets.jsx` — `PropsModal` component only. No other components or files touched.
