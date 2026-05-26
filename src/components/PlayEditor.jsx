import { useState, useEffect, useCallback, useRef } from 'react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ReferenceLine, ResponsiveContainer,
} from 'recharts';
import { fetchPlayByPlay, recomputeWpCurveRemote } from '../api/nbaApi';
import GameSelector from './GameSelector';

const EVENT_TYPES = ['shot_2pt', 'shot_3pt', 'free_throw', 'rebound', 'turnover', 'foul', 'timeout', 'substitution', 'other'];
const EVENT_LABELS = {
  shot_2pt: '2-Point Shot', shot_3pt: '3-Point Shot', free_throw: 'Free Throw',
  rebound: 'Rebound', turnover: 'Turnover', foul: 'Foul',
  timeout: 'Timeout', substitution: 'Substitution', other: 'Other',
};
const SCORING_TYPES = new Set(['shot_2pt', 'shot_3pt', 'free_throw']);

function isScoringType(t) { return SCORING_TYPES.has(t); }

function shotPtsFor(eventType, made) {
  if (!made) return 0;
  if (eventType === 'shot_3pt') return 3;
  if (eventType === 'shot_2pt') return 2;
  if (eventType === 'free_throw') return 1;
  return 0;
}

function buildDescription(eventType, player, team, made) {
  const base = player ? `${player}` : team;
  if (eventType === 'shot_2pt') return `${base} 2PT Shot (${made ? 'Made' : 'Missed'})`;
  if (eventType === 'shot_3pt') return `${base} 3PT Shot (${made ? 'Made' : 'Missed'})`;
  if (eventType === 'free_throw') return `${base} Free Throw (${made ? 'Made' : 'Missed'})`;
  return `${base} ${EVENT_LABELS[eventType]}`;
}

function ModelWinProb({ wpCurve, teamA }) {
  if (!wpCurve.length) return null;
  const prob = wpCurve[wpCurve.length - 1].wp;
  const color = prob >= 65 ? '#16a34a' : prob <= 35 ? '#dc2626' : '#2563eb';
  return (
    <div style={modelPanelStyles.panel}>
      <span style={modelPanelStyles.label}>Final Win Prob ({teamA})</span>
      <span style={{ ...modelPanelStyles.prob, color }}>{prob}%</span>
      <span style={modelPanelStyles.sub}>neural network · end of game</span>
    </div>
  );
}

const modelPanelStyles = {
  panel: { display: 'flex', alignItems: 'center', gap: '16px', background: '#fff', borderRadius: '8px', padding: '14px 20px', boxShadow: '0 1px 3px rgba(0,0,0,0.08)', marginBottom: '16px' },
  label: { fontSize: '11px', fontWeight: '600', color: '#888', textTransform: 'uppercase', letterSpacing: '0.05em', whiteSpace: 'nowrap' },
  prob: { fontSize: '36px', fontWeight: '700', lineHeight: 1, transition: 'color 0.2s' },
  sub: { fontSize: '11px', color: '#bbb' },
};

let _addedCounter = -1;
function nextAddedId() { return _addedCounter--; }

const formStyles = {
  overlay: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 },
  form: { background: '#fff', borderRadius: '10px', padding: '28px', width: '420px', boxShadow: '0 8px 32px rgba(0,0,0,0.18)', display: 'flex', flexDirection: 'column', gap: '14px' },
  formTitle: { fontSize: '16px', fontWeight: '700', color: '#1a1a1a', marginBottom: '4px' },
  row: { display: 'flex', flexDirection: 'column', gap: '4px' },
  label: { fontSize: '11px', fontWeight: '600', color: '#888', textTransform: 'uppercase', letterSpacing: '0.05em' },
  select: { padding: '7px 10px', borderRadius: '6px', border: '1px solid #d0d0d0', fontSize: '13px', background: '#fafafa', cursor: 'pointer' },
  actions: { display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '4px' },
  cancelBtn: { padding: '7px 16px', borderRadius: '6px', border: '1px solid #d0d0d0', background: '#fff', color: '#555', fontSize: '13px', cursor: 'pointer' },
  addBtn: { padding: '7px 16px', borderRadius: '6px', border: 'none', background: '#1a1a1a', color: '#fff', fontSize: '13px', fontWeight: '600', cursor: 'pointer' },
};

