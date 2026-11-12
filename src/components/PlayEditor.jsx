import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { fetchPlayByPlay, recomputeWpCurveRemote, subscribeToGame } from '../api/nbaApi';
import GameSelector from './GameSelector';
import Spinner from './Spinner';
import ScenarioChart from './ScenarioChart';
import StudioDrawer from './StudioDrawer';

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

function eventTypeForPlay(play) {
  if (play?.addedEventType) return play.addedEventType;
  if (play?.eventType === 'free_throw') return 'free_throw';
  if (play?.eventType === 'shot') return play.shotPts === 3 ? 'shot_3pt' : 'shot_2pt';
  return EVENT_TYPES.includes(play?.eventType) ? play.eventType : 'other';
}

function buildDescription(eventType, player, team, made) {
  const base = player ? `${player}` : team;
  if (eventType === 'shot_2pt') return `${base} 2PT Shot (${made ? 'Made' : 'Missed'})`;
  if (eventType === 'shot_3pt') return `${base} 3PT Shot (${made ? 'Made' : 'Missed'})`;
  if (eventType === 'free_throw') return `${base} Free Throw (${made ? 'Made' : 'Missed'})`;
  return `${base} ${EVENT_LABELS[eventType]}`;
}

let _addedCounter = -1;
function nextAddedId() { return _addedCounter--; }

const formStyles = {
  overlay: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 },
  form: { background: 'var(--surface)', borderRadius: '10px', padding: '28px', width: '420px', boxShadow: '0 8px 32px rgba(0,0,0,0.18)', display: 'flex', flexDirection: 'column', gap: '14px' },
  formTitle: { fontFamily: 'var(--font-heading)', fontSize: '16px', fontWeight: '700', color: 'var(--text-primary)', marginBottom: '4px' },
  row: { display: 'flex', flexDirection: 'column', gap: '4px' },
  label: { fontSize: '11px', fontWeight: '600', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em' },
  select: { padding: '7px 10px', borderRadius: '6px', border: '1px solid var(--line)', fontSize: '13px', background: 'var(--surface-soft)', cursor: 'pointer' },
  quarterBtns: { display: 'flex', gap: '6px', flexWrap: 'wrap' },
  quarterBtn: { padding: '5px 14px', borderRadius: '6px', border: '1px solid var(--line)', background: 'var(--surface-soft)', fontSize: '13px', cursor: 'pointer', color: 'var(--text-secondary)' },
  quarterBtnActive: { background: 'var(--gold)', color: 'var(--on-accent)', border: '1px solid var(--text-primary)' },
  actions: { display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '4px' },
  cancelBtn: { padding: '7px 16px', borderRadius: '6px', border: '1px solid var(--line)', background: 'var(--surface)', color: 'var(--text-secondary)', fontSize: '13px', cursor: 'pointer' },
  addBtn: { padding: '7px 16px', borderRadius: '6px', border: 'none', background: 'var(--gold)', color: 'var(--on-accent)', fontSize: '13px', fontWeight: '600', cursor: 'pointer' },
};

