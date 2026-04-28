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
    sbImplied = adjHome * 100;
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