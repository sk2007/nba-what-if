import { useState, useEffect, useCallback } from 'react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ReferenceLine, ResponsiveContainer,
} from 'recharts';
import { fetchPlayByPlay, recomputeWpCurve } from '../api/nbaApi';
import GameSelector from './GameSelector';

const QUARTER_BOUNDARIES = [
  { seconds: 0, label: 'Q1' },
  { seconds: 720, label: 'Q2' },
  { seconds: 1440, label: 'Q3' },
  { seconds: 2160, label: 'Q4' },
];

function WinProbChart({ data, title, color, teamA }) {
  return (
    <div style={styles.chartPanel}>
      <h3 style={styles.chartTitle}>{title}</h3>
      <ResponsiveContainer width="100%" height={260}>
        <LineChart data={data} margin={{ top: 8, right: 16, left: 0, bottom: 16 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
          <XAxis
            dataKey="gameSeconds"
            type="number"
            domain={[0, 'dataMax']}
            label={{ value: 'Game Time (s)', position: 'insideBottom', offset: -8, fontSize: 12 }}
            ticks={[0, 720, 1440, 2160, 2880]}
            tickFormatter={(s) => {
              const q = QUARTER_BOUNDARIES.slice().reverse().find((b) => s >= b.seconds);
              return q ? q.label : '';
            }}
            tick={{ fontSize: 11 }}
          />
          <YAxis
            domain={[0, 100]}
            tickFormatter={(v) => `${v}%`}
            tick={{ fontSize: 11 }}
            width={42}
          />
          <Tooltip
            formatter={(v) => [`${v}%`, `${teamA} Win Prob`]}
            labelFormatter={(s) => {
              const min = Math.floor(s / 60);
              const sec = s % 60;
              return `${min}:${String(sec).padStart(2, '0')}`;
            }}
          />
          {QUARTER_BOUNDARIES.map((b) => (
            <ReferenceLine
              key={b.seconds}
              x={b.seconds}
              stroke="#ccc"
              strokeDasharray="4 2"
              label={{ value: b.label, position: 'top', fontSize: 10, fill: '#999' }}
            />
          ))}
          <ReferenceLine y={50} stroke="#ddd" strokeDasharray="4 2" />
          <Line type="monotone" dataKey="wp" stroke={color} strokeWidth={2.5} dot={false} activeDot={{ r: 4 }} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export default function PlayEditor({ season, seasonType }) {
  const [gameId, setGameId] = useState(null);
  const [game, setGame] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [overrides, setOverrides] = useState({});
  const [quarterFilter, setQuarterFilter] = useState('all');

  useEffect(() => {
    setGameId(null);
    setGame(null);
    setOverrides({});
  }, [season, seasonType]);

  useEffect(() => {
    if (!gameId) return;
    setLoading(true);
    setError(null);
    setOverrides({});
    fetchPlayByPlay(gameId)
      .then((data) => { setGame(data); setLoading(false); })
      .catch((e) => { setError(e.message); setLoading(false); });
  }, [gameId]);

  const handleOverride = useCallback((eventNum, result) => {
    setOverrides((prev) => {
      const next = { ...prev };
      const play = game?.plays.find((p) => p.eventNum === eventNum);
      const originalResult = play?.shotPts > 0 ? 'Made' : 'Missed';
      if (result === originalResult) {
        delete next[eventNum];
      } else {
        next[eventNum] = result;
      }
      return next;
    });
  }, [game]);

  const hasOverrides = Object.keys(overrides).length > 0;
  const totalSeconds = game ? Math.max(2880, ...(game.plays.map((p) => p.gameSeconds))) : 2880;
  const whatIfCurve = game ? recomputeWpCurve(game.plays, overrides, game.teamA, totalSeconds) : [];

  const quarters = game ? [...new Set(game.plays.map((p) => p.quarter))].sort((a, b) => a - b) : [];
  const filteredPlays = game
    ? (quarterFilter === 'all' ? game.plays : game.plays.filter((p) => p.quarter === Number(quarterFilter)))
        .slice().sort((a, b) => b.gameSeconds - a.gameSeconds)
    : [];

  return (
    <div>
      <div style={styles.selectorRow}>
        <GameSelector
          season={season}
          seasonType={seasonType}
          gameId={gameId}
          onGameChange={setGameId}
        />
        {hasOverrides && (
          <button onClick={() => setOverrides({})} style={styles.resetBtn}>
            Reset edits ({Object.keys(overrides).length})
          </button>
        )}
      </div>

      {loading && <p style={styles.status}>Loading play-by-play…</p>}
      {error && <p style={styles.errorText}>Error: {error}</p>}

      {game && !loading && (
        <>
          <p style={styles.subtitle}>
            {game.teamA} Win Probability · {game.teamA} {game.plays.at(-1)?.scoreA ?? '—'} – {game.plays.at(-1)?.scoreB ?? '—'} {game.teamB}
          </p>
          <div style={styles.chartsRow}>
            <WinProbChart data={game.wpCurve} title="Original" color="#2563eb" teamA={game.teamA} />
            <WinProbChart
              data={whatIfCurve}
              title={hasOverrides ? `What If (${Object.keys(overrides).length} edit${Object.keys(overrides).length > 1 ? 's' : ''})` : 'What If (no edits yet)'}
              color="#dc2626"
              teamA={game.teamA}
            />
          </div>

          <div style={styles.playList}>
            <div style={styles.playListHeader}>
              <h3 style={styles.playListTitle}>Play-by-Play</h3>
              <span style={styles.hint}>{game.plays.length} events · editable events have outcome dropdowns</span>
            </div>

            <div style={styles.filterRow}>
              <label style={styles.filterLabel}>Quarter:</label>
              {['all', ...quarters].map((q) => (
                <button
                  key={q}
                  onClick={() => setQuarterFilter(String(q))}
                  style={{ ...styles.filterBtn, ...(quarterFilter === String(q) ? styles.filterBtnActive : {}) }}
                >
                  {q === 'all' ? 'All' : `Q${q}`}
                </button>
              ))}
            </div>

            <div style={styles.table}>
              <div style={styles.tableHeader}>
                <span style={{ width: 80 }}>Time</span>
                <span style={{ flex: 1 }}>Description</span>
                <span style={{ width: 100 }}>Outcome</span>
              </div>
              {filteredPlays.map((play) => {
                const isEdited = overrides[play.eventNum] !== undefined;
                const currentResult = overrides[play.eventNum] ?? (play.shotPts > 0 ? 'Made' : 'Missed');
                return (
                  <div key={play.eventNum} style={{ ...styles.tableRow, ...(isEdited ? styles.tableRowEdited : {}) }}>
                    <span style={styles.timeCell}>Q{play.quarter} {play.clock}</span>
                    <span style={styles.descCell}>{play.description || '—'}</span>
                    <span style={{ width: 100 }}>
                      {play.editable ? (
                        <select
                          value={currentResult}
                          onChange={(e) => handleOverride(play.eventNum, e.target.value)}
                          style={{ ...styles.outcomeSelect, ...(isEdited ? styles.outcomeSelectEdited : {}) }}
                        >
                          <option value="Made">Made</option>
                          <option value="Missed">Missed</option>
                        </select>
                      ) : (
                        <span style={styles.nonEditable}>—</span>
                      )}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

const styles = {
  selectorRow: { display: 'flex', gap: '16px', alignItems: 'flex-end', marginBottom: '16px', flexWrap: 'wrap' },
  resetBtn: { padding: '7px 14px', borderRadius: '6px', border: '1px solid #dc2626', background: '#fff', color: '#dc2626', fontSize: '13px', cursor: 'pointer', alignSelf: 'flex-end' },
  status: { color: '#888', fontSize: '14px', padding: '32px 0', textAlign: 'center' },
  errorText: { color: '#dc2626', fontSize: '13px', padding: '12px 0' },
  subtitle: { fontSize: '13px', color: '#666', marginBottom: '16px' },
  chartsRow: { display: 'flex', gap: '16px', marginBottom: '24px' },
  chartPanel: { flex: 1, background: '#fff', borderRadius: '8px', padding: '16px', boxShadow: '0 1px 3px rgba(0,0,0,0.08)' },
  chartTitle: { fontSize: '15px', fontWeight: '600', marginBottom: '12px', color: '#1a1a1a' },
  playList: { background: '#fff', borderRadius: '8px', padding: '20px', boxShadow: '0 1px 3px rgba(0,0,0,0.08)' },
  playListHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' },
  playListTitle: { fontSize: '14px', fontWeight: '600', color: '#1a1a1a' },
  hint: { fontSize: '12px', color: '#999' },
  filterRow: { display: 'flex', gap: '6px', alignItems: 'center', marginBottom: '10px' },
  filterLabel: { fontSize: '11px', fontWeight: '600', color: '#888', textTransform: 'uppercase', letterSpacing: '0.05em' },
  filterBtn: { padding: '4px 10px', borderRadius: '4px', border: '1px solid #e0e0e0', background: '#fafafa', fontSize: '12px', cursor: 'pointer', color: '#555' },
  filterBtnActive: { background: '#1a1a1a', color: '#fff', border: '1px solid #1a1a1a' },
  table: { maxHeight: '400px', overflowY: 'auto' },
  tableHeader: { display: 'flex', gap: '8px', padding: '6px 8px', background: '#f5f5f5', borderRadius: '4px', fontSize: '11px', fontWeight: '600', color: '#888', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '2px', position: 'sticky', top: 0 },
  tableRow: { display: 'flex', gap: '8px', alignItems: 'center', padding: '6px 8px', borderBottom: '1px solid #f5f5f5' },
  tableRowEdited: { background: '#fff8f0' },
  timeCell: { width: 80, fontSize: '12px', color: '#666', fontWeight: '600', flexShrink: 0 },
  descCell: { flex: 1, fontSize: '13px', color: '#1a1a1a' },
  outcomeSelect: { padding: '3px 6px', borderRadius: '4px', border: '1px solid #d0d0d0', fontSize: '12px', cursor: 'pointer', background: '#fafafa', width: '80px' },
  outcomeSelectEdited: { border: '1px solid #f59e0b', background: '#fffbeb' },
  nonEditable: { color: '#ccc', fontSize: '13px' },
};
