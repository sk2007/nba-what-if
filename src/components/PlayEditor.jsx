import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ReferenceLine, ResponsiveContainer, Brush,
} from 'recharts';
import { fetchPlayByPlay, recomputeWpCurveRemote, subscribeToGame } from '../api/nbaApi';
import GameSelector from './GameSelector';
import Spinner from './Spinner';

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
  form: { background: '#fff', borderRadius: '10px', padding: '28px', width: '420px', boxShadow: '0 8px 32px rgba(0,0,0,0.18)', display: 'flex', flexDirection: 'column', gap: '14px' },
  formTitle: { fontSize: '16px', fontWeight: '700', color: '#1a1a1a', marginBottom: '4px' },
  row: { display: 'flex', flexDirection: 'column', gap: '4px' },
  label: { fontSize: '11px', fontWeight: '600', color: '#888', textTransform: 'uppercase', letterSpacing: '0.05em' },
  select: { padding: '7px 10px', borderRadius: '6px', border: '1px solid #d0d0d0', fontSize: '13px', background: '#fafafa', cursor: 'pointer' },
  quarterBtns: { display: 'flex', gap: '6px', flexWrap: 'wrap' },
  quarterBtn: { padding: '5px 14px', borderRadius: '6px', border: '1px solid #d0d0d0', background: '#fafafa', fontSize: '13px', cursor: 'pointer', color: '#555' },
  quarterBtnActive: { background: '#1a1a1a', color: '#fff', border: '1px solid #1a1a1a' },
  actions: { display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '4px' },
  cancelBtn: { padding: '7px 16px', borderRadius: '6px', border: '1px solid #d0d0d0', background: '#fff', color: '#555', fontSize: '13px', cursor: 'pointer' },
  addBtn: { padding: '7px 16px', borderRadius: '6px', border: 'none', background: '#1a1a1a', color: '#fff', fontSize: '13px', fontWeight: '600', cursor: 'pointer' },
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

// Build period boundaries for a game; maxQuarter > 4 adds OT periods
function buildPeriodBoundaries(maxQuarter) {
  const boundaries = [
    { seconds: 0, label: 'Q1' },
    { seconds: 720, label: 'Q2' },
    { seconds: 1440, label: 'Q3' },
    { seconds: 2160, label: 'Q4' },
  ];
  for (let q = 5; q <= maxQuarter; q++) {
    boundaries.push({
      seconds: REGULATION_SECONDS + (q - 5) * 300,
      label: `OT${q - 4}`,
    });
  }
  return boundaries;
}

function quarterLabel(q, maxQuarter) {
  if (q <= 4) return `Q${q}`;
  return `OT${q - 4}`;
}

function playTimeLabel(play, maxQuarter) {
  return `${quarterLabel(play.quarter, maxQuarter)} ${play.clock}`;
}

function totalSecondsForMaxQuarter(maxQuarter) {
  return maxQuarter <= 4 ? REGULATION_SECONDS : REGULATION_SECONDS + (maxQuarter - 4) * 300;
}

function makeFormatGameTick(boundaries, totalSeconds) {
  return function formatGameTick(s) {
    if (s === totalSeconds) return 'End';
    const b = boundaries.slice().reverse().find((b) => s >= b.seconds);
    return b ? b.label : '';
  };
}

