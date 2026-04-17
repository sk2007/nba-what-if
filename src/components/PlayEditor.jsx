import { useState, useEffect, useCallback } from 'react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
  ResponsiveContainer,
} from 'recharts';
import { fetchIndex, fetchGame, recomputeWpCurve } from '../data/gameData';

const YEARS = [2024, 2023, 2022, 2021, 2020, 2019, 2018, 2017, 2016, 2015];

function WinProbChart({ data, title, color, teamA }) {
  return (
    <div style={styles.chartPanel}>
      <h3 style={styles.chartTitle}>{title}</h3>
      <ResponsiveContainer width="100%" height={260}>
        <LineChart data={data} margin={{ top: 8, right: 16, left: 0, bottom: 16 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
          <XAxis
            dataKey="idx"
            label={{ value: 'Shot #', position: 'insideBottom', offset: -8, fontSize: 12 }}
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
            labelFormatter={(l) => l === -1 ? 'Start' : `Shot #${l + 1}`}
          />
          <ReferenceLine y={50} stroke="#ddd" strokeDasharray="4 2" />
          <Line
            type="monotone"
            dataKey="wp"
            stroke={color}
            strokeWidth={2.5}
            dot={false}
            activeDot={{ r: 4 }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export default function PlayEditor() {
  const [index, setIndex] = useState(null);
  const [year, setYear] = useState(2024);
  const [gameId, setGameId] = useState(null);
  const [game, setGame] = useState(null);
  const [loading, setLoading] = useState(false);
  const [overrides, setOverrides] = useState({});

  // Load index on mount
  useEffect(() => {
    fetchIndex().then((idx) => {
      setIndex(idx);
      // Default to first game of default year
      const first = idx[2024]?.[0];
      if (first) setGameId(first.gameId);
    });
  }, []);

  // Load game data when year or gameId changes
  useEffect(() => {
    if (!gameId) return;
    setLoading(true);
    setOverrides({});
    fetchGame(year, gameId).then((g) => {
      setGame(g);
      setLoading(false);
    });
  }, [year, gameId]);

  const handleYearChange = useCallback((e) => {
    const y = Number(e.target.value);
    setYear(y);
    setGame(null);
    setGameId(null);
    // Pick first game of new year from index
    fetchIndex().then((idx) => {
      const first = idx[y]?.[0];
      if (first) setGameId(first.gameId);
    });
  }, []);

  const handleGameChange = useCallback((e) => {
    setGameId(e.target.value);
  }, []);

  const handleOverride = useCallback((shotIdx, result) => {
    setOverrides((prev) => {
      const next = { ...prev };
      // If reverting to original, remove the override
      if (game && game.shots[shotIdx]?.result === result) {
        delete next[shotIdx];
      } else {
        next[shotIdx] = result;
      }
      return next;
    });
  }, [game]);

  const whatIfCurve = game ? recomputeWpCurve(game.shots, overrides) : [];
  const hasOverrides = Object.keys(overrides).length > 0;

  // For the play list, show shots that were overridden + nearby context
  // When no overrides, show the last 10 shots of the game as a sample
  const displayShots = game
    ? hasOverrides
      ? game.shots.filter((s) => overrides[s.i] !== undefined)
      : game.shots.slice(-10)
    : [];

  const gameList = index ? (index[year] || []) : [];

  return (
    <div>
      {/* Game selector */}
      <div style={styles.selectorRow}>
        <div style={styles.selectorGroup}>
          <label style={styles.label}>Season</label>
          <select value={year} onChange={handleYearChange} style={styles.select}>
            {YEARS.map((y) => (
              <option key={y} value={y}>{y} Playoffs</option>
            ))}
          </select>
        </div>
        <div style={styles.selectorGroup}>
          <label style={styles.label}>Game</label>
          <select value={gameId || ''} onChange={handleGameChange} style={styles.selectWide} disabled={!index}>
            {gameList.map((g) => (
              <option key={g.gameId} value={g.gameId}>
                {g.teamA} vs {g.teamB} ({g.finalScoreA}–{g.finalScoreB})
              </option>
            ))}
          </select>
        </div>
        {hasOverrides && (
          <button onClick={() => setOverrides({})} style={styles.resetBtn}>
            Reset edits
          </button>
        )}
      </div>

      {loading && <p style={styles.loading}>Loading game data…</p>}

      {game && !loading && (
        <>
          <p style={styles.subtitle}>
            {game.teamA} Win Probability · {game.teamA} {game.finalScoreA} – {game.finalScoreB} {game.teamB} · Shot-by-shot
          </p>
          <div style={styles.chartsRow}>
            <WinProbChart
              data={game.wpCurve}
              title="Original"
              color="#2563eb"
              teamA={game.teamA}
            />
            <WinProbChart
              data={whatIfCurve}
              title={hasOverrides ? `What If (${Object.keys(overrides).length} edit${Object.keys(overrides).length > 1 ? 's' : ''})` : 'What If (no edits yet)'}
              color="#dc2626"
              teamA={game.teamA}
            />
          </div>

          <div style={styles.playList}>
            <div style={styles.playListHeader}>
              <h3 style={styles.playListTitle}>
                {hasOverrides ? 'Edited shots' : 'Last 10 shots of game (flip any outcome to see what-if)'}
              </h3>
              <span style={styles.playListHint}>
                {game.shots.length} total shots in this game
              </span>
            </div>

            {/* Shot browser: show all shots grouped by quarter */}
            <ShotBrowser shots={game.shots} overrides={overrides} onOverride={handleOverride} />
          </div>
        </>
      )}
    </div>
  );
}

function ShotBrowser({ shots, overrides, onOverride }) {
  const [quarterFilter, setQuarterFilter] = useState('all');
  const quarters = [...new Set(shots.map((s) => s.quarter))].sort((a, b) => a - b);

  const filtered = (quarterFilter === 'all'
    ? shots
    : shots.filter((s) => s.quarter === Number(quarterFilter))
  ).slice().sort((a, b) => b.quarter !== a.quarter ? b.quarter - a.quarter : b.i - a.i);

  return (
    <div>
      <div style={styles.filterRow}>
        <label style={styles.label}>Quarter:</label>
        {['all', ...quarters].map((q) => (
          <button
            key={q}
            onClick={() => setQuarterFilter(q)}
            style={{
              ...styles.filterBtn,
              ...(quarterFilter === String(q) ? styles.filterBtnActive : {}),
            }}
          >
            {q === 'all' ? 'All' : `Q${q}`}
          </button>
        ))}
      </div>

      <div style={styles.shotTable}>
        <div style={styles.shotTableHeader}>
          <span style={{ width: 40 }}>#</span>
          <span style={{ width: 30 }}>Q</span>
          <span style={{ flex: 1 }}>Player</span>
          <span style={{ width: 120 }}>Type</span>
          <span style={{ width: 100 }}>Outcome</span>
        </div>
        {filtered.map((shot) => {
          const currentResult = overrides[shot.i] !== undefined ? overrides[shot.i] : shot.result;
          const isEdited = overrides[shot.i] !== undefined;
          return (
            <div
              key={shot.i}
              style={{
                ...styles.shotRow,
                ...(isEdited ? styles.shotRowEdited : {}),
              }}
            >
              <span style={{ width: 40, color: '#999', fontSize: 11 }}>{shot.i + 1}</span>
              <span style={{ width: 30, fontSize: 12 }}>Q{shot.quarter}</span>
              <span style={{ flex: 1, fontSize: 13 }}>
                <span style={{ fontSize: 11, color: '#888', marginRight: 4 }}>
                  {shot.team.split(' ').pop()}
                </span>
                {shot.player}
              </span>
              <span style={{ width: 120, fontSize: 12, color: '#555' }}>
                {shot.type === '3 Pt' ? '3-pointer' : shot.type === 'Over 10 ft 2 Pt' ? 'Mid-range' : 'Close 2pt'}
              </span>
              <span style={{ width: 100 }}>
                <select
                  value={currentResult}
                  onChange={(e) => onOverride(shot.i, e.target.value)}
                  style={{
                    ...styles.outcomeSelect,
                    ...(isEdited ? styles.outcomeSelectEdited : {}),
                  }}
                >
                  <option value="Make">Make</option>
                  <option value="Miss">Miss</option>
                </select>
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

const styles = {
  selectorRow: {
    display: 'flex',
    gap: '16px',
    alignItems: 'flex-end',
    marginBottom: '16px',
    flexWrap: 'wrap',
  },
  selectorGroup: {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
  },
  label: {
    fontSize: '11px',
    fontWeight: '600',
    color: '#888',
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
  },
  select: {
    padding: '7px 10px',
    borderRadius: '6px',
    border: '1px solid #d0d0d0',
    fontSize: '13px',
    cursor: 'pointer',
    background: '#fafafa',
  },
  selectWide: {
    padding: '7px 10px',
    borderRadius: '6px',
    border: '1px solid #d0d0d0',
    fontSize: '13px',
    cursor: 'pointer',
    background: '#fafafa',
    minWidth: '300px',
  },
  resetBtn: {
    padding: '7px 14px',
    borderRadius: '6px',
    border: '1px solid #dc2626',
    background: '#fff',
    color: '#dc2626',
    fontSize: '13px',
    cursor: 'pointer',
    alignSelf: 'flex-end',
  },
  loading: {
    color: '#888',
    fontSize: '14px',
    padding: '32px 0',
    textAlign: 'center',
  },
  subtitle: {
    fontSize: '13px',
    color: '#666',
    marginBottom: '16px',
  },
  chartsRow: {
    display: 'flex',
    gap: '16px',
    marginBottom: '24px',
  },
  chartPanel: {
    flex: 1,
    background: '#fff',
    borderRadius: '8px',
    padding: '16px',
    boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
  },
  chartTitle: {
    fontSize: '15px',
    fontWeight: '600',
    marginBottom: '12px',
    color: '#1a1a1a',
  },
  playList: {
    background: '#fff',
    borderRadius: '8px',
    padding: '20px',
    boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
  },
  playListHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '16px',
  },
  playListTitle: {
    fontSize: '14px',
    fontWeight: '600',
    color: '#1a1a1a',
  },
  playListHint: {
    fontSize: '12px',
    color: '#999',
  },
  filterRow: {
    display: 'flex',
    gap: '6px',
    alignItems: 'center',
    marginBottom: '12px',
  },
  filterBtn: {
    padding: '4px 10px',
    borderRadius: '4px',
    border: '1px solid #e0e0e0',
    background: '#fafafa',
    fontSize: '12px',
    cursor: 'pointer',
    color: '#555',
  },
  filterBtnActive: {
    background: '#1a1a1a',
    color: '#fff',
    border: '1px solid #1a1a1a',
  },
  shotTable: {
    maxHeight: '360px',
    overflowY: 'auto',
  },
  shotTableHeader: {
    display: 'flex',
    gap: '8px',
    padding: '6px 8px',
    background: '#f5f5f5',
    borderRadius: '4px',
    fontSize: '11px',
    fontWeight: '600',
    color: '#888',
    textTransform: 'uppercase',
    letterSpacing: '0.04em',
    marginBottom: '2px',
    position: 'sticky',
    top: 0,
  },
  shotRow: {
    display: 'flex',
    gap: '8px',
    alignItems: 'center',
    padding: '6px 8px',
    borderBottom: '1px solid #f5f5f5',
  },
  shotRowEdited: {
    background: '#fff8f0',
  },
  outcomeSelect: {
    padding: '3px 6px',
    borderRadius: '4px',
    border: '1px solid #d0d0d0',
    fontSize: '12px',
    cursor: 'pointer',
    background: '#fafafa',
    width: '80px',
  },
  outcomeSelectEdited: {
    border: '1px solid #f59e0b',
    background: '#fffbeb',
  },
};
