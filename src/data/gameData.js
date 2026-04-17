// Fetches the pre-built game index (lightweight) and per-year game data (on demand).
// The index maps year → [{ gameId, teamA, teamB, finalScoreA, finalScoreB }].
// Per-year files map gameId → { teamA, teamB, shots, wpCurve, finalScoreA, finalScoreB }.

let indexCache = null;
const yearCache = {};

export async function fetchIndex() {
  if (indexCache) return indexCache;
  const res = await fetch('/data/index.json');
  const raw = await res.json();
  // Normalize keys to numbers for consistent lookup
  indexCache = Object.fromEntries(Object.entries(raw).map(([k, v]) => [Number(k), v]));
  return indexCache;
}

export async function fetchYear(year) {
  if (yearCache[year]) return yearCache[year];
  const res = await fetch(`/data/games-${year}.json`);
  yearCache[year] = await res.json();
  return yearCache[year];
}

// Returns the game object for a given year + gameId.
export async function fetchGame(year, gameId) {
  const yearData = await fetchYear(year);
  return yearData[gameId];
}

// Recompute a win probability curve given a modified shots array.
// shots: array of { result, pts (original), type, ... }
// overrides: { [shotIndex]: 'Make' | 'Miss' }
export function recomputeWpCurve(shots, overrides = {}) {
  let sA = 0, sB = 0;
  const total = shots.length;
  const teamA = shots[0]?.team;

  const curve = [{ idx: -1, wp: 50 }];

  for (let i = 0; i < total; i++) {
    const shot = shots[i];
    const result = overrides[i] !== undefined ? overrides[i] : shot.result;
    const pts = shot.type === '3 Pt' ? 3 : 2;
    const made = result === 'Make';

    if (made) {
      if (shot.team === teamA) sA += pts;
      else sB += pts;
    }

    const shotsLeft = total - i - 1;
    const scoreDiff = sA - sB;
    const k = 0.15 / Math.sqrt(shotsLeft + 1);
    const p = 1 / (1 + Math.exp(-k * scoreDiff * 10));
    curve.push({ idx: i, wp: Math.round(p * 100) });
  }

  return curve;
}