// Convert cumulative gameSeconds → "Q2 · 4:32 left" style string
function gameSecondsToTimeLabel(gameSeconds, boundaries, totalSeconds) {
  if (gameSeconds >= totalSeconds) return 'End of game';
  const period = boundaries.slice().reverse().find((b) => gameSeconds >= b.seconds);
  if (!period) return '';
  const periodIdx = boundaries.indexOf(period);
  const periodEnd = periodIdx + 1 < boundaries.length ? boundaries[periodIdx + 1].seconds : totalSeconds;
  const periodDuration = periodEnd - period.seconds;
  const elapsed = gameSeconds - period.seconds;
  const remaining = periodDuration - elapsed;
  const min = Math.floor(remaining / 60);
  const sec = remaining % 60;
  return `${period.label} · ${min}:${String(sec).padStart(2, '0')} left`;
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

// Kept as a fallback for the static QUARTER_BOUNDARIES reference in AddPlayForm
const QUARTER_BOUNDARIES = buildPeriodBoundaries(4);

// Find the top N momentum swings in a wpCurve over a sliding window of windowSecs seconds.
// Returns array of { startSeconds, endSeconds, startWp, endWp, delta, peakSeconds }.
function detectMomentumSwings(wpCurve, { topN = 3, windowSecs = 120, minDelta = 15 } = {}) {
  if (wpCurve.length < 2) return [];
  const swings = [];
  for (let i = 0; i < wpCurve.length; i++) {
    const start = wpCurve[i];
    for (let j = i + 1; j < wpCurve.length; j++) {
      const end = wpCurve[j];
      if (end.gameSeconds - start.gameSeconds > windowSecs) break;
      const delta = Math.abs(end.wp - start.wp);
      if (delta >= minDelta) {
        swings.push({ startSeconds: start.gameSeconds, endSeconds: end.gameSeconds, startWp: start.wp, endWp: end.wp, delta });
      }
    }
  }
  // Deduplicate overlapping swings: keep only non-overlapping top swings
  swings.sort((a, b) => b.delta - a.delta);
  const kept = [];
  for (const s of swings) {
    const overlaps = kept.some(
      (k) => s.startSeconds < k.endSeconds && s.endSeconds > k.startSeconds
    );
    if (!overlaps) {
      kept.push(s);
      if (kept.length === topN) break;
    }
  }
  return kept;
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
            const wpColor = wpDelta > 0 ? '#16a34a' : wpDelta < 0 ? '#dc2626' : '#64748b';

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
  panel: { background: '#fff', borderRadius: '8px', padding: '16px 20px', boxShadow: '0 1px 3px rgba(0,0,0,0.08)', marginBottom: '16px' },
  header: { display: 'flex', justifyContent: 'space-between', gap: '18px', alignItems: 'flex-start', flexWrap: 'wrap' },
  title: { fontSize: '13px', fontWeight: '700', color: '#1a1a1a', marginBottom: '4px' },
  meta: { fontSize: '11px', color: '#94a3b8' },
  totals: { display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end' },
  totalItem: { fontSize: '12px', fontWeight: '700', color: '#1f2937', background: '#f8fafc', border: '1px solid #e5e7eb', borderRadius: '6px', padding: '5px 8px' },
  rows: { display: 'flex', flexDirection: 'column', gap: '6px', marginTop: '12px' },
  row: { display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0, paddingTop: '6px', borderTop: '1px solid #f1f5f9' },
  badge: { width: 52, fontSize: '10px', fontWeight: '700', color: '#475569', textTransform: 'uppercase', letterSpacing: '0.04em' },
  time: { width: 66, fontSize: '11px', color: '#64748b', flexShrink: 0 },
  desc: { flex: 1, minWidth: 120, fontSize: '12px', color: '#1f2937', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  wpDelta: { width: 96, textAlign: 'right', fontSize: '12px', fontWeight: '700', flexShrink: 0 },
  scoreDelta: { width: 330, fontSize: '11px', color: '#64748b', textAlign: 'right', flexShrink: 0 },
};

// Shared chart content so both inline and expanded views use the same rendering
function WinProbChartContent({ data, color, teamA, teamB, height, showBrush, domain, onBrushChange, maxQuarter, swings }) {
  const mq = maxQuarter ?? 4;
  const boundaries = buildPeriodBoundaries(mq);
  const totalSeconds = totalSecondsForMaxQuarter(mq);
  const formatGameTick = makeFormatGameTick(boundaries, totalSeconds);

  const xDomain = domain ?? [0, totalSeconds];
  const allTicks = boundaries.map((b) => b.seconds).concat([totalSeconds]);
  const visibleTicks = allTicks.filter((t) => t >= xDomain[0] && t <= xDomain[1]);

  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 8, right: 16, left: 0, bottom: showBrush ? 32 : 16 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
        <XAxis
          dataKey="gameSeconds"
          type="number"
          domain={xDomain}
          label={!showBrush ? { value: 'Game Time (s)', position: 'insideBottom', offset: -8, fontSize: 12 } : undefined}
          ticks={visibleTicks}
          tickFormatter={formatGameTick}
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
            const timeStr = gameSecondsToTimeLabel(label, boundaries, totalSeconds);
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
        {showBrush && (
          <Brush
            dataKey="gameSeconds"
            height={24}
            stroke={color}
            fill="#f9fafb"
            onChange={(range) => {
              if (!onBrushChange || range.startIndex == null) return;
              const s = data[range.startIndex]?.gameSeconds ?? 0;
              const e = data[range.endIndex]?.gameSeconds ?? totalSeconds;
              onBrushChange([s, e]);
            }}
            tickFormatter={(s) => {
              const q = QUARTER_BOUNDARIES.slice().reverse().find((b) => s >= b.seconds);
              return q ? q.label : '';
            }}
          />
        )}
      </LineChart>
    </ResponsiveContainer>
  );
}

// Fullscreen expanded modal for a single chart
function ChartModal({ data, title, color, teamA, teamB, onClose, maxQuarter, swings }) {
  const totalSeconds = totalSecondsForMaxQuarter(maxQuarter ?? 4);
  const [domain, setDomain] = useState([0, totalSeconds]);
  const chartContainerRef = useRef(null);
  // Track cursor x-fraction (0–1) over the chart area for zoom centering
  const cursorFracRef = useRef(0.5);

  const isZoomed = domain[0] !== 0 || domain[1] !== totalSeconds;

  // Close on Escape, reset zoom on double-click
  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Trackpad/wheel pinch-to-zoom on the chart container
  useEffect(() => {
    const el = chartContainerRef.current;
    if (!el) return;

    function onMouseMove(e) {
      const rect = el.getBoundingClientRect();
      // The Recharts left margin (YAxis width) is ~42px; right margin ~16px
      const leftOffset = 42;
      const rightOffset = 16;
      const plotWidth = rect.width - leftOffset - rightOffset;
      const x = e.clientX - rect.left - leftOffset;
      cursorFracRef.current = Math.max(0, Math.min(1, x / plotWidth));
    }

    function onWheel(e) {
      const isPinch = e.ctrlKey || e.metaKey;
      const isHorizontal = !isPinch && Math.abs(e.deltaX) > Math.abs(e.deltaY);

      if (!isPinch && !isHorizontal) return;
      e.preventDefault();

      if (isPinch) {
        setDomain((prev) => {
          const span = prev[1] - prev[0];
          // deltaY > 0 → zoom out, < 0 → zoom in
          const zoomFactor = e.deltaY > 0 ? 1.15 : 0.87;
          const newSpan = Math.min(totalSeconds, Math.max(60, span * zoomFactor));
          const center = prev[0] + span * cursorFracRef.current;
          let newStart = center - newSpan * cursorFracRef.current;
          let newEnd = newStart + newSpan;
          if (newStart < 0) { newStart = 0; newEnd = newSpan; }
          if (newEnd > totalSeconds) { newEnd = totalSeconds; newStart = totalSeconds - newSpan; }
          return [Math.round(newStart), Math.round(newEnd)];
        });
      } else {
        // Horizontal pan: deltaX > 0 → scroll right (forward in time)
        setDomain((prev) => {
          const span = prev[1] - prev[0];
          // Scale pan speed proportionally to current zoom level
          const panAmount = (e.deltaX / 300) * span;
          let newStart = prev[0] + panAmount;
          let newEnd = prev[1] + panAmount;
          if (newStart < 0) { newStart = 0; newEnd = span; }
          if (newEnd > totalSeconds) { newEnd = totalSeconds; newStart = totalSeconds - span; }
          return [Math.round(newStart), Math.round(newEnd)];
        });
      }
    }

    el.addEventListener('mousemove', onMouseMove);
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      el.removeEventListener('mousemove', onMouseMove);
      el.removeEventListener('wheel', onWheel);
    };
  }, []);

  return (
    <div style={chartModalStyles.overlay} onClick={onClose}>
      <div style={chartModalStyles.panel} onClick={(e) => e.stopPropagation()}>
        <div style={chartModalStyles.header}>
          <span style={chartModalStyles.title}>{title}</span>
          <div style={chartModalStyles.headerRight}>
            <span style={chartModalStyles.hint}>Pinch to zoom · swipe left/right to pan · drag range bar · hover for details</span>
            {isZoomed && (
              <button
                onClick={() => setDomain([0, totalSeconds])}
                style={{ ...chartModalStyles.closeBtn, borderColor: color, color }}
              >
                Reset zoom
              </button>
            )}
            <button onClick={onClose} style={chartModalStyles.closeBtn}>✕</button>
          </div>
        </div>
        <div style={chartModalStyles.body} ref={chartContainerRef}>
          <WinProbChartContent
            data={data}
            color={color}
            teamA={teamA}
            teamB={teamB}
            height={420}
            showBrush
            domain={domain}
            onBrushChange={setDomain}
            maxQuarter={maxQuarter}
            swings={swings}
          />
        </div>
        <div style={chartModalStyles.footer}>
          <span style={{ color: '#999', fontSize: '12px' }}>{teamA} win probability over game time</span>
        </div>
      </div>
    </div>
  );
}

const chartModalStyles = {
  overlay: {
    position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)',
    display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200,
  },
  panel: {
    background: '#fff', borderRadius: '12px', width: 'min(92vw, 900px)',
    boxShadow: '0 16px 64px rgba(0,0,0,0.25)', display: 'flex', flexDirection: 'column',
  },
  header: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    padding: '18px 24px 0', gap: '12px',
  },
  title: { fontSize: '16px', fontWeight: '700', color: '#1a1a1a' },
  headerRight: { display: 'flex', alignItems: 'center', gap: '16px' },
  hint: { fontSize: '11px', color: '#aaa' },
  closeBtn: {
    padding: '4px 10px', borderRadius: '6px', border: '1px solid #e0e0e0',
    background: '#fafafa', color: '#555', fontSize: '13px', cursor: 'pointer',
  },
  body: { padding: '16px 24px 8px' },
  footer: { padding: '0 24px 16px' },
};

