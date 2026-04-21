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
import { fetchGames, fetchPlayByPlay, recomputeWpCurve } from '../api/nbaApi';


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

export default function PlayEditor({ season, seasonType }) {
  const [games, setGames] = useState([]);
  const [gameId, setGameId] = useState(null);
  const [game, setGame] = useState(null);
  const [loading, setLoading] = useState(false);
  const [overrides, setOverrides] = useState({});

  // Load games when season/seasonType change
  useEffect(() => {
    if (!season || !seasonType) return;
    setLoading(true);
    setGame(null);
    setGameId(null);
    setOverrides({});
    fetchGames(season, seasonType).then((data) => {
      setGames(data.games || []);
      if (data.games && data.games.length > 0) {
        setGameId(data.games[0].gameId);
      }
      setLoading(false);
    });
  }, [season, seasonType]);

  // Load game data when gameId changes
  useEffect(() => {
    if (!gameId) return;
    setLoading(true);
    setOverrides({});
    fetchPlayByPlay(gameId).then((pbpData) => {
      setGame(pbpData);
      setLoading(false);
    });
  }, [gameId]);

  const handleGameChange = useCallback((e) => {
    setGameId(e.target.value);
  }, []);

  const handleOverride = useCallback((eventNum, result) => {
    setOverrides((prev) => {
      const next = { ...prev };
      // If reverting to original, remove the override
      const play = game?.plays.find((p) => p.eventNum === eventNum);
      if (play) {
        const originalResult = play.shotPts > 0 ? 'Made' : 'Missed';
        if (originalResult === result) {
          delete next[eventNum];
        } else {
          next[eventNum] = result;
        }
      } else {
        next[eventNum] = result;
      }
      return next;
    });
  }, [game]);

  const whatIfCurve = game ? recomputeWpCurve(game.plays, overrides, game.teamA) : [];
  const hasOverrides = Object.keys(overrides).length > 0;

  // For the play list, show editable plays (shots/free throws)
  const editablePlays = game
    ? game.plays.filter((p) => p.editable)
    : [];

  // Show plays that were overridden, or last 10 editable plays if no overrides
  const displayPlays = hasOverrides
    ? editablePlays.filter((p) => overrides[p.eventNum] !== undefined)
    : editablePlays.slice(-10);

  return (
    <div>
      {/* Game selector */}
      <div style={styles.selectorRow}>
        <div style={styles.selectorGroup}>
          <label style={styles.label}>Game</label>
          <select value={gameId || ''} onChange={handleGameChange} style={styles.selectWide} disabled={games.length === 0 || loading}>
            {loading && <option>Loading games…</option>}
            {games.map((g) => (
              <option key={g.gameId} value={g.gameId}>
                {g.teamA} vs {g.teamB} — {g.date} ({g.finalScoreA}–{g.finalScoreB})
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
            {game.teamA} Win Probability · {game.plays.length} plays analyzed
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
                {hasOverrides ? 'Edited plays' : 'Last 10 shots of game (flip any outcome to see what-if)'}
              </h3>
              <span style={styles.playListHint}>
                {editablePlays.length} total shots/free throws in this game
              </span>
            </div>

            {/* Play browser: show editable plays grouped by quarter */}
            <PlayBrowser plays={editablePlays} overrides={overrides} onOverride={handleOverride} />
          </div>
        </>
      )}
    </div>
  );
}

function PlayBrowser({ plays, overrides, onOverride }) {
  const [quarterFilter, setQuarterFilter] = useState('all');
  const quarters = [...new Set(plays.map((p) => p.quarter))].sort((a, b) => a - b);

  const filtered = (quarterFilter === 'all'
    ? plays
    : plays.filter((p) => p.quarter === Number(quarterFilter))
  ).slice().sort((a, b) => b.quarter !== a.quarter ? b.quarter - a.quarter : b.eventNum - a.eventNum);

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
          <span style={{ width: 50 }}>Event</span>
          <span style={{ width: 30 }}>Q</span>
          <span style={{ flex: 1 }}>Description</span>
          <span style={{ width: 100 }}>Outcome</span>
        </div>
        {filtered.map((play) => {
          const isOverridden = overrides[play.eventNum] !== undefined;
          const currentResult = isOverridden ? overrides[play.eventNum] : (play.shotPts > 0 ? 'Made' : 'Missed');
          return (
            <div
              key={play.eventNum}
              style={{
                ...styles.shotRow,
                ...(isOverridden ? styles.shotRowEdited : {}),
              }}
            >
              <span style={{ width: 50, color: '#999', fontSize: 11 }}>{play.eventNum}</span>
              <span style={{ width: 30, fontSize: 12 }}>Q{play.quarter}</span>
              <span style={{ flex: 1, fontSize: 13 }}>
                {play.player && <span style={{ fontSize: 11, color: '#888', marginRight: 4 }}>
                  {play.player}
                </span>}
                {play.description.substring(0, 60)}
              </span>
              <span style={{ width: 100 }}>
                <select
                  value={currentResult}
                  onChange={(e) => onOverride(play.eventNum, e.target.value)}
                  style={{
                    ...styles.outcomeSelect,
                    ...(isOverridden ? styles.outcomeSelectEdited : {}),
                  }}
                >
                  <option value="Made">Made</option>
                  <option value="Missed">Missed</option>
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