// PlayForm is shared by Add and Edit modes.
// In edit mode, initialPlay is provided and onSave is called instead of onAdd.
function AddPlayForm({ game, allPlays, onAdd, onSave, onCancel, initialPlay }) {
  const isEdit = !!initialPlay;
  const teams = [game.teamA, game.teamB];
  const playersByTeam = {};
  for (const t of teams) playersByTeam[t] = [];
  for (const p of allPlays) {
    if (p.player && p.team && playersByTeam[p.team]) {
      if (!playersByTeam[p.team].includes(p.player)) playersByTeam[p.team].push(p.player);
    }
  }
  for (const t of teams) playersByTeam[t].sort();

  const playsAsc = [...allPlays].sort((a, b) => a.gameSeconds - b.gameSeconds);
  const availableQuarters = [...new Set(playsAsc.map((p) => p.quarter))].sort((a, b) => a - b);
  const maxQ = availableQuarters[availableQuarters.length - 1] ?? 4;

  const initTeam = initialPlay?.team ?? game.teamA;
  const initEventType = initialPlay ? eventTypeForPlay(initialPlay) : 'shot_2pt';
  const initMade = initialPlay ? (initialPlay.shotPts > 0) : true;
  const initQuarter = initialPlay?.quarter ?? availableQuarters[0] ?? 1;

  const [team, setTeam] = useState(initTeam);
  const [player, setPlayer] = useState(initialPlay?.player ?? playersByTeam[initTeam][0] ?? '');
  const [eventType, setEventType] = useState(initEventType);
  const [made, setMade] = useState(initMade);
  const [selectedQuarter, setSelectedQuarter] = useState(initQuarter);
  const [clockInput, setClockInput] = useState(formatClockSeconds(initialPlay?.clockSeconds ?? quarterDuration(initQuarter)));

  // Plays in the selected quarter, ascending (excluding the play being edited)
  const quarterPlays = playsAsc.filter((p) => p.quarter === selectedQuarter && p.eventNum !== initialPlay?.eventNum);
  const [insertAfterIdx, setInsertAfterIdx] = useState(() => {
    if (!initialPlay) return quarterPlays.length > 0 ? quarterPlays.length - 1 : -1;
    // For editing, default to position just before the original play
    const origIdx = quarterPlays.findIndex((p) => p.gameSeconds >= initialPlay.gameSeconds);
    return origIdx > 0 ? origIdx - 1 : -1;
  });

  function clockForInsertIndex(index, qPlays, quarter) {
    const afterPlay = index >= 0 ? qPlays[index] : null;
    const beforePlay = index >= 0 ? qPlays[index + 1] : qPlays[0];
    if (afterPlay && beforePlay) {
      return formatClockSeconds(Math.round((afterPlay.clockSeconds + beforePlay.clockSeconds) / 2));
    }
    if (afterPlay) return formatClockSeconds(Math.max(0, afterPlay.clockSeconds - 1));
    if (beforePlay) return formatClockSeconds(Math.min(quarterDuration(quarter), beforePlay.clockSeconds + 1));
    return formatClockSeconds(quarterDuration(quarter));
  }

  function handleQuarterSelect(q) {
    const qPlays = playsAsc.filter((p) => p.quarter === q && p.eventNum !== initialPlay?.eventNum);
    const nextIndex = qPlays.length > 0 ? qPlays.length - 1 : -1;
    setSelectedQuarter(q);
    setInsertAfterIdx(nextIndex);
    setClockInput(clockForInsertIndex(nextIndex, qPlays, q));
  }

  function handleInsertAfterChange(index) {
    setInsertAfterIdx(index);
    setClockInput(clockForInsertIndex(index, quarterPlays, selectedQuarter));
  }

  function handleTeamChange(t) {
    setTeam(t);
    setPlayer(playersByTeam[t][0] || '');
  }

  function buildPlay() {
    const parsedClockSeconds = parseClockInput(clockInput, selectedQuarter);
    const clockSeconds = parsedClockSeconds ?? quarterDuration(selectedQuarter);
    const gameSeconds = quarterStartSeconds(selectedQuarter) + (quarterDuration(selectedQuarter) - clockSeconds);
    const previousPlay = playsAsc
      .filter((p) => p.eventNum !== initialPlay?.eventNum && p.gameSeconds <= gameSeconds)
      .at(-1);
    const nextPlay = playsAsc.find((p) => p.eventNum !== initialPlay?.eventNum && p.gameSeconds > gameSeconds);
    const refPlay = previousPlay || nextPlay || playsAsc[0];
    const quarter = selectedQuarter;
    const clock = formatClockSeconds(clockSeconds);
    const scoring = isScoringType(eventType);
    const pts = shotPtsFor(eventType, made);

    return {
      eventNum: initialPlay?.eventNum ?? nextAddedId(),
      quarter,
      clock,
      clockSeconds,
      gameSeconds,
      team,
      player,
      eventType: eventType.replace('_2pt', '').replace('_3pt', '').replace('shot', 'shot'),
      description: buildDescription(eventType, player, team, made),
      scoreA: refPlay?.scoreA ?? 0,
      scoreB: refPlay?.scoreB ?? 0,
      editable: scoring,
      shotPts: pts,
      originalShotPts: initialPlay?.originalShotPts ?? initialPlay?.shotPts ?? 0,
      added: initialPlay?.added ?? !initialPlay,
      edited: Boolean(initialPlay && !initialPlay.added),
      addedEventType: eventType,
    };
  }

  function handleSubmit() {
    const play = buildPlay();
    if (isEdit) onSave(play);
    else onAdd(play);
  }

  return (
    <div style={formStyles.overlay}>
      <div className="editor-form" style={formStyles.form}>
        <div style={formStyles.formTitle}>{isEdit ? 'Edit Play' : 'Add Play'}</div>

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
          <label style={formStyles.label}>Quarter</label>
          <div style={formStyles.quarterBtns}>
            {availableQuarters.map((q) => (
              <button
                key={q}
                type="button"
                onClick={() => handleQuarterSelect(q)}
                style={{ ...formStyles.quarterBtn, ...(selectedQuarter === q ? formStyles.quarterBtnActive : {}) }}
              >
                {quarterLabel(q, maxQ)}
              </button>
            ))}
          </div>
        </div>

        <div style={formStyles.row}>
          <label style={formStyles.label}>{isEdit ? 'Position Shortcut' : 'Insert after'}</label>
          <select
            value={insertAfterIdx}
            onChange={(e) => handleInsertAfterChange(Number(e.target.value))}
            style={{ ...formStyles.select, maxWidth: '360px' }}
          >
            <option value={-1}>— Start of {quarterLabel(selectedQuarter, maxQ)} —</option>
            {quarterPlays.map((p, i) => (
              <option key={p.eventNum} value={i}>
                {p.clock} · {p.description?.slice(0, 50) || p.eventType}
              </option>
            ))}
          </select>
        </div>

        <div style={formStyles.row}>
          <label style={formStyles.label}>Exact Clock</label>
          <input
            value={clockInput}
            onChange={(e) => setClockInput(e.target.value)}
            placeholder="6:37"
            style={formStyles.select}
          />
        </div>

        <div style={formStyles.actions}>
          <button onClick={onCancel} style={formStyles.cancelBtn}>Cancel</button>
          <button onClick={handleSubmit} style={formStyles.addBtn}>{isEdit ? 'Save Changes' : 'Add Play'}</button>
        </div>
      </div>
    </div>
  );
}

const REGULATION_SECONDS = 2880;

function quarterLabel(q) {
  if (q <= 4) return `Q${q}`;
  return `OT${q - 4}`;
}

function playTimeLabel(play, maxQuarter) {
  return `${quarterLabel(play.quarter, maxQuarter)} ${play.clock}`;
}

function quarterDuration(quarter) {
  return quarter <= 4 ? 720 : 300;
}

function quarterStartSeconds(quarter) {
  return quarter <= 4 ? (quarter - 1) * 720 : REGULATION_SECONDS + (quarter - 5) * 300;
}

function parseClockInput(value, quarter) {
  const match = String(value).trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const minutes = Number(match[1]);
  const seconds = Number(match[2]);
  const duration = quarterDuration(quarter);
  const total = minutes * 60 + seconds;
  if (seconds > 59 || total < 0 || total > duration) return null;
  return total;
}

function formatClockSeconds(seconds) {
  const safeSeconds = Math.max(0, Math.round(seconds));
  return `${Math.floor(safeSeconds / 60)}:${String(safeSeconds % 60).padStart(2, '0')}`;
}

// Compute WP impact for each play by matching plays to their corresponding WP curve
// point by position. The backend generates one curve point per play in order, with a
// synthetic point at index 0 (gameSeconds=0, wp=50). So curve[i+1] corresponds to plays[i].
// Returns a Map<eventNum, deltaWp> signed for teamA perspective.
function computePlayImpacts(plays, wpCurve) {
  const impacts = new Map();
  if (!wpCurve.length) return impacts;

  // curve[0] is the tip-off point; curve[i+1] is after plays[i]
  for (let i = 0; i < plays.length; i++) {
    const curveIdx = i + 1;
    if (curveIdx >= wpCurve.length) break;
    const after = wpCurve[curveIdx];
    const before = wpCurve[curveIdx - 1];
    const delta = Math.round((after.wp - before.wp) * 10) / 10;
    impacts.set(plays[i].eventNum, delta);
  }
  return impacts;
}