function WinProbChart({ data, title, color, teamA, teamB, maxQuarter, swings }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <>
      <div className="surface-card" style={styles.chartPanel}>
        <div style={styles.chartTitleRow}>
          <h3 style={styles.chartTitle}>{title}</h3>
          <button
            onClick={() => setExpanded(true)}
            style={styles.expandBtn}
            title="Expand chart"
          >
            ⤢ Expand
          </button>
        </div>
        <WinProbChartContent
          data={data}
          color={color}
          teamA={teamA}
          teamB={teamB}
          height={260}
          showBrush={false}
          maxQuarter={maxQuarter}
          swings={swings}
        />
      </div>

      {expanded && (
        <ChartModal
          data={data}
          title={title}
          color={color}
          teamA={teamA}
          teamB={teamB}
          onClose={() => setExpanded(false)}
          maxQuarter={maxQuarter}
          swings={swings}
        />
      )}
    </>
  );
}

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
        const color = positive ? '#16a34a' : '#dc2626';
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
  panel: { background: '#fff', borderRadius: '8px', padding: '16px 20px', boxShadow: '0 1px 3px rgba(0,0,0,0.08)', marginBottom: '16px' },
  title: { fontSize: '13px', fontWeight: '700', color: '#1a1a1a', marginBottom: '10px' },
  row: { display: 'flex', alignItems: 'center', gap: '10px', padding: '5px 0', borderBottom: '1px solid #f5f5f5' },
  rank: { fontSize: '11px', fontWeight: '700', color: '#bbb', width: '24px', flexShrink: 0 },
  time: { fontSize: '11px', color: '#888', width: '72px', flexShrink: 0 },
  playInfo: { flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: '3px' },
  desc: { fontSize: '12px', color: '#1a1a1a', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  scoreChange: { fontSize: '11px', fontWeight: '700', color: '#2563eb' },
  scoreUnchanged: { fontSize: '11px', color: '#94a3b8' },
  impact: { fontSize: '13px', fontWeight: '700', width: '52px', textAlign: 'right', flexShrink: 0 },
  footer: { fontSize: '11px', color: '#bbb', marginTop: '8px' },
};

