import { useState, useCallback } from 'react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ReferenceLine, ResponsiveContainer, Legend,
} from 'recharts';
import { fetchPlayByPlay } from '../api/nbaApi';
import GameSelector from './GameSelector';

const REGULATION_SECONDS = 2880;
const COLORS = ['#2563eb', '#dc2626'];

function buildPeriodBoundaries(maxQuarter) {
  const b = [
    { seconds: 0, label: 'Q1' },
    { seconds: 720, label: 'Q2' },
    { seconds: 1440, label: 'Q3' },
    { seconds: 2160, label: 'Q4' },
  ];
  for (let q = 5; q <= maxQuarter; q++) {
    b.push({ seconds: REGULATION_SECONDS + (q - 5) * 300, label: `OT${q > 5 ? q - 4 : ''}` });
  }
  return b;
}

function totalSecondsFor(maxQ) {
  return maxQ <= 4 ? REGULATION_SECONDS : REGULATION_SECONDS + (maxQ - 4) * 300;
}

// Merge two wpCurve arrays into a single data array keyed by gameSeconds
// so Recharts can render both lines from one dataset.
function mergeWpCurves(curveA, curveB) {
  const map = new Map();
  for (const pt of curveA) {
    map.set(pt.gameSeconds, { gameSeconds: pt.gameSeconds, wpA: pt.wp });
  }
  for (const pt of curveB) {
    const existing = map.get(pt.gameSeconds) ?? { gameSeconds: pt.gameSeconds };
    map.set(pt.gameSeconds, { ...existing, wpB: pt.wp });
  }
  return [...map.values()].sort((a, b) => a.gameSeconds - b.gameSeconds);
}

function GameSlot({ index, season, seasonType, game, gameId, onGameChange, loading, error }) {
  const color = COLORS[index];
  const label = index === 0 ? 'Game 1' : 'Game 2';
  return (
    <div style={slotStyles.wrapper}>
      <div style={{ ...slotStyles.badge, background: color }}>{label}</div>
      <GameSelector
        season={season}
        seasonType={seasonType}
        gameId={gameId}
        onGameChange={onGameChange}
      />
      {loading && <span style={slotStyles.status}>Loading…</span>}
      {error && <span style={slotStyles.error}>{error}</span>}
      {game && !loading && (
        <span style={slotStyles.score}>
          {game.teamA} {game.plays.at(-1)?.scoreA ?? '—'} – {game.plays.at(-1)?.scoreB ?? '—'} {game.teamB}
        </span>
      )}
    </div>
  );
}