function computeScoreChanges(plays, wpCurve) {
  const scoreChanges = new Map();

  for (let i = 0; i < plays.length; i++) {
    const curveIdx = i + 1;
    if (curveIdx >= wpCurve.length) break;
    const before = wpCurve[curveIdx - 1];
    const after = wpCurve[curveIdx];
    scoreChanges.set(plays[i].eventNum, {
      before: `${before.scoreA ?? 0}–${before.scoreB ?? 0}`,
      after: `${after.scoreA ?? 0}–${after.scoreB ?? 0}`,
      changed: before.scoreA !== after.scoreA || before.scoreB !== after.scoreB,
    });
  }

  return scoreChanges;
}

function pointAtOrBefore(curve, gameSeconds) {
  let result = curve[0] ?? null;
  for (const point of curve) {
    if ((point.gameSeconds ?? 0) <= gameSeconds) result = point;
    else break;
  }
  return result;
}

function formatSignedNumber(value, suffix = '') {
  const rounded = Math.round((value ?? 0) * 10) / 10;
  if (rounded === 0) return `0${suffix}`;
  return `${rounded > 0 ? '+' : ''}${rounded}${suffix}`;
}

function formatSpread(value) {
  return value === 0 ? 'PK' : `${value > 0 ? '+' : ''}${value}`;
}

function formatScore(point, teamA, teamB) {
  return `${teamA} ${point?.scoreA ?? 0} - ${point?.scoreB ?? 0} ${teamB}`;
}