function AddPlayForm({ game, allPlays, onAdd, onCancel }) {
  const teams = [game.teamA, game.teamB];
  const playersByTeam = {};
  for (const t of teams) playersByTeam[t] = [];
  for (const p of allPlays) {
    if (p.player && p.team && playersByTeam[p.team]) {
      if (!playersByTeam[p.team].includes(p.player)) playersByTeam[p.team].push(p.player);
    }
  }
  for (const t of teams) playersByTeam[t].sort();

  const [team, setTeam] = useState(game.teamA);
  const [player, setPlayer] = useState(playersByTeam[game.teamA][0] || '');
  const [eventType, setEventType] = useState('shot_2pt');
  const [made, setMade] = useState(true);
  // insertAfterIdx: index in allPlays (sorted asc) after which to insert; -1 = before all
  const playsAsc = [...allPlays].sort((a, b) => a.gameSeconds - b.gameSeconds);
  const [insertAfterIdx, setInsertAfterIdx] = useState(playsAsc.length - 1);

  function handleTeamChange(t) {
    setTeam(t);
    setPlayer(playersByTeam[t][0] || '');
  }

  function handleSubmit() {
    const afterPlay = insertAfterIdx >= 0 ? playsAsc[insertAfterIdx] : null;
    const beforePlay = insertAfterIdx + 1 < playsAsc.length ? playsAsc[insertAfterIdx + 1] : null;
    // Place gameSeconds halfway between surrounding plays, or same as after-play + 1
    let gameSeconds;
    if (afterPlay && beforePlay) {
      gameSeconds = Math.round((afterPlay.gameSeconds + beforePlay.gameSeconds) / 2);
    } else if (afterPlay) {
      gameSeconds = afterPlay.gameSeconds + 1;
    } else if (beforePlay) {
      gameSeconds = Math.max(0, beforePlay.gameSeconds - 1);
    } else {
      gameSeconds = 0;
    }

    const refPlay = afterPlay || beforePlay || playsAsc[0];
    const quarter = refPlay ? refPlay.quarter : 1;
    const clock = refPlay ? refPlay.clock : '12:00';

    const scoring = isScoringType(eventType);
    const pts = shotPtsFor(eventType, made);

    onAdd({
      eventNum: nextAddedId(),
      quarter,
      clock,
      clockSeconds: refPlay?.clockSeconds ?? 0,
      gameSeconds,
      team,
      player,
      eventType: eventType.replace('_2pt', '').replace('_3pt', '').replace('shot', 'shot'),
      description: buildDescription(eventType, player, team, made),
      scoreA: refPlay?.scoreA ?? 0,
      scoreB: refPlay?.scoreB ?? 0,
      editable: scoring,
      shotPts: pts,
      added: true,
      addedEventType: eventType,
    });
  }

  return (
    <div style={formStyles.overlay}>
      <div style={formStyles.form}>
        <div style={formStyles.formTitle}>Add Play</div>

        <div style={formStyles.row}>
          <label style={formStyles.label}>Team</label>
          <select value={team} onChange={(e) => handleTeamChange(e.target.value)} style={formStyles.select}>
            {teams.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>

        <div style={formStyles.row}>
          <label style={formStyles.label}>Player</label>
          <select value={player} onChange={(e) => setPlayer(e.target.value)} style={formStyles.select}>
            {playersByTeam[team].map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </div>

        <div style={formStyles.row}>
          <label style={formStyles.label}>Event</label>
          <select value={eventType} onChange={(e) => setEventType(e.target.value)} style={formStyles.select}>
            {EVENT_TYPES.map((t) => <option key={t} value={t}>{EVENT_LABELS[t]}</option>)}
          </select>
        </div>

        {isScoringType(eventType) && (
          <div style={formStyles.row}>
            <label style={formStyles.label}>Result</label>
            <select value={made ? 'Made' : 'Missed'} onChange={(e) => setMade(e.target.value === 'Made')} style={formStyles.select}>
              <option value="Made">Made</option>
              <option value="Missed">Missed</option>
            </select>
          </div>
        )}

        <div style={formStyles.row}>
          <label style={formStyles.label}>Insert after</label>
          <select
            value={insertAfterIdx}
            onChange={(e) => setInsertAfterIdx(Number(e.target.value))}
            style={{ ...formStyles.select, maxWidth: '320px' }}
          >
            <option value={-1}>— Beginning of game —</option>
            {playsAsc.map((p, i) => (
              <option key={p.eventNum} value={i}>
                Q{p.quarter} {p.clock} · {p.description?.slice(0, 55) || p.eventType}
              </option>
            ))}
          </select>
        </div>

        <div style={formStyles.actions}>
          <button onClick={onCancel} style={formStyles.cancelBtn}>Cancel</button>
          <button onClick={handleSubmit} style={formStyles.addBtn}>Add Play</button>
        </div>
      </div>
    </div>
  );
}

const QUARTER_BOUNDARIES = [
  { seconds: 0, label: 'Q1' },
  { seconds: 720, label: 'Q2' },
  { seconds: 1440, label: 'Q3' },
  { seconds: 2160, label: 'Q4' },
];

function WinProbChart({ data, title, color, teamA, teamB }) {
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
            content={({ active, payload, label }) => {
              if (!active || !payload?.length) return null;
              const d = payload[0].payload;
              const min = Math.floor(label / 60);
              const sec = label % 60;
              const timeStr = `${min}:${String(sec).padStart(2, '0')}`;
              const hasScore = d.scoreA !== undefined && d.scoreB !== undefined;
              return (
                <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: '6px', padding: '8px 12px', fontSize: '12px', lineHeight: '1.6' }}>
                  <div style={{ fontWeight: 600, marginBottom: '2px' }}>{timeStr}</div>
                  {hasScore && (
                    <div style={{ color: '#555' }}>{teamA} {d.scoreA} – {d.scoreB} {teamB}</div>
                  )}
                  <div style={{ color }}>{teamA} Win Prob: {d.wp}%</div>
                </div>
              );
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
  const [addedPlays, setAddedPlays] = useState([]);
  const [showAddForm, setShowAddForm] = useState(false);
  const [quarterFilter, setQuarterFilter] = useState('all');

  useEffect(() => {
    setGameId(null);
    setGame(null);
    setOverrides({});
    setAddedPlays([]);
    setShowAddForm(false);
  }, [season, seasonType]);

  useEffect(() => {
    if (!gameId) return;
    setLoading(true);
    setError(null);
    setOverrides({});
    setAddedPlays([]);
    setShowAddForm(false);
    fetchPlayByPlay(gameId)
      .then((data) => { setGame(data); setLoading(false); })
      .catch((e) => { setError(e.message); setLoading(false); });
  }, [gameId]);

  const handleOverride = useCallback((eventNum, result) => {
    setOverrides((prev) => {
      const next = { ...prev };
      const allPlays = [...(game?.plays ?? []), ...addedPlays];
      const play = allPlays.find((p) => p.eventNum === eventNum);
      const originalResult = play?.shotPts > 0 ? 'Made' : 'Missed';
      if (result === originalResult && !play?.added) {
        delete next[eventNum];
      } else {
        next[eventNum] = result;
      }
      return next;
    });
  }, [game, addedPlays]);

  const handleAddPlay = useCallback((play) => {
    setAddedPlays((prev) => [...prev, play]);
    setShowAddForm(false);
  }, []);

  const allPlays = game ? [...game.plays, ...addedPlays] : [];
  const hasChanges = Object.keys(overrides).length > 0 || addedPlays.length > 0;

  const [whatIfCurve, setWhatIfCurve] = useState([]);
  const wpDebounceRef = useRef(null);
  useEffect(() => {
    if (!game) { setWhatIfCurve([]); return; }
    if (wpDebounceRef.current) clearTimeout(wpDebounceRef.current);
    wpDebounceRef.current = setTimeout(() => {
      recomputeWpCurveRemote(allPlays, overrides, game.teamA)
        .then(setWhatIfCurve)
        .catch(() => {});
    }, 300);
    return () => clearTimeout(wpDebounceRef.current);
  }, [allPlays.length, addedPlays, overrides, game]);

  const quarters = [...new Set(allPlays.map((p) => p.quarter))].sort((a, b) => a - b);
  const filteredPlays = (quarterFilter === 'all' ? allPlays : allPlays.filter((p) => p.quarter === Number(quarterFilter)))
    .slice().sort((a, b) => b.gameSeconds - a.gameSeconds);

  const changeLabel = (() => {
    const parts = [];
    if (addedPlays.length > 0) parts.push(`${addedPlays.length} added`);
    if (Object.keys(overrides).length > 0) parts.push(`${Object.keys(overrides).length} edited`);
    return parts.join(', ');
  })();

  return (
    <div>
      <div style={styles.selectorRow}>
        <GameSelector
          season={season}
          seasonType={seasonType}
          gameId={gameId}
          onGameChange={setGameId}
        />
        {hasChanges && (
          <button onClick={() => { setOverrides({}); setAddedPlays([]); }} style={styles.resetBtn}>
            Reset ({changeLabel})
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
            <WinProbChart data={game.wpCurve} title="Original" color="#2563eb" teamA={game.teamA} teamB={game.teamB} />
            <WinProbChart
              data={whatIfCurve}
              title={hasChanges ? `What If (${changeLabel})` : 'What If (no edits yet)'}
              color="#dc2626"
              teamA={game.teamA}
              teamB={game.teamB}
            />
          </div>

          <ModelWinProb wpCurve={whatIfCurve} teamA={game.teamA} />

          <div style={styles.playList}>
            <div style={styles.playListHeader}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <h3 style={styles.playListTitle}>Play-by-Play</h3>
                <span style={styles.hint}>{allPlays.length} events{addedPlays.length > 0 ? ` (${addedPlays.length} added)` : ''}</span>
              </div>
              <button onClick={() => setShowAddForm(true)} style={styles.addPlayBtn}>
                + Add Play
              </button>
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
                  <div key={play.eventNum} style={{ ...styles.tableRow, ...(play.added ? styles.tableRowAdded : isEdited ? styles.tableRowEdited : {}) }}>
                    <span style={styles.timeCell}>
                      Q{play.quarter} {play.clock}
                      {play.added && <span style={styles.addedBadge}>new</span>}
                    </span>
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

          {showAddForm && (
            <AddPlayForm
              game={game}
              allPlays={allPlays}
              onAdd={handleAddPlay}
              onCancel={() => setShowAddForm(false)}
            />
          )}
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
  tableRowAdded: { background: '#f0fdf4', borderLeft: '3px solid #16a34a' },
  timeCell: { width: 80, fontSize: '12px', color: '#666', fontWeight: '600', flexShrink: 0, display: 'flex', alignItems: 'center', gap: '4px' },
  addedBadge: { fontSize: '10px', fontWeight: '700', color: '#16a34a', background: '#dcfce7', borderRadius: '3px', padding: '1px 4px', textTransform: 'uppercase', letterSpacing: '0.04em' },
  addPlayBtn: { padding: '6px 14px', borderRadius: '6px', border: '1px solid #16a34a', background: '#f0fdf4', color: '#16a34a', fontSize: '13px', fontWeight: '600', cursor: 'pointer' },
  descCell: { flex: 1, fontSize: '13px', color: '#1a1a1a' },
  outcomeSelect: { padding: '3px 6px', borderRadius: '4px', border: '1px solid #d0d0d0', fontSize: '12px', cursor: 'pointer', background: '#fafafa', width: '80px' },
  outcomeSelectEdited: { border: '1px solid #f59e0b', background: '#fffbeb' },
  nonEditable: { color: '#ccc', fontSize: '13px' },
};
