// src/utils/betAdvisor.js

/**
 * Convert American moneyline odds to raw implied probability.
 * @param {number} american
 * @returns {number} probability 0–1
 */
function rawImplied(american) {
  if (american < 0) return Math.abs(american) / (Math.abs(american) + 100);
  return 100 / (american + 100);
}

/**
 * Vig-adjust two raw probabilities so they sum to 1.
 * @param {number} p1 raw prob for side 1
 * @param {number} p2 raw prob for side 2
 * @returns {{ adj1: number, adj2: number }}
 */
function vigAdjust(p1, p2) {
  const total = p1 + p2;
  return { adj1: p1 / total, adj2: p2 / total };
}

/**
 * Compute edge between Kalshi yes price and sportsbook implied probability.
 *
 * @param {number} kalshiYesPct  Kalshi mid-price expressed as 0–100
 * @param {{ home_team: string, away_team: string, bookmakers: Array }} oddsGame
 * @param {string} kalshiYesTeam  The team name on the YES side from Kalshi (yes_sub_title)
 * @returns {{ sbImplied: number, sbEdge: number, midpointEdge: number } | null}
 *   Returns null when sportsbook data is unavailable or incomplete.
 */
export function computeEdge(kalshiYesPct, oddsGame, kalshiYesTeam) {
  if (!oddsGame || kalshiYesPct == null) return null;

  const BOOK_PRIORITY = ['draftkings', 'fanduel', 'betmgm', 'caesars', 'pointsbet', 'bovada'];
  let bm = null;
  for (const key of BOOK_PRIORITY) {
    bm = oddsGame.bookmakers?.find(b => b.key === key);
    if (bm) break;
  }
  if (!bm) bm = oddsGame.bookmakers?.[0] ?? null;
  if (!bm) return null;

  const h2h = bm.markets?.find(m => m.key === 'h2h');
  if (!h2h) return null;

  const homeOutcome = h2h.outcomes?.find(o => o.name === oddsGame.home_team);
  const awayOutcome = h2h.outcomes?.find(o => o.name === oddsGame.away_team);
  if (!homeOutcome || !awayOutcome) return null;

  const rawHome = rawImplied(homeOutcome.price);
  const rawAway = rawImplied(awayOutcome.price);
  const { adj1: adjHome, adj2: adjAway } = vigAdjust(rawHome, rawAway);

  // Determine which adjusted probability corresponds to the Kalshi YES team
  const yesTeamLower = (kalshiYesTeam ?? '').toLowerCase();
  const homeNameLower = oddsGame.home_team.toLowerCase();
  const awayNameLower = oddsGame.away_team.toLowerCase();

  let sbImplied;
  if (homeNameLower.split(' ').some(t => yesTeamLower.includes(t))) {
    sbImplied = adjHome * 100;
  } else if (awayNameLower.split(' ').some(t => yesTeamLower.includes(t))) {
    sbImplied = adjAway * 100;
  } else {
    return null;
  }

  const kalshiPct = kalshiYesPct;
  const sbEdge = sbImplied - kalshiPct;
  const midpoint = (sbImplied + kalshiPct) / 2;
  const midpointEdge = midpoint - kalshiPct;

  return { sbImplied, sbEdge, midpointEdge };
}

/**
 * @param {number} sbEdge  percentage points, e.g. 7.2 means 7.2%
 * @returns {{ label: string, color: string }}
 */
export function getRecommendation(sbEdge) {
  if (sbEdge > 8)  return { label: 'STRONG YES', color: '#1a7a41' };
  if (sbEdge > 3)  return { label: 'LEAN YES',   color: '#2563eb' };
  if (sbEdge >= -3) return { label: 'PASS',       color: '#aaa' };
  if (sbEdge >= -8) return { label: 'LEAN NO',    color: '#e67e22' };
  return               { label: 'STRONG NO',  color: '#c0392b' };
}

/**
 * Single-game Kelly fraction, capped at 0.25.
 *
 * Formula: f = (edge * (b + 1) - 1) / b  where b = payout odds on YES
 * edge here is sbEdge expressed as a fraction (e.g. 0.072 for 7.2%)
 *
 * @param {number} sbEdgePct   edge in percentage points (e.g. 7.2)
 * @param {number} kalshiYesPct  Kalshi mid-price 0–100
 * @param {number} bankroll
 * @returns {{ single: number, halfSingle: number } | null}
 *   Dollar amounts, or null if Kelly is negative (no edge).
 */
export function computeKelly(sbEdgePct, kalshiYesPct, bankroll) {
  if (sbEdgePct == null || isNaN(sbEdgePct)) return null;
  if (!bankroll || bankroll <= 0) return null;
  if (!kalshiYesPct || kalshiYesPct <= 0 || kalshiYesPct >= 100) return null;

  const p = kalshiYesPct / 100; // Kalshi implied prob of YES
  const b = (1 / p) - 1;        // payout odds: win b per $1 staked
  const edge = sbEdgePct / 100; // convert pct to fraction

  // Standard Kelly: f* = (p_true * (b+1) - 1) / b
  // p_true ≈ kalshi + edge (sportsbook as truth shifts our estimate)
  const pTrue = p + edge;
  const f = (pTrue * (b + 1) - 1) / b;

  if (f <= 0) return null; // negative Kelly = no edge, don't bet

  const capped = Math.min(f, 0.25);
  const single = Math.round(capped * bankroll);
  const halfSingle = Math.round((capped / 2) * bankroll);
  return { single, halfSingle };
}

/**
 * Portfolio Kelly: proportionally size bets across all positive-edge games
 * so total allocation never exceeds the full bankroll.
 *
 * Each game's raw Kelly fraction is computed, negatives are zeroed out,
 * then fractions are normalized so they sum to ≤ 1.0 (capped per-game at 0.25).
 *
 * @param {Array<{ sbEdgePct: number, kalshiYesPct: number }>} games
 * @param {number} bankroll
 * @returns {number[]}  Dollar allocation per game (same order as input). Zero = pass.
 */
export function computePortfolioKelly(games, bankroll) {
  if (!bankroll || bankroll <= 0) return games.map(() => 0);

  const fractions = games.map(({ sbEdgePct, kalshiYesPct }) => {
    if (sbEdgePct == null || isNaN(sbEdgePct)) return 0;
    if (!kalshiYesPct || kalshiYesPct <= 0 || kalshiYesPct >= 100) return 0;
    const p = kalshiYesPct / 100;
    const b = (1 / p) - 1;
    const pTrue = p + sbEdgePct / 100;
    const f = (pTrue * (b + 1) - 1) / b;
    return Math.max(0, Math.min(f, 0.25));
  });

  const total = fractions.reduce((s, f) => s + f, 0);
  if (total === 0) return games.map(() => 0);

  // Scale down if total > 1 so we never over-allocate
  const scale = total > 1 ? 1 / total : 1;
  return fractions.map(f => Math.round(f * scale * bankroll));
}