function ChangeImpactPanel({
  hasChanges,
  changeLabel,
  originalCurve,
  whatIfCurve,
  originalPlays,
  addedPlays,
  editedPlays,
  deletedEventNums,
  viewingTeam,
  teamA,
  teamB,
  maxQuarter,
}) {
  if (!hasChanges || !originalCurve.length || !whatIfCurve.length) return null;

  const originalFinal = originalCurve.at(-1);
  const whatIfFinal = whatIfCurve.at(-1);
  const finalWpDelta = (whatIfFinal?.wp ?? 0) - (originalFinal?.wp ?? 0);

  const deletedPlays = originalPlays.filter((p) => deletedEventNums.has(p.eventNum));
  const changedPlays = [
    ...addedPlays.map((play) => ({ play, label: 'Added' })),
    ...Object.values(editedPlays).map((play) => ({ play, label: 'Edited' })),
    ...deletedPlays.map((play) => ({ play, label: 'Deleted' })),
  ].sort((a, b) => a.play.gameSeconds - b.play.gameSeconds);

  return (
    <div className="surface-card" style={changeImpactStyles.panel}>
      <div style={changeImpactStyles.header}>
        <div>
          <div style={changeImpactStyles.title}>What changed</div>
          <div style={changeImpactStyles.meta}>{changeLabel}</div>
        </div>
        <div style={changeImpactStyles.totals}>
          <span style={changeImpactStyles.totalItem}>
            {`Final WP ${(originalFinal?.wp ?? 0)}% -> ${(whatIfFinal?.wp ?? 0)}% for ${viewingTeam}`}
            {finalWpDelta !== 0 && ` (${formatSignedNumber(finalWpDelta, '%')})`}
          </span>
          <span style={changeImpactStyles.totalItem}>
            Theoretical final: {formatScore(whatIfFinal, teamA, teamB)}
          </span>
        </div>
      </div>

      {changedPlays.length > 0 && (
        <div style={changeImpactStyles.rows}>
          {changedPlays.slice(0, 8).map(({ play, label }) => {
            const originalPoint = pointAtOrBefore(originalCurve, play.gameSeconds);
            const whatIfPoint = pointAtOrBefore(whatIfCurve, play.gameSeconds);
            const wpDelta = (whatIfPoint?.wp ?? 0) - (originalPoint?.wp ?? 0);
            const wpColor = wpDelta > 0 ? 'var(--success)' : wpDelta < 0 ? 'var(--error)' : 'var(--text-secondary)';

            return (
              <div key={`${label}-${play.eventNum}`} style={changeImpactStyles.row}>
                <span style={changeImpactStyles.badge}>{label}</span>
                <span style={changeImpactStyles.time}>{playTimeLabel(play, maxQuarter)}</span>
                <span style={changeImpactStyles.desc}>{play.description || play.eventType}</span>
                <span style={{ ...changeImpactStyles.wpDelta, color: wpColor }}>
                  {`WP ${originalPoint?.wp ?? 0}% -> ${whatIfPoint?.wp ?? 0}%`}
                </span>
                <span style={changeImpactStyles.scoreDelta}>
                  {`${formatScore(originalPoint, teamA, teamB)} -> ${formatScore(whatIfPoint, teamA, teamB)}`}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

const changeImpactStyles = {
  panel: { background: 'var(--surface)', borderRadius: '8px', padding: '16px 20px', boxShadow: '0 1px 3px rgba(0,0,0,0.08)', marginBottom: '16px' },
  header: { display: 'flex', justifyContent: 'space-between', gap: '18px', alignItems: 'flex-start', flexWrap: 'wrap' },
  title: { fontFamily: 'var(--font-heading)', fontSize: '13px', fontWeight: '700', color: 'var(--text-primary)', marginBottom: '4px' },
  meta: { fontSize: '11px', color: 'var(--text-muted)' },
  totals: { display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end' },
  totalItem: { fontSize: '12px', fontWeight: '700', color: 'var(--text-primary)', background: 'var(--surface-soft)', border: '1px solid var(--line)', borderRadius: '6px', padding: '5px 8px' },
  rows: { display: 'flex', flexDirection: 'column', gap: '6px', marginTop: '12px' },
  row: { display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0, paddingTop: '6px', borderTop: '1px solid var(--line)' },
  badge: { width: 52, fontSize: '10px', fontWeight: '700', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.04em' },
  time: { width: 66, fontSize: '11px', color: 'var(--text-secondary)', flexShrink: 0 },
  desc: { flex: 1, minWidth: 120, fontSize: '12px', color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  wpDelta: { width: 96, textAlign: 'right', fontSize: '12px', fontWeight: '700', flexShrink: 0 },
  scoreDelta: { width: 330, fontSize: '11px', color: 'var(--text-secondary)', textAlign: 'right', flexShrink: 0 },
};

// Shared chart content so both inline and expanded views use the same rendering
function TopImpactsPanel({ plays, impacts, scoreChanges, viewingTeam, scoreTeamA, scoreTeamB, maxQuarter }) {
  if (!impacts.size) return null;
  const ranked = plays
    .map((p) => ({ play: p, impact: impacts.get(p.eventNum) }))
    .filter((x) => x.impact != null && x.impact !== 0)
    .sort((a, b) => Math.abs(b.impact) - Math.abs(a.impact))
    .slice(0, 5);
  if (!ranked.length) return null;

  return (
    <div className="surface-card" style={topImpactStyles.panel}>
      <div style={topImpactStyles.title}>Top 5 Most Impactful Plays</div>
      {ranked.map(({ play, impact }, i) => {
        const positive = impact > 0;
        const color = positive ? 'var(--success)' : 'var(--error)';
        const scoreChange = scoreChanges.get(play.eventNum);
        return (
          <div key={play.eventNum} style={topImpactStyles.row}>
            <span style={topImpactStyles.rank}>#{i + 1}</span>
            <span style={topImpactStyles.time}>{playTimeLabel(play, maxQuarter)}</span>
            <span style={topImpactStyles.playInfo}>
              <span style={topImpactStyles.desc}>{play.description || play.eventType}</span>
              {scoreChange && (
                <span style={scoreChange.changed ? topImpactStyles.scoreChange : topImpactStyles.scoreUnchanged}>
                  {scoreChange.changed
                    ? `Score ${scoreChange.before} → ${scoreChange.after}`
                    : `Score stays ${scoreChange.after}`}
                </span>
              )}
            </span>
            <span style={{ ...topImpactStyles.impact, color }}>
              {positive ? '+' : ''}{impact}%
            </span>
          </div>
        );
      })}
      <div style={topImpactStyles.footer}>
        WP impact for {viewingTeam} · scores shown as {scoreTeamA} – {scoreTeamB}
      </div>
    </div>
  );
}

const topImpactStyles = {
  panel: { background: 'var(--surface)', borderRadius: '8px', padding: '16px 20px', boxShadow: '0 1px 3px rgba(0,0,0,0.08)', marginBottom: '16px' },
  title: { fontFamily: 'var(--font-heading)', fontSize: '13px', fontWeight: '700', color: 'var(--text-primary)', marginBottom: '10px' },
  row: { display: 'flex', alignItems: 'center', gap: '10px', padding: '5px 0', borderBottom: '1px solid var(--line)' },
  rank: { fontSize: '11px', fontWeight: '700', color: 'var(--text-muted)', width: '24px', flexShrink: 0 },
  time: { fontSize: '11px', color: 'var(--text-secondary)', width: '72px', flexShrink: 0 },
  playInfo: { flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: '3px' },
  desc: { fontSize: '12px', color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  scoreChange: { fontSize: '11px', fontWeight: '700', color: 'var(--electric-blue)' },
  scoreUnchanged: { fontSize: '11px', color: 'var(--text-muted)' },
  impact: { fontSize: '13px', fontWeight: '700', width: '52px', textAlign: 'right', flexShrink: 0 },
  footer: { fontSize: '11px', color: 'var(--text-muted)', marginTop: '8px' },
};

export default function PlayEditor({ season, seasonType, seasonControls }) {
  const [gameId, setGameId] = useState(null);
  const [game, setGame] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [overrides, setOverrides] = useState({});
  const [addedPlays, setAddedPlays] = useState([]);
  const [editedPlays, setEditedPlays] = useState({});
  const [deletedEventNums, setDeletedEventNums] = useState(new Set());
  const [selectedEventNums, setSelectedEventNums] = useState(new Set());
  const [deleteScope, setDeleteScope] = useState('single');
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingPlay, setEditingPlay] = useState(null);
  const [quarterFilter, setQuarterFilter] = useState('all');
  const [perspectiveTeam, setPerspectiveTeam] = useState('A');
  const [liveError, setLiveError] = useState(false);
  const [selectedMoment, setSelectedMoment] = useState(null);
  const [playSearch, setPlaySearch] = useState('');
  const [gameRetry, setGameRetry] = useState(0);
  const [scenarioRetry, setScenarioRetry] = useState(0);
  const playRefs = useRef(new Map());

  const handleGameChange = useCallback(
    (id) => {
      if (id === gameId) return;
      setGameId(id);
      setLoading(Boolean(id));
      setError(null);
      setGame(null);
      setOverrides({});
      setAddedPlays([]);
      setEditedPlays({});
      setDeletedEventNums(new Set());
      setSelectedEventNums(new Set());
      setShowAddForm(false);
      setEditingPlay(null);
      setSelectedMoment(null);
      setPerspectiveTeam('A');
      setQuarterFilter('all');
      setPlaySearch('');
      setLiveError(false);
    },
    [gameId]
  );

  useEffect(() => {
    if (!gameId) return;
    let active = true;
    fetchPlayByPlay(gameId)
      .then((data) => {
        if (active) {
          setGame(data);
          setLoading(false);
        }
      })
      .catch((e) => {
        if (active) {
          setError(e.message);
          setLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, [gameId, gameRetry]);

  const gameStatus = game?.status;
  // Subscribe to live updates when the loaded game is in progress.
  useEffect(() => {
    if (gameStatus !== 'live') return;

    const cleanup = subscribeToGame(gameId, {
      onPlay: (play) => {
        setLiveError(false);
        setGame((prev) => {
          if (!prev) return prev;
          if (prev.plays.some((p) => p.eventNum === play.eventNum)) return prev;
          return { ...prev, plays: [...prev.plays, play] };
        });
      },
      onWP: ({ wpCurve }) => {
        setGame((prev) => (prev ? { ...prev, wpCurve } : prev));
      },
      onStatus: ({ gameStatus }) => {
        if (gameStatus === 'finished') {
          setLiveError(false);
          setGame((prev) => (prev ? { ...prev, status: 'finished' } : prev));
        } else if (gameStatus === 'error') {
          setLiveError(true);
        }
      },
      onError: () => setLiveError(true)
    });
    return cleanup;
  }, [gameStatus, gameId]);

  const handleOverride = useCallback(
    (eventNum, result) => {
      setOverrides((prev) => {
        const next = { ...prev };
        const allPlays = [
          ...(game?.plays ?? []).map((p) => editedPlays[p.eventNum] ?? p),
          ...addedPlays
        ];
        const play = allPlays.find((p) => p.eventNum === eventNum);
        const originalResult = play?.shotPts > 0 ? 'Made' : 'Missed';
        if (result === originalResult && !play?.added) {
          delete next[eventNum];
        } else {
          next[eventNum] = result;
        }
        return next;
      });
    },
    [game, addedPlays, editedPlays]
  );

  const handleAddPlay = useCallback((play) => {
    setAddedPlays((prev) => [...prev, play]);
    setShowAddForm(false);
  }, []);

  const handleSaveEdit = useCallback((updatedPlay) => {
    if (updatedPlay.added) {
      setAddedPlays((prev) =>
        prev.map((p) => (p.eventNum === updatedPlay.eventNum ? updatedPlay : p))
      );
    } else {
      setEditedPlays((prev) => ({
        ...prev,
        [updatedPlay.eventNum]: updatedPlay
      }));
    }
    setEditingPlay(null);
  }, []);

  const clearOverridesFor = useCallback((eventNums) => {
    setOverrides((prev) => {
      const next = { ...prev };
      for (const eventNum of eventNums) delete next[eventNum];
      return next;
    });
  }, []);

  const handleDeletePlay = useCallback(
    (eventNum) => {
      const plays = [
        ...(game?.plays ?? []).map((p) => editedPlays[p.eventNum] ?? p),
        ...addedPlays
      ];
      const target = plays.find((p) => p.eventNum === eventNum);
      if (!target) return;
      const eventNums =
        deleteScope === 'later'
          ? plays
              .filter((p) => p.gameSeconds >= target.gameSeconds)
              .map((p) => p.eventNum)
          : [eventNum];

      setAddedPlays((prev) =>
        prev.filter((p) => !eventNums.includes(p.eventNum))
      );
      setEditedPlays((prev) => {
        const next = { ...prev };
        for (const deletedEventNum of eventNums) delete next[deletedEventNum];
        return next;
      });
      const originalEventNums = eventNums.filter((deletedEventNum) =>
        (game?.plays ?? []).some((p) => p.eventNum === deletedEventNum)
      );
      if (originalEventNums.length > 0) {
        setDeletedEventNums((prev) => new Set([...prev, ...originalEventNums]));
      } else {
        setDeletedEventNums((prev) => new Set(prev));
      }
      setSelectedEventNums((prev) => {
        const next = new Set(prev);
        for (const deletedEventNum of eventNums) next.delete(deletedEventNum);
        return next;
      });
      clearOverridesFor(eventNums);
    },
    [addedPlays, clearOverridesFor, deleteScope, editedPlays, game]
  );

  const handleDeleteSelected = useCallback(() => {
    const eventNums = [...selectedEventNums];
    if (!eventNums.length) return;
    setAddedPlays((prev) =>
      prev.filter((p) => !eventNums.includes(p.eventNum))
    );
    setEditedPlays((prev) => {
      const next = { ...prev };
      for (const eventNum of eventNums) delete next[eventNum];
      return next;
    });
    const originalEventNums = eventNums.filter((eventNum) =>
      (game?.plays ?? []).some((p) => p.eventNum === eventNum)
    );
    setDeletedEventNums((prev) => new Set([...prev, ...originalEventNums]));
    clearOverridesFor(eventNums);
    setSelectedEventNums(new Set());
  }, [clearOverridesFor, game, selectedEventNums]);

  const handleRestorePlay = useCallback((eventNum) => {
    setDeletedEventNums((prev) => {
      const next = new Set(prev);
      next.delete(eventNum);
      return next;
    });
  }, []);

  const toggleSelectedPlay = useCallback((eventNum) => {
    setSelectedEventNums((prev) => {
      const next = new Set(prev);
      if (next.has(eventNum)) next.delete(eventNum);
      else next.add(eventNum);
      return next;
    });
  }, []);

  // allPlays includes added plays but not deleted originals
  const allPlays = useMemo(
    () =>
      game
        ? [
            ...game.plays
              .map((p) => editedPlays[p.eventNum] ?? p)
              .filter((p) => !deletedEventNums.has(p.eventNum)),
            ...addedPlays
          ]
            .slice()
            .sort(
              (a, b) => a.gameSeconds - b.gameSeconds || a.eventNum - b.eventNum
            )
        : [],
    [addedPlays, deletedEventNums, editedPlays, game]
  );
  const hasChanges =
    Object.keys(overrides).length > 0 ||
    addedPlays.length > 0 ||
    Object.keys(editedPlays).length > 0 ||
    deletedEventNums.size > 0;

  const [scenarioResult, setScenarioResult] = useState(null);
  useEffect(() => {
    if (!game || !hasChanges) return;
    let active = true;
    const timeout = setTimeout(() => {
      recomputeWpCurveRemote(
        allPlays,
        overrides,
        game.teamA,
        game.bettingLine ?? 0
      )
        .then((curve) => {
          if (active)
            setScenarioResult({
              game,
              plays: allPlays,
              overrides,
              retry: scenarioRetry,
              curve
            });
        })
        .catch((error) => {
          if (active)
            setScenarioResult({
              game,
              plays: allPlays,
              overrides,
              retry: scenarioRetry,
              error: error.message
            });
        });
    }, 300);
    return () => {
      active = false;
      clearTimeout(timeout);
    };
  }, [game, allPlays, overrides, hasChanges, scenarioRetry]);
  const scenarioCurrent =
    scenarioResult?.game === game &&
    scenarioResult?.plays === allPlays &&
    scenarioResult?.overrides === overrides &&
    scenarioResult?.retry === scenarioRetry;
  const scenarioPending = hasChanges && !scenarioCurrent;
  const scenarioError =
    hasChanges && scenarioCurrent ? scenarioResult.error : null;
  const whatIfCurve = !hasChanges
    ? (game?.wpCurve ?? [])
    : scenarioCurrent
      ? (scenarioResult.curve ?? [])
      : [];

  const quarters = [...new Set(allPlays.map((p) => p.quarter))].sort(
    (a, b) => a - b
  );
  const filteredPlays = (
    quarterFilter === 'all'
      ? allPlays
      : allPlays.filter((p) => p.quarter === Number(quarterFilter))
  )
    .filter((play) =>
      `${play.player ?? ''} ${play.description ?? ''}`
        .toLowerCase()
        .includes(playSearch.toLowerCase().trim())
    )
    .slice()
    .sort((a, b) => b.gameSeconds - a.gameSeconds);

  const changeLabel = (() => {
    const parts = [];
    if (addedPlays.length > 0) parts.push(`${addedPlays.length} added`);
    if (Object.keys(editedPlays).length > 0)
      parts.push(`${Object.keys(editedPlays).length} play details changed`);
    if (Object.keys(overrides).length > 0)
      parts.push(`${Object.keys(overrides).length} edited`);
    if (deletedEventNums.size > 0)
      parts.push(`${deletedEventNums.size} deleted`);
    return parts.join(', ');
  })();

  // Flip wp values when viewing from teamB's perspective
  const flipCurve = (curve) =>
    curve.map((pt) => ({ ...pt, wp: Math.round((100 - pt.wp) * 10) / 10 }));

  const viewingTeam = perspectiveTeam === 'A' ? game?.teamA : game?.teamB;
  const displayOriginal =
    perspectiveTeam === 'A'
      ? (game?.wpCurve ?? [])
      : flipCurve(game?.wpCurve ?? []);
  const displayWhatIf =
    perspectiveTeam === 'A' ? whatIfCurve : flipCurve(whatIfCurve);
  const maxQuarter = game ? Math.max(...allPlays.map((p) => p.quarter), 4) : 4;

  // Impact scores computed against the active (what-if or original) curve
  const activeCurve = hasChanges ? displayWhatIf : displayOriginal;
  const playImpacts = computePlayImpacts(allPlays, activeCurve);
  const scoreChanges = computeScoreChanges(allPlays, activeCurve);

  const selectedPlay =
    allPlays.find((play) => play.eventNum === selectedMoment) ??
    allPlays.findLast((play) => play.editable) ??
    allPlays.at(-1);
  const originalIndex =
    game?.plays.findIndex((play) => play.eventNum === selectedPlay?.eventNum) ??
    -1;
  const scenarioIndex = allPlays.findIndex(
    (play) => play.eventNum === selectedPlay?.eventNum
  );
  const originalPoint =
    originalIndex >= 0 ? displayOriginal[originalIndex + 1] : null;
  const scenarioPoint =
    scenarioIndex >= 0 ? displayWhatIf[scenarioIndex + 1] : null;
  const selectedDelta =
    originalPoint && scenarioPoint ? scenarioPoint.wp - originalPoint.wp : null;
  const keyMoments = allPlays
    .filter((play) => playImpacts.has(play.eventNum))
    .sort(
      (a, b) =>
        Math.abs(playImpacts.get(b.eventNum)) -
        Math.abs(playImpacts.get(a.eventNum))
    )
    .slice(0, 4);

  function selectMoment(play, scroll = false) {
    if (!play) return;
    setSelectedMoment(play.eventNum);
    if (scroll) {
      setQuarterFilter('all');
      setPlaySearch('');
      requestAnimationFrame(() =>
        playRefs.current
          .get(play.eventNum)
          ?.scrollIntoView({ block: 'nearest', behavior: 'instant' })
      );
    }
  }
  function resetScenario() {
    setOverrides({});
    setAddedPlays([]);
    setEditedPlays({});
    setDeletedEventNums(new Set());
    setSelectedEventNums(new Set());
  }

  const hasBettingLine = Number.isFinite(game?.bettingLine);

  const inspector = (
    <div className="scenario-inspector-content">
      <div className="studio-section-heading">
        <div>
          <p className="studio-eyebrow">Scenario editor</p>
          <h2>What if?</h2>
        </div>
        {hasChanges && <span className="studio-tag">Edited</span>}
      </div>
      {selectedPlay ? (
        <>
          <span className="studio-moment-time">
            {playTimeLabel(selectedPlay, maxQuarter)}
          </span>
          <h3 className="studio-selected-player">
            {selectedPlay.player || selectedPlay.team || 'Game event'}
          </h3>
          <p className="studio-selected-description">
            {selectedPlay.description || 'No description available'}
          </p>
          {selectedPlay.editable ? (
            <fieldset className="studio-outcome">
              <legend>Change the outcome</legend>
              <div>
                {['Made', 'Missed'].map((result) => (
                  <button
                    key={result}
                    className="studio-button"
                    aria-pressed={
                      (overrides[selectedPlay.eventNum] ??
                        (selectedPlay.shotPts > 0 ? 'Made' : 'Missed')) ===
                      result
                    }
                    onClick={() =>
                      handleOverride(selectedPlay.eventNum, result)
                    }
                  >
                    {result}
                  </button>
                ))}
              </div>
            </fieldset>
          ) : (
            <p className="studio-muted">
              Edit the play details to change this event.
            </p>
          )}
          <div className="scenario-impact" aria-live="polite">
            <span className="studio-eyebrow">Impact at this moment</span>
            <strong>
              {scenarioPending
                ? 'Calculating…'
                : scenarioError
                  ? 'Unavailable'
                  : selectedDelta == null
                    ? '—'
                    : formatSignedNumber(selectedDelta, ' pp')}
            </strong>
            <span className="studio-muted">{viewingTeam} win probability</span>
            {originalPoint && (
              <div className="scenario-prob-row">
                <span>Original</span>
                <b>{originalPoint.wp.toFixed(1)}%</b>
              </div>
            )}
            {scenarioPoint && (
              <div className="scenario-prob-row">
                <span>What if</span>
                <b>{scenarioPoint.wp.toFixed(1)}%</b>
              </div>
            )}
          </div>
          {scenarioError && (
            <div className="studio-error" role="alert">
              <p>We couldn’t calculate this scenario.</p>
              <button
                className="studio-button"
                onClick={() => setScenarioRetry((retry) => retry + 1)}
              >
                Retry calculation
              </button>
            </div>
          )}
          <div className="scenario-actions">
            <button
              className="studio-button"
              onClick={() => setEditingPlay(selectedPlay)}
            >
              Edit play details
            </button>
            <button
              className="studio-button studio-button-danger"
              onClick={() => handleDeletePlay(selectedPlay.eventNum)}
            >
              Delete{' '}
              {deleteScope === 'later' ? 'this + later plays' : 'this play'}
            </button>
          </div>
          {hasChanges && (
            <button
              className="studio-button studio-reset"
              onClick={resetScenario}
            >
              Reset scenario
            </button>
          )}
        </>
      ) : (
        <p className="studio-muted">
          Select a play to explore a different outcome.
        </p>
      )}
      <div className="scenario-note">
        What-if results estimate changes to this game. Later events stay as
        recorded unless you edit them.
        {game?.dataSource && (
          <p>Downloaded play archive · {hasBettingLine ? 'The model includes the closing pregame spread.' : 'Historical spread unavailable; the model uses a neutral spread.'}</p>
        )}
      </div>
    </div>
  );

  return (
    <div className="studio-workspace">
      <StudioDrawer
        title="Game library"
        label="Browse games"
        className="studio-library"
      >
        {seasonControls}
        <GameSelector
          season={season}
          seasonType={seasonType}
          gameId={gameId}
          onGameChange={handleGameChange}
        />
      </StudioDrawer>
      <div className="studio-content">
        {loading && (
          <div className="studio-panel studio-loading">
            <Spinner message="Loading the game and its win-probability curve…" />
          </div>
        )}
        {error && (
          <div className="studio-panel studio-empty studio-error" role="alert">
            <p className="studio-eyebrow">Game unavailable</p>
            <h2>We couldn’t load the plays.</h2>
            <p>
              The NBA data service may be unavailable. Choose another game or
              try this one again.
            </p>
            <button
              className="studio-button"
              onClick={() => {
                setLoading(true);
                setError(null);
                setGameRetry((retry) => retry + 1);
              }}
            >
              Try again
            </button>
            <details>
              <summary>Error details</summary>
              {error}
            </details>
          </div>
        )}
        {!game && !loading && !error && (
          <div className="studio-panel studio-welcome">
            <span className="studio-welcome-mark" aria-hidden="true">
              ↗
            </span>
            <p className="studio-eyebrow">Every possession is a possibility</p>
            <h2>One play. A different game.</h2>
            <p>
              Choose a game from the library, find a moment that mattered, and
              see how a different outcome changes its win probability.
            </p>
            <div className="studio-welcome-steps">
              <span>
                01 <b>Choose a game</b>
              </span>
              <span>
                02 <b>Find your moment</b>
              </span>
              <span>
                03 <b>Change the outcome</b>
              </span>
            </div>
            <span className="studio-muted">
              {season} · {seasonType}
            </span>
          </div>
        )}
        {game && !loading && (
          <>
            <header className="studio-scoreboard">
              <div className="studio-score-status">
                <span
                  className={`studio-status-dot ${game.status === 'live' ? 'is-live' : ''}`}
                />
                {game.status === 'live' ? 'Live game' : 'Final score'}
                {game.dataSource && <span> · Downloaded plays</span>}
                {liveError && <span> · Updates delayed</span>}
                <span>
                  {' '}
                  · {season} / {seasonType}
                </span>
              </div>
              <div className="studio-score-teams">
                <div>
                  <span className="studio-team-location">Away</span>
                  <h2>{game.teamB}</h2>
                </div>
                <div className="studio-score-value">
                  {game.plays.at(-1)?.scoreB ?? '—'}
                  <span>:</span>
                  {game.plays.at(-1)?.scoreA ?? '—'}
                </div>
                <div>
                  <span className="studio-team-location">Home</span>
                  <h2>{game.teamA}</h2>
                </div>
              </div>
              <div className="studio-pregame-spread" aria-label="Pregame closing point spread">
                <span className="studio-eyebrow">Pregame spread · Closing</span>
                {hasBettingLine ? <>
                  <span>{game.teamB} <strong>{formatSpread(-game.bettingLine)}</strong></span>
                  <span>{game.teamA} <strong>{formatSpread(game.bettingLine)}</strong></span>
                  {game.bettingLineSource && <a href={game.bettingLineSourceUrl} target="_blank" rel="noreferrer">{game.bettingLineSource}</a>}
                </> : <span className="studio-muted">Unavailable · Model uses a neutral spread</span>}
              </div>
              <div className="studio-score-footer">
                <label className="studio-perspective">
                  Win probability for{' '}
                  <select
                    aria-label="Win probability perspective"
                    value={perspectiveTeam}
                    onChange={(e) => setPerspectiveTeam(e.target.value)}
                  >
                    <option value="A">{game.teamA}</option>
                    <option value="B">{game.teamB}</option>
                  </select>
                </label>
                {hasChanges ? (
                  <span className="studio-tag">{changeLabel}</span>
                ) : (
                  <span className="studio-muted">
                    Original game · Ready to explore
                  </span>
                )}
              </div>
            </header>
            <ScenarioChart
              original={displayOriginal}
              scenario={displayWhatIf}
              hasChanges={hasChanges}
              pending={scenarioPending}
              error={scenarioError}
              team={viewingTeam}
              maxQuarter={maxQuarter}
              selectedPlay={selectedPlay}
              selectedWp={originalPoint?.wp}
              onSelectTime={(seconds) =>
                selectMoment(
                  [...allPlays]
                    .reverse()
                    .find((play) => play.gameSeconds <= seconds),
                  true
                )
              }
            />
            <div className="studio-timeline-control">
              <label htmlFor="moment-scrubber">
                Selected moment{' '}
                <b>
                  {selectedPlay ? playTimeLabel(selectedPlay, maxQuarter) : '—'}
                </b>
              </label>
              <input
                id="moment-scrubber"
                type="range"
                min="0"
                max={Math.max(0, allPlays.length - 1)}
                value={Math.max(0, scenarioIndex)}
                onChange={(e) =>
                  selectMoment(allPlays[Number(e.target.value)], true)
                }
                aria-valuetext={
                  selectedPlay
                    ? `${playTimeLabel(selectedPlay, maxQuarter)}: ${selectedPlay.description}`
                    : 'No play selected'
                }
              />
            </div>
            <section className="studio-key-moments" aria-label="Key moments">
              <p className="studio-eyebrow">Biggest swings</p>
              <div>
                {keyMoments.map((play) => (
                  <button
                    className="studio-moment-button"
                    key={play.eventNum}
                    onClick={() => selectMoment(play, true)}
                  >
                    <span>{playTimeLabel(play, maxQuarter)}</span>
                    <strong>
                      {formatSignedNumber(
                        playImpacts.get(play.eventNum),
                        ' pp'
                      )}
                    </strong>
                    <span>
                      {play.player || play.eventType.replaceAll('_', ' ')}
                    </span>
                  </button>
                ))}
              </div>
            </section>
            <div className="studio-play-workspace">
              <section className="studio-panel studio-play-list">
                <div className="studio-section-heading">
                  <div>
                    <p className="studio-eyebrow">The moments that made it</p>
                    <h2>
                      Play-by-play{' '}
                      <span className="studio-count">
                        {filteredPlays.length}
                      </span>
                    </h2>
                  </div>
                  <button
                    className="studio-button"
                    onClick={() => setShowAddForm(true)}
                  >
                    + Add play
                  </button>
                </div>
                <div className="studio-play-filters">
                  <div
                    className="studio-periods"
                    aria-label="Filter plays by period"
                  >
                    {['all', ...quarters].map((q) => (
                      <button
                        key={q}
                        aria-pressed={quarterFilter === String(q)}
                        onClick={() => setQuarterFilter(String(q))}
                      >
                        {q === 'all'
                          ? 'All'
                          : quarterLabel(Number(q), maxQuarter)}
                      </button>
                    ))}
                  </div>
                  <label className="studio-sr-only" htmlFor="play-search">
                    Search plays or players
                  </label>
                  <input
                    id="play-search"
                    type="search"
                    placeholder="Find a player or play…"
                    value={playSearch}
                    onChange={(e) => setPlaySearch(e.target.value)}
                  />
                </div>
                {selectedEventNums.size > 0 && (
                  <div className="studio-bulk">
                    <span>{selectedEventNums.size} selected</span>
                    <button
                      className="studio-button studio-button-danger"
                      onClick={handleDeleteSelected}
                    >
                      Delete selected
                    </button>
                    <button
                      className="studio-button"
                      onClick={() => setSelectedEventNums(new Set())}
                    >
                      Clear selection
                    </button>
                  </div>
                )}
                <div className="studio-event-labels">
                  <span>Moment / play</span>
                  <span>{hasChanges ? 'Scenario score' : 'Score'}</span>
                  <span>WP change</span>
                </div>
                <div className="studio-events" aria-label="Game plays">
                  {filteredPlays.map((play) => (
                    <div
                      key={play.eventNum}
                      ref={(node) => {
                        if (node) playRefs.current.set(play.eventNum, node);
                        else playRefs.current.delete(play.eventNum);
                      }}
                      className={`studio-event${selectedPlay?.eventNum === play.eventNum ? ' is-active' : ''}${overrides[play.eventNum] || play.edited || play.added ? ' is-edited' : ''}`}
                    >
                      <input
                        type="checkbox"
                        aria-label={`Select ${playTimeLabel(play, maxQuarter)} ${play.description} for deletion`}
                        checked={selectedEventNums.has(play.eventNum)}
                        onChange={() => toggleSelectedPlay(play.eventNum)}
                      />
                      <button
                        className="studio-event-main"
                        aria-pressed={selectedPlay?.eventNum === play.eventNum}
                        onClick={() => selectMoment(play)}
                      >
                        <span className="studio-event-description">
                          <span className="studio-event-time">
                            {playTimeLabel(play, maxQuarter)}{' '}
                            {play.added
                              ? '· Added'
                              : play.edited || overrides[play.eventNum]
                                ? '· Edited'
                                : ''}
                          </span>
                          <span>{play.description || 'Game event'}</span>
                        </span>
                        <span className="studio-event-score">
                          {scoreChanges
                            .get(play.eventNum)
                            ?.after.split('–')
                            .reverse()
                            .join('–') || `${play.scoreB}–${play.scoreA}`}
                        </span>
                        <strong className="studio-event-impact">
                          {playImpacts.has(play.eventNum)
                            ? formatSignedNumber(
                                playImpacts.get(play.eventNum),
                                ' pp'
                              )
                            : '—'}
                        </strong>
                      </button>
                    </div>
                  ))}
                  {filteredPlays.length === 0 && (
                    <div className="studio-empty">
                      <strong>No plays match this view.</strong>
                      <p>Try another period or player.</p>
                      <button
                        className="studio-button"
                        onClick={() => {
                          setQuarterFilter('all');
                          setPlaySearch('');
                        }}
                      >
                        Show all plays
                      </button>
                    </div>
                  )}
                  {game.plays
                    .filter((play) => deletedEventNums.has(play.eventNum))
                    .map((play) => (
                      <div key={play.eventNum} className="studio-deleted-play">
                        <span>
                          <s>{play.description}</s>
                          <small>
                            {playTimeLabel(play, maxQuarter)} · Deleted
                          </small>
                        </span>
                        <button
                          className="studio-button"
                          onClick={() => handleRestorePlay(play.eventNum)}
                        >
                          Restore
                        </button>
                      </div>
                    ))}
                </div>
                <div className="studio-play-footer">
                  <span>WP change in percentage points · {viewingTeam}</span>
                  <label>
                    Delete scope{' '}
                    <select
                      aria-label="Delete scope"
                      value={deleteScope}
                      onChange={(e) => setDeleteScope(e.target.value)}
                    >
                      <option value="single">This play</option>
                      <option value="later">This + later</option>
                    </select>
                  </label>
                </div>
              </section>
              <StudioDrawer
                title="Scenario editor"
                label={
                  selectedPlay
                    ? `Edit ${playTimeLabel(selectedPlay, maxQuarter)}`
                    : 'Edit selected play'
                }
                className="studio-panel scenario-inspector"
              >
                {inspector}
              </StudioDrawer>
            </div>
            <details className="studio-detailed-analysis">
              <summary>Detailed impact analysis</summary>
              <ChangeImpactPanel
                hasChanges={hasChanges && !scenarioPending && !scenarioError}
                changeLabel={changeLabel}
                originalCurve={displayOriginal}
                whatIfCurve={displayWhatIf}
                originalPlays={game.plays}
                addedPlays={addedPlays}
                editedPlays={editedPlays}
                deletedEventNums={deletedEventNums}
                viewingTeam={viewingTeam}
                teamA={game.teamA}
                teamB={game.teamB}
                maxQuarter={maxQuarter}
              />
              <TopImpactsPanel
                plays={allPlays}
                impacts={playImpacts}
                scoreChanges={scoreChanges}
                viewingTeam={viewingTeam}
                scoreTeamA={game.teamA}
                scoreTeamB={game.teamB}
                maxQuarter={maxQuarter}
              />
            </details>
            {showAddForm && (
              <AddPlayForm
                game={game}
                allPlays={allPlays}
                onAdd={handleAddPlay}
                onCancel={() => setShowAddForm(false)}
              />
            )}
            {editingPlay && (
              <AddPlayForm
                game={game}
                allPlays={allPlays}
                initialPlay={editingPlay}
                onSave={handleSaveEdit}
                onCancel={() => setEditingPlay(null)}
              />
            )}
          </>
        )}
      </div>
    </div>
  );
}