export default function PlayEditor({ season, seasonType }) {
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

  useEffect(() => {
    setGameId(null);
    setGame(null);
    setOverrides({});
    setAddedPlays([]);
    setEditedPlays({});
    setDeletedEventNums(new Set());
    setSelectedEventNums(new Set());
    setShowAddForm(false);
    setEditingPlay(null);
  }, [season, seasonType]);

  useEffect(() => {
    if (!gameId) return;
    setLoading(true);
    setError(null);
    setOverrides({});
    setAddedPlays([]);
    setEditedPlays({});
    setDeletedEventNums(new Set());
    setSelectedEventNums(new Set());
    setShowAddForm(false);
    setEditingPlay(null);
    setPerspectiveTeam('A');
    fetchPlayByPlay(gameId)
      .then((data) => { setGame(data); setLoading(false); })
      .catch((e) => { setError(e.message); setLoading(false); });
  }, [gameId]);

  // Subscribe to live updates when the loaded game is in progress.
  useEffect(() => {
    if (!game || game.status !== 'live') return;
    setLiveError(false);

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
          setGame((prev) => (prev ? { ...prev, status: 'finished' } : prev));
        } else if (gameStatus === 'error') {
          setLiveError(true);
        }
      },
      onError: () => setLiveError(true),
    });
    return cleanup;
  }, [game?.status, gameId]);

  const handleOverride = useCallback((eventNum, result) => {
    setOverrides((prev) => {
      const next = { ...prev };
      const allPlays = [...(game?.plays ?? []).map((p) => editedPlays[p.eventNum] ?? p), ...addedPlays];
      const play = allPlays.find((p) => p.eventNum === eventNum);
      const originalResult = play?.shotPts > 0 ? 'Made' : 'Missed';
      if (result === originalResult && !play?.added) {
        delete next[eventNum];
      } else {
        next[eventNum] = result;
      }
      return next;
    });
  }, [game, addedPlays, editedPlays]);

  const handleAddPlay = useCallback((play) => {
    setAddedPlays((prev) => [...prev, play]);
    setShowAddForm(false);
  }, []);

  const handleSaveEdit = useCallback((updatedPlay) => {
    if (updatedPlay.added) {
      setAddedPlays((prev) => prev.map((p) => p.eventNum === updatedPlay.eventNum ? updatedPlay : p));
    } else {
      setEditedPlays((prev) => ({ ...prev, [updatedPlay.eventNum]: updatedPlay }));
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

  const handleDeletePlay = useCallback((eventNum) => {
    const plays = [...(game?.plays ?? []).map((p) => editedPlays[p.eventNum] ?? p), ...addedPlays];
    const target = plays.find((p) => p.eventNum === eventNum);
    if (!target) return;
    const eventNums = deleteScope === 'later'
      ? plays.filter((p) => p.gameSeconds >= target.gameSeconds).map((p) => p.eventNum)
      : [eventNum];

    setAddedPlays((prev) => prev.filter((p) => !eventNums.includes(p.eventNum)));
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
  }, [addedPlays, clearOverridesFor, deleteScope, editedPlays, game]);

  const handleDeleteSelected = useCallback(() => {
    const eventNums = [...selectedEventNums];
    if (!eventNums.length) return;
    setAddedPlays((prev) => prev.filter((p) => !eventNums.includes(p.eventNum)));
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
  const allPlays = useMemo(() => (
    game
      ? [...game.plays.map((p) => editedPlays[p.eventNum] ?? p).filter((p) => !deletedEventNums.has(p.eventNum)), ...addedPlays]
        .slice()
        .sort((a, b) => a.gameSeconds - b.gameSeconds || a.eventNum - b.eventNum)
      : []
  ), [addedPlays, deletedEventNums, editedPlays, game]);
  const hasChanges = Object.keys(overrides).length > 0 || addedPlays.length > 0 || Object.keys(editedPlays).length > 0 || deletedEventNums.size > 0;

  const [whatIfCurve, setWhatIfCurve] = useState([]);
  const wpDebounceRef = useRef(null);
  useEffect(() => {
    if (!game) { setWhatIfCurve([]); return; }
    if (!hasChanges) { setWhatIfCurve(game.wpCurve); return; }
    if (wpDebounceRef.current) clearTimeout(wpDebounceRef.current);
    const plays = allPlays;
    wpDebounceRef.current = setTimeout(() => {
      recomputeWpCurveRemote(plays, overrides, game.teamA, game.bettingLine ?? 0)
        .then(setWhatIfCurve)
        .catch(() => {});
    }, 300);
    return () => clearTimeout(wpDebounceRef.current);
  }, [game, allPlays, overrides, hasChanges]);

  const quarters = [...new Set(allPlays.map((p) => p.quarter))].sort((a, b) => a - b);
  const filteredPlays = (quarterFilter === 'all' ? allPlays : allPlays.filter((p) => p.quarter === Number(quarterFilter)))
    .slice().sort((a, b) => b.gameSeconds - a.gameSeconds);

  const changeLabel = (() => {
    const parts = [];
    if (addedPlays.length > 0) parts.push(`${addedPlays.length} added`);
    if (Object.keys(editedPlays).length > 0) parts.push(`${Object.keys(editedPlays).length} play details changed`);
    if (Object.keys(overrides).length > 0) parts.push(`${Object.keys(overrides).length} edited`);
    if (deletedEventNums.size > 0) parts.push(`${deletedEventNums.size} deleted`);
    return parts.join(', ');
  })();

  // Flip wp values when viewing from teamB's perspective
  const flipCurve = (curve) =>
    curve.map((pt) => ({ ...pt, wp: Math.round((100 - pt.wp) * 10) / 10 }));

  const viewingTeam = perspectiveTeam === 'A' ? game?.teamA : game?.teamB;
  const displayOriginal = perspectiveTeam === 'A' ? (game?.wpCurve ?? []) : flipCurve(game?.wpCurve ?? []);
  const displayWhatIf  = perspectiveTeam === 'A' ? whatIfCurve : flipCurve(whatIfCurve);
  const maxQuarter = game ? Math.max(...allPlays.map((p) => p.quarter), 4) : 4;

  const originalSwings = detectMomentumSwings(displayOriginal);
  const whatIfSwings = detectMomentumSwings(displayWhatIf);
  // Impact scores computed against the active (what-if or original) curve
  const activeCurve = hasChanges ? displayWhatIf : displayOriginal;
  const playImpacts = computePlayImpacts(allPlays, activeCurve);
  const scoreChanges = computeScoreChanges(allPlays, activeCurve);

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
          <button onClick={() => { setOverrides({}); setAddedPlays([]); setEditedPlays({}); setDeletedEventNums(new Set()); setSelectedEventNums(new Set()); }} style={styles.resetBtn}>
            Reset ({changeLabel})
          </button>
        )}
      </div>

      {loading && <Spinner message="Loading play-by-play…" />}
      {error && <p style={styles.errorText}>Error: {error}</p>}

      {game && !loading && (
        <>
          <div style={styles.subtitleRow}>
            <span style={styles.subtitle}>
              {game.status === 'live' && <span style={styles.liveBadge}>● LIVE</span>}
              {game.status === 'live' && liveError && <span style={styles.liveErrorBadge}>⚠ updates delayed</span>}
              {game.status === 'finished' && game.plays.length > 0 && <span style={styles.finalBadge}>FINAL</span>}
              {game.teamA} {game.plays.at(-1)?.scoreA ?? '—'} – {game.plays.at(-1)?.scoreB ?? '—'} {game.teamB}
              {game.bettingLine !== undefined && ` · line ${game.bettingLine > 0 ? '+' : ''}${game.bettingLine}`}
            </span>
            <div style={styles.perspectiveRow}>
              <label style={styles.perspectiveLabel}>Viewing:</label>
              <select
                value={perspectiveTeam}
                onChange={(e) => setPerspectiveTeam(e.target.value)}
                style={styles.perspectiveSelect}
              >
                <option value="A">{game.teamA}</option>
                <option value="B">{game.teamB}</option>
              </select>
            </div>
          </div>
          <div className="chart-grid" style={styles.chartsRow}>
            <WinProbChart data={displayOriginal} title="Original" color="#2563eb" teamA={viewingTeam} teamB={perspectiveTeam === 'A' ? game.teamB : game.teamA} maxQuarter={maxQuarter} swings={originalSwings} />
            <WinProbChart
              data={displayWhatIf}
              title={hasChanges ? `What If (${changeLabel})` : 'What If (no edits yet)'}
              color="#dc2626"
              teamA={viewingTeam}
              teamB={perspectiveTeam === 'A' ? game.teamB : game.teamA}
              maxQuarter={maxQuarter}
              swings={whatIfSwings}
            />
          </div>

          <ChangeImpactPanel
            hasChanges={hasChanges}
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

          <div className="surface-card" style={styles.playList}>
            <div className="play-list-header" style={styles.playListHeader}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <h3 style={styles.playListTitle}>Play-by-Play</h3>
                <span style={styles.hint}>{allPlays.length} events{changeLabel ? ` (${changeLabel})` : ''}</span>
              </div>
              <button onClick={() => setShowAddForm(true)} style={styles.addPlayBtn}>
                + Add Play
              </button>
            </div>

            <div className="filter-strip" style={styles.filterRow}>
              <label style={styles.filterLabel}>Quarter:</label>
              {['all', ...quarters].map((q) => (
                <button
                  key={q}
                  onClick={() => setQuarterFilter(String(q))}
                  style={{ ...styles.filterBtn, ...(quarterFilter === String(q) ? styles.filterBtnActive : {}) }}
                >
                  {q === 'all' ? 'All' : quarterLabel(Number(q), maxQuarter)}
                </button>
              ))}
              <span style={styles.filterSpacer} />
              <label style={styles.filterLabel}>Delete:</label>
              <select value={deleteScope} onChange={(e) => setDeleteScope(e.target.value)} style={styles.deleteScopeSelect}>
                <option value="single">This play</option>
                <option value="later">This + later</option>
              </select>
              {selectedEventNums.size > 0 && (
                <button onClick={handleDeleteSelected} style={styles.bulkDeleteBtn}>
                  Delete Selected ({selectedEventNums.size})
                </button>
              )}
            </div>

            <div className="responsive-scroll" style={styles.table}>
              <div className="responsive-table">
              <div style={styles.tableHeader}>
                <span style={{ width: 28 }}></span>
                <span style={{ width: 80 }}>Time</span>
                <span style={{ flex: 1 }}>Description</span>
                <span style={{ width: 100 }}>Outcome</span>
                <span style={{ width: 72, textAlign: 'right' }}>WP Impact</span>
                <span style={{ width: 68, textAlign: 'right' }}></span>
              </div>
              {filteredPlays.map((play) => {
                const isEdited = overrides[play.eventNum] !== undefined;
                const isDetailEdited = Boolean(play.edited);
                const currentResult = overrides[play.eventNum] ?? (play.shotPts > 0 ? 'Made' : 'Missed');
                const impact = playImpacts.get(play.eventNum);
                const impactAbs = impact != null ? Math.abs(impact) : 0;
                const impactColor = impact == null ? '#ccc' : impact > 0 ? '#16a34a' : impact < 0 ? '#dc2626' : '#999';
                const impactLabel = impact == null ? '—' : `${impact > 0 ? '+' : ''}${impact}%`;
                return (
                  <div className="table-row-interactive" key={play.eventNum} style={{ ...styles.tableRow, ...(play.added ? styles.tableRowAdded : (isEdited || isDetailEdited) ? styles.tableRowEdited : {}) }}>
                    <span style={styles.selectCell}>
                      <input
                        type="checkbox"
                        checked={selectedEventNums.has(play.eventNum)}
                        onChange={() => toggleSelectedPlay(play.eventNum)}
                      />
                    </span>
                    <span style={styles.timeCell}>
                      {playTimeLabel(play, maxQuarter)}
                      {play.added && <span style={styles.addedBadge}>new</span>}
                      {isDetailEdited && <span style={styles.editedBadge}>edit</span>}
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
                    <span style={{ width: 72, textAlign: 'right', fontSize: '12px', fontWeight: impactAbs >= 5 ? '700' : '400', color: impactColor }}>
                      {impactLabel}
                    </span>
                    <span style={styles.rowActions}>
                      <button
                        title="Edit play"
                        onClick={() => setEditingPlay(play)}
                        style={styles.rowActionBtn}
                      >✎</button>
                      <button
                        title="Delete play"
                        onClick={() => handleDeletePlay(play.eventNum)}
                        style={{ ...styles.rowActionBtn, ...styles.rowDeleteBtn }}
                      >×</button>
                    </span>
                  </div>
                );
              })}
              {/* Deleted original plays shown at bottom with restore option */}
              {[...(game?.plays ?? [])].filter((p) => deletedEventNums.has(p.eventNum) &&
                (quarterFilter === 'all' || p.quarter === Number(quarterFilter))).map((play) => (
                <div key={play.eventNum} style={{ ...styles.tableRow, ...styles.tableRowDeleted }}>
                  <span style={styles.selectCell}></span>
                  <span style={{ ...styles.timeCell, opacity: 0.5 }}>{playTimeLabel(play, maxQuarter)}</span>
                  <span style={{ ...styles.descCell, opacity: 0.5, textDecoration: 'line-through' }}>{play.description || '—'}</span>
                  <span style={{ width: 100 }}><span style={styles.deletedBadge}>deleted</span></span>
                  <span style={{ width: 72 }}></span>
                  <span style={styles.rowActions}>
                    <button
                      title="Restore play"
                      onClick={() => handleRestorePlay(play.eventNum)}
                      style={{ ...styles.rowActionBtn, ...styles.rowRestoreBtn }}
                    >↩</button>
                  </span>
                </div>
              ))}
              </div>
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
  );
}

const styles = {
  selectorRow: { display: 'flex', gap: '16px', alignItems: 'flex-end', marginBottom: '16px', flexWrap: 'wrap' },
  resetBtn: { padding: '7px 14px', borderRadius: '6px', border: '1px solid #dc2626', background: '#fff', color: '#dc2626', fontSize: '13px', cursor: 'pointer', alignSelf: 'flex-end' },
  status: { color: '#888', fontSize: '14px', padding: '32px 0', textAlign: 'center' },
  errorText: { color: '#dc2626', fontSize: '13px', padding: '12px 0' },
  subtitleRow: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px', flexWrap: 'wrap', gap: '8px' },
  subtitle: { fontSize: '13px', color: '#666' },
  liveBadge: { color: '#dc2626', fontWeight: '700', fontSize: '12px', marginRight: '10px', letterSpacing: '0.03em' },
  finalBadge: { color: '#64748b', fontWeight: '700', fontSize: '12px', marginRight: '10px', letterSpacing: '0.03em' },
  liveErrorBadge: { color: '#b45309', fontWeight: '600', fontSize: '12px', marginRight: '10px' },
  perspectiveRow: { display: 'flex', alignItems: 'center', gap: '8px' },
  perspectiveLabel: { fontSize: '11px', fontWeight: '600', color: '#888', textTransform: 'uppercase', letterSpacing: '0.05em', whiteSpace: 'nowrap' },
  perspectiveSelect: { padding: '5px 10px', borderRadius: '6px', border: '1px solid #d0d0d0', fontSize: '13px', background: '#fafafa', cursor: 'pointer' },
  chartsRow: { display: 'flex', gap: '16px', marginBottom: '24px' },
  chartPanel: { flex: 1, background: '#fff', borderRadius: '8px', padding: '16px', boxShadow: '0 1px 3px rgba(0,0,0,0.08)' },
  chartTitleRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' },
  chartTitle: { fontSize: '15px', fontWeight: '600', color: '#1a1a1a' },
  expandBtn: {
    padding: '3px 10px', borderRadius: '5px', border: '1px solid #d0d0d0',
    background: '#fafafa', color: '#555', fontSize: '11px', cursor: 'pointer',
    letterSpacing: '0.02em',
  },
  playList: { background: '#fff', borderRadius: '8px', padding: '20px', boxShadow: '0 1px 3px rgba(0,0,0,0.08)' },
  playListHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' },
  playListTitle: { fontSize: '14px', fontWeight: '600', color: '#1a1a1a' },
  hint: { fontSize: '12px', color: '#999' },
  filterRow: { display: 'flex', gap: '6px', alignItems: 'center', marginBottom: '10px' },
  filterLabel: { fontSize: '11px', fontWeight: '600', color: '#888', textTransform: 'uppercase', letterSpacing: '0.05em' },
  filterBtn: { padding: '4px 10px', borderRadius: '4px', border: '1px solid #e0e0e0', background: '#fafafa', fontSize: '12px', cursor: 'pointer', color: '#555' },
  filterBtnActive: { background: '#1a1a1a', color: '#fff', border: '1px solid #1a1a1a' },
  filterSpacer: { flex: 1 },
  deleteScopeSelect: { padding: '4px 8px', borderRadius: '4px', border: '1px solid #e0e0e0', background: '#fafafa', fontSize: '12px', color: '#555' },
  bulkDeleteBtn: { padding: '4px 10px', borderRadius: '4px', border: '1px solid #fca5a5', background: '#fff5f5', color: '#dc2626', fontSize: '12px', fontWeight: '600', cursor: 'pointer' },
  table: { maxHeight: '400px', overflowY: 'auto' },
  tableHeader: { display: 'flex', gap: '8px', padding: '6px 8px', background: '#f5f5f5', borderRadius: '4px', fontSize: '11px', fontWeight: '600', color: '#888', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '2px', position: 'sticky', top: 0 },
  tableRow: { display: 'flex', gap: '8px', alignItems: 'center', padding: '6px 8px', borderBottom: '1px solid #f5f5f5' },
  tableRowEdited: { background: '#fff8f0' },
  tableRowAdded: { background: '#f0fdf4', borderLeft: '3px solid #16a34a' },
  selectCell: { width: 28, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' },
  timeCell: { width: 80, fontSize: '12px', color: '#666', fontWeight: '600', flexShrink: 0, display: 'flex', alignItems: 'center', gap: '4px' },
  addedBadge: { fontSize: '10px', fontWeight: '700', color: '#16a34a', background: '#dcfce7', borderRadius: '3px', padding: '1px 4px', textTransform: 'uppercase', letterSpacing: '0.04em' },
  editedBadge: { fontSize: '10px', fontWeight: '700', color: '#b45309', background: '#fef3c7', borderRadius: '3px', padding: '1px 4px', textTransform: 'uppercase', letterSpacing: '0.04em' },
  addPlayBtn: { padding: '6px 14px', borderRadius: '6px', border: '1px solid #16a34a', background: '#f0fdf4', color: '#16a34a', fontSize: '13px', fontWeight: '600', cursor: 'pointer' },
  descCell: { flex: 1, fontSize: '13px', color: '#1a1a1a' },
  outcomeSelect: { padding: '3px 6px', borderRadius: '4px', border: '1px solid #d0d0d0', fontSize: '12px', cursor: 'pointer', background: '#fafafa', width: '80px' },
  outcomeSelectEdited: { border: '1px solid #f59e0b', background: '#fffbeb' },
  nonEditable: { color: '#ccc', fontSize: '13px' },
  tableRowDeleted: { background: '#fef2f2', borderLeft: '3px solid #dc2626', opacity: 0.75 },
  deletedBadge: { fontSize: '10px', fontWeight: '700', color: '#dc2626', background: '#fee2e2', borderRadius: '3px', padding: '1px 4px', textTransform: 'uppercase', letterSpacing: '0.04em' },
  rowActions: { width: 68, display: 'flex', justifyContent: 'flex-end', gap: '4px', flexShrink: 0 },
  rowActionBtn: { padding: '2px 6px', borderRadius: '4px', border: '1px solid #d0d0d0', background: '#fafafa', color: '#555', fontSize: '13px', cursor: 'pointer', lineHeight: 1.2 },
  rowDeleteBtn: { color: '#dc2626', border: '1px solid #fca5a5', background: '#fff5f5' },
  rowRestoreBtn: { color: '#16a34a', border: '1px solid #86efac', background: '#f0fdf4' },
};
