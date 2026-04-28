async function apiFetch(path) {
  const res = await fetch(path);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `HTTP ${res.status}`);
  }
  return res.json();
}

export function fetchSeasons() {
  return apiFetch('/api/seasons');
}

export function fetchGames(season, seasonType) {
  const params = new URLSearchParams({ season, season_type: seasonType });
  return apiFetch(`/api/games?${params}`);
}

export function fetchPlayByPlay(gameId) {
  return apiFetch(`/api/games/${gameId}/playbyplay`);
}

export function fetchWinProb({ season, seasonType, threePointPct, fgPct, turnovers, rebounds, ftPct }) {
  const params = new URLSearchParams({
    season,
    season_type: seasonType,
    threePointPct,
    fgPct,
    turnovers,
    rebounds,
    ftPct,
  });
  return apiFetch(`/api/stats/winprob?${params}`);
}

export async function fetchOddsNBA() {
  const res = await fetch('/api/odds/nba');
  if (!res.ok) throw new Error(`Odds API HTTP ${res.status}`);
  return res.json();
}

export async function fetchKalshiNBAEvents(limit = 20) {
  const res = await fetch(`/api/kalshi/nba/events?limit=${limit}`);
  if (!res.ok) throw new Error(`Kalshi HTTP ${res.status}`);
  const data = await res.json();
  return data.events || [];
}

export async function fetchKalshiMarkets(eventTicker) {
  const params = new URLSearchParams({ event_ticker: eventTicker });
  const res = await fetch(`/api/kalshi/markets?${params}`);
  if (!res.ok) throw new Error(`Kalshi HTTP ${res.status}`);
  const data = await res.json();
  return data.markets || [];
}

export function recomputeWpCurve(plays, overrides, teamA, totalSeconds = 2880) {
  let scoreA = 0;
  let scoreB = 0;
  const curve = [{ gameSeconds: 0, wp: 50 }];

  for (const play of plays) {
    if (!play.editable) continue;

    const result = overrides[play.eventNum] !== undefined
      ? overrides[play.eventNum]
      : (play.shotPts > 0 ? 'Made' : 'Missed');

    if (result === 'Made' && play.shotPts > 0) {
      if (play.team === teamA) scoreA += play.shotPts;
      else scoreB += play.shotPts;
    } else if (result === 'Missed' && play.shotPts > 0 && overrides[play.eventNum] === 'Missed') {
      if (play.team === teamA) scoreA -= play.shotPts;
      else scoreB -= play.shotPts;
    }

    const remaining = Math.max(0, totalSeconds - play.gameSeconds);
    const k = 0.004 * (1 + (totalSeconds - remaining) / totalSeconds);
    const diff = scoreA - scoreB;
    const p = 1 / (1 + Math.exp(-k * diff * 100));
    curve.push({ gameSeconds: play.gameSeconds, wp: Math.round(p * 100) });
  }

  return curve;
}