const slotStyles = {
  wrapper: { display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap', padding: '10px 0' },
  badge: { fontSize: '11px', fontWeight: '700', color: '#fff', borderRadius: '4px', padding: '3px 8px', flexShrink: 0 },
  status: { fontSize: '12px', color: '#888' },
  error: { fontSize: '12px', color: '#dc2626' },
  score: { fontSize: '13px', color: '#555' },
};

export default function GameComparison({ season, seasonType }) {
  const [gameId1, setGameId1] = useState(null);
  const [gameId2, setGameId2] = useState(null);
  const [game1, setGame1] = useState(null);
  const [game2, setGame2] = useState(null);
  const [loading1, setLoading1] = useState(false);
  const [loading2, setLoading2] = useState(false);
  const [error1, setError1] = useState(null);
  const [error2, setError2] = useState(null);

  const loadGame = useCallback((gameId, setGame, setLoading, setError) => {
    if (!gameId) return;
    setLoading(true);
    setError(null);
    fetchPlayByPlay(gameId)
      .then((data) => { setGame(data); setLoading(false); })
      .catch((e) => { setError(e.message); setLoading(false); });
  }, []);

  const handleGame1Change = useCallback((id) => {
    setGameId1(id);
    setGame1(null);
    loadGame(id, setGame1, setLoading1, setError1);
  }, [loadGame]);

  const handleGame2Change = useCallback((id) => {
    setGameId2(id);
    setGame2(null);
    loadGame(id, setGame2, setLoading2, setError2);
  }, [loadGame]);

  const bothLoaded = game1 && game2 && !loading1 && !loading2;
  const maxQ = bothLoaded
    ? Math.max(
        ...game1.plays.map((p) => p.quarter),
        ...game2.plays.map((p) => p.quarter),
        4,
      )
    : 4;
  const boundaries = buildPeriodBoundaries(maxQ);
  const totalSeconds = totalSecondsFor(maxQ);
  const merged = bothLoaded ? mergeWpCurves(game1.wpCurve, game2.wpCurve) : [];

  function formatTick(s) {
    if (s === totalSeconds) return 'End';
    const b = [...boundaries].reverse().find((b) => s >= b.seconds);
    return b ? b.label : '';
  }

  function gameSecondsToLabel(gs) {
    if (gs >= totalSeconds) return 'End of game';
    const period = [...boundaries].reverse().find((b) => gs >= b.seconds);
    if (!period) return '';
    const pidx = boundaries.indexOf(period);
    const periodEnd = pidx + 1 < boundaries.length ? boundaries[pidx + 1].seconds : totalSeconds;
    const remaining = periodEnd - gs + period.seconds;
    const elapsed = gs - period.seconds;
    const rem = (periodEnd - period.seconds) - elapsed;
    const min = Math.floor(rem / 60);
    const sec = rem % 60;
    return `${period.label} · ${min}:${String(sec).padStart(2, '0')} left`;
  }

  const label1 = game1 ? `${game1.teamA} vs ${game1.teamB}` : 'Game 1';
  const label2 = game2 ? `${game2.teamA} vs ${game2.teamB}` : 'Game 2';

  return (
    <div>
      <div style={styles.slots}>
        <GameSlot
          index={0}
          season={season}
          seasonType={seasonType}
          game={game1}
          gameId={gameId1}
          onGameChange={handleGame1Change}
          loading={loading1}
          error={error1}
        />
        <div style={styles.slotDivider} />
        <GameSlot
          index={1}
          season={season}
          seasonType={seasonType}
          game={game2}
          gameId={gameId2}
          onGameChange={handleGame2Change}
          loading={loading2}
          error={error2}
        />
      </div>

      {!bothLoaded && (
        <p style={styles.placeholder}>
          {loading1 || loading2 ? 'Loading…' : 'Select two games above to compare their win probability curves.'}
        </p>
      )}

      {bothLoaded && (
        <div style={styles.chartPanel}>
          <h3 style={styles.chartTitle}>Win Probability Comparison</h3>
          <div style={styles.legend}>
            <span style={{ ...styles.legendDot, background: COLORS[0] }} />{label1}
            <span style={{ ...styles.legendDot, background: COLORS[1], marginLeft: '20px' }} />{label2}
          </div>
          <ResponsiveContainer width="100%" height={320}>
            <LineChart data={merged} margin={{ top: 8, right: 16, left: 0, bottom: 24 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
              <XAxis
                dataKey="gameSeconds"
                type="number"
                domain={[0, totalSeconds]}
                ticks={boundaries.map((b) => b.seconds).concat([totalSeconds])}
                tickFormatter={formatTick}
                tick={{ fontSize: 11 }}
                label={{ value: 'Game Time', position: 'insideBottom', offset: -10, fontSize: 12 }}
              />
              <YAxis
                domain={[0, 100]}
                tickFormatter={(v) => `${v}%`}
                tick={{ fontSize: 11 }}
                width={42}
              />
              <Tooltip
                content={({ active, payload, label }) => {
                  if (!active || !payload?.length) return null;
                  const timeStr = gameSecondsToLabel(label);
                  // Find the nearest merged data point to get both values
                  const pt = merged.reduce((best, d) =>
                    Math.abs(d.gameSeconds - label) < Math.abs(best.gameSeconds - label) ? d : best
                  , merged[0]);
                  return (
                    <div style={styles.tooltip}>
                      <div style={styles.tooltipTime}>{timeStr}</div>
                      <div style={{ color: COLORS[0] }}>
                        {label1}: {pt.wpA != null ? `${pt.wpA}%` : '—'}
                      </div>
                      <div style={{ color: COLORS[1] }}>
                        {label2}: {pt.wpB != null ? `${pt.wpB}%` : '—'}
                      </div>
                    </div>
                  );
                }}
              />
              {boundaries.map((b) => (
                <ReferenceLine
                  key={b.seconds}
                  x={b.seconds}
                  stroke="#ccc"
                  strokeDasharray="4 2"
                  label={{ value: b.label, position: 'top', fontSize: 10, fill: '#999' }}
                />
              ))}
              <ReferenceLine y={50} stroke="#ddd" strokeDasharray="4 2" />
              <Line type="monotone" dataKey="wpA" stroke={COLORS[0]} strokeWidth={2.5} dot={false} activeDot={{ r: 4 }} connectNulls />
              <Line type="monotone" dataKey="wpB" stroke={COLORS[1]} strokeWidth={2.5} dot={false} activeDot={{ r: 4 }} connectNulls strokeDasharray="6 3" />
            </LineChart>
          </ResponsiveContainer>
          <div style={styles.chartNote}>Solid = {label1} · Dashed = {label2} · WP shown for home team in each game</div>
        </div>
      )}
    </div>
  );
}

const styles = {
  slots: { display: 'flex', flexDirection: 'column', gap: '0', background: '#fff', borderRadius: '8px', padding: '16px 20px', boxShadow: '0 1px 3px rgba(0,0,0,0.08)', marginBottom: '20px' },
  slotDivider: { height: '1px', background: '#f0f0f0', margin: '4px 0' },
  placeholder: { color: '#999', fontSize: '14px', textAlign: 'center', padding: '40px 0' },
  chartPanel: { background: '#fff', borderRadius: '8px', padding: '20px', boxShadow: '0 1px 3px rgba(0,0,0,0.08)' },
  chartTitle: { fontSize: '15px', fontWeight: '700', color: '#1a1a1a', marginBottom: '8px' },
  legend: { display: 'flex', alignItems: 'center', fontSize: '13px', color: '#444', marginBottom: '12px' },
  legendDot: { display: 'inline-block', width: '12px', height: '12px', borderRadius: '50%', marginRight: '6px' },
  tooltip: { background: '#fff', border: '1px solid #e5e7eb', borderRadius: '6px', padding: '8px 12px', fontSize: '12px', lineHeight: '1.7' },
  tooltipTime: { fontWeight: 600, marginBottom: '2px' },
  chartNote: { fontSize: '11px', color: '#bbb', marginTop: '8px' },
};
