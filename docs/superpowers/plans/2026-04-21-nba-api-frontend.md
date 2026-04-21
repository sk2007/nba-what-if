# NBA What If — Frontend Upgrade Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade the React frontend to consume the Flask backend — real play-by-play in the Play Editor (game clock x-axis, all event types) and real historical win rates in the Stat Model.

**Architecture:** Add `src/api/nbaApi.js` as the single API layer. Lift season/season-type state to `App.jsx`. Add `SeasonSelector` and `GameSelector` components. Rewrite `PlayEditor` and update `StatModel` to use live data. Configure Vite proxy so `/api/*` forwards to `localhost:5001`.

**Tech Stack:** React, Recharts, Vite proxy

**Prerequisite:** The Flask backend (see `docs/superpowers/plans/2026-04-21-nba-api-backend.md`) must be running on `localhost:5001` before testing any frontend changes.

---

## File Map

| File | Change |
|------|--------|
| `vite.config.js` | Add `/api` proxy to `localhost:5001` |
| `src/api/nbaApi.js` | NEW: fetch wrappers + client-side `recomputeWpCurve` |
| `src/data/statModel.js` | Remove `calcWinProb` and `defaultValues`; keep `sliderConfig` only |
| `src/components/SeasonSelector.jsx` | NEW: season + season type dropdowns |
| `src/components/GameSelector.jsx` | NEW: game dropdown, calls `/api/games` |
| `src/components/PlayEditor.jsx` | REWRITE: real play-by-play, game clock x-axis, PlayList |
| `src/components/StatModel.jsx` | UPDATE: debounced `/api/stats/winprob` calls, show match count |
| `src/App.jsx` | Add season/seasonType state, render SeasonSelector above tabs |
| `src/data/plays.js` | DELETE (no longer used) |
| `src/data/gameData.js` | DELETE (replaced by `src/api/nbaApi.js`) |

---

## Task 1: Configure Vite proxy

**Files:**
- Modify: `vite.config.js`

- [ ] **Step 1: Read the current vite.config.js**

```bash
cat /Users/sampath/BSA-Basketball-S26/vite.config.js
```

- [ ] **Step 2: Add the proxy config**

Replace `vite.config.js` with:

```js
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': 'http://localhost:5001',
    },
  },
})
```

- [ ] **Step 3: Verify build still passes**

```bash
cd /Users/sampath/BSA-Basketball-S26
npm run build 2>&1 | tail -5
```

Expected: `✓ built in` with no errors.

- [ ] **Step 4: Commit**

```bash
git add vite.config.js
git commit -m "feat: add Vite proxy for /api → localhost:5001"
```

---

## Task 2: Create `src/api/nbaApi.js`

**Files:**
- Create: `src/api/nbaApi.js`

- [ ] **Step 1: Create `src/api/nbaApi.js`**

```js
// Thin fetch wrappers for the Flask backend. All functions throw on non-OK responses.

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

// Client-side win probability recomputation when user flips play outcomes.
// plays: array of play objects from the API ({ eventNum, editable, team, shotPts, gameSeconds, ... })
// overrides: { [eventNum]: 'Made' | 'Missed' }
// teamA: string — the team whose win probability is tracked
// totalSeconds: total game seconds (2880 for regulation)
// Returns array of { gameSeconds, wp }
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
      // Undo the original made shot
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
```

- [ ] **Step 2: Verify it builds**

```bash
cd /Users/sampath/BSA-Basketball-S26
npm run build 2>&1 | tail -5
```

Expected: `✓ built in` with no errors.

- [ ] **Step 3: Commit**

```bash
git add src/api/nbaApi.js
git commit -m "feat: add nbaApi.js with fetch wrappers and recomputeWpCurve"
```

---

## Task 3: Trim `src/data/statModel.js` and delete unused data files

**Files:**
- Modify: `src/data/statModel.js`
- Delete: `src/data/plays.js`
- Delete: `src/data/gameData.js`

- [ ] **Step 1: Replace `src/data/statModel.js`** — keep only `sliderConfig`, remove formula:

```js
export const sliderConfig = [
  {
    key: 'threePointPct',
    label: '3-Point %',
    min: 0,
    max: 100,
    default: 35,
    unit: '%',
    direction: 1,
  },
  {
    key: 'fgPct',
    label: 'Field Goal %',
    min: 0,
    max: 100,
    default: 45,
    unit: '%',
    direction: 1,
  },
  {
    key: 'turnovers',
    label: 'Turnovers',
    min: 0,
    max: 30,
    default: 14,
    unit: '',
    direction: -1,
  },
  {
    key: 'rebounds',
    label: 'Rebounds',
    min: 0,
    max: 60,
    default: 40,
    unit: '',
    direction: 1,
  },
  {
    key: 'ftPct',
    label: 'Free Throw %',
    min: 0,
    max: 100,
    default: 75,
    unit: '%',
    direction: 1,
  },
];
```

- [ ] **Step 2: Delete unused data files**

```bash
rm /Users/sampath/BSA-Basketball-S26/src/data/plays.js
rm /Users/sampath/BSA-Basketball-S26/src/data/gameData.js
```

- [ ] **Step 3: Verify build still passes (confirms nothing imports the deleted files)**

```bash
cd /Users/sampath/BSA-Basketball-S26
npm run build 2>&1 | tail -5
```

Expected: `✓ built in` with no errors.

- [ ] **Step 4: Commit**

```bash
git add src/data/statModel.js
git rm src/data/plays.js src/data/gameData.js
git commit -m "refactor: remove unused data files, trim statModel.js to config only"
```

---

## Task 4: Build `SeasonSelector` component and lift state to `App.jsx`

**Files:**
- Create: `src/components/SeasonSelector.jsx`
- Modify: `src/App.jsx`

- [ ] **Step 1: Create `src/components/SeasonSelector.jsx`**

```jsx
import { useEffect, useState } from 'react';
import { fetchSeasons } from '../api/nbaApi';

export default function SeasonSelector({ season, seasonType, onSeasonChange, onSeasonTypeChange }) {
  const [seasons, setSeasons] = useState([]);
  const [seasonTypes, setSeasonTypes] = useState([]);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetchSeasons()
      .then((data) => {
        setSeasons(data.seasons);
        setSeasonTypes(data.seasonTypes);
      })
      .catch((e) => setError(e.message));
  }, []);

  if (error) return <p style={{ color: '#dc2626', fontSize: 13 }}>Failed to load seasons: {error}</p>;

  return (
    <div style={styles.row}>
      <div style={styles.group}>
        <label style={styles.label}>Season</label>
        <select value={season} onChange={(e) => onSeasonChange(e.target.value)} style={styles.select}>
          {seasons.map((s) => (
            <option key={s.id} value={s.id}>{s.label}</option>
          ))}
        </select>
      </div>
      <div style={styles.group}>
        <label style={styles.label}>Type</label>
        <select value={seasonType} onChange={(e) => onSeasonTypeChange(e.target.value)} style={styles.select}>
          {seasonTypes.map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
      </div>
    </div>
  );
}

const styles = {
  row: { display: 'flex', gap: '16px', alignItems: 'flex-end', marginBottom: '20px', flexWrap: 'wrap' },
  group: { display: 'flex', flexDirection: 'column', gap: '4px' },
  label: { fontSize: '11px', fontWeight: '600', color: '#888', textTransform: 'uppercase', letterSpacing: '0.05em' },
  select: { padding: '7px 10px', borderRadius: '6px', border: '1px solid #d0d0d0', fontSize: '13px', cursor: 'pointer', background: '#fafafa' },
};
```

- [ ] **Step 2: Replace `src/App.jsx`**

```jsx
import { useState } from 'react';
import TabNav from './components/TabNav';
import SeasonSelector from './components/SeasonSelector';
import PlayEditor from './components/PlayEditor';
import StatModel from './components/StatModel';
import './App.css';

export default function App() {
  const [activeTab, setActiveTab] = useState('Play Editor');
  const [season, setSeason] = useState('2024-25');
  const [seasonType, setSeasonType] = useState('Regular Season');

  return (
    <div>
      <h1 style={{ marginBottom: '8px', fontSize: '24px' }}>NBA What If</h1>
      <p style={{ color: '#666', marginBottom: '20px', fontSize: '14px' }}>
        Explore how key moments affected win probability
      </p>
      <SeasonSelector
        season={season}
        seasonType={seasonType}
        onSeasonChange={setSeason}
        onSeasonTypeChange={setSeasonType}
      />
      <TabNav activeTab={activeTab} onTabChange={setActiveTab} />
      <div>
        {activeTab === 'Play Editor' && <PlayEditor season={season} seasonType={seasonType} />}
        {activeTab === 'Stat Model' && <StatModel season={season} seasonType={seasonType} />}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Verify build passes**

```bash
cd /Users/sampath/BSA-Basketball-S26
npm run build 2>&1 | tail -5
```

Expected: `✓ built in` with no errors (PlayEditor and StatModel not yet updated to accept new props — they'll get warnings but not errors at build time).

- [ ] **Step 4: Commit**

```bash
git add src/components/SeasonSelector.jsx src/App.jsx
git commit -m "feat: add SeasonSelector and lift season state to App"
```

---

## Task 5: Build `GameSelector` component

**Files:**
- Create: `src/components/GameSelector.jsx`

- [ ] **Step 1: Create `src/components/GameSelector.jsx`**

```jsx
import { useEffect, useState } from 'react';
import { fetchGames } from '../api/nbaApi';

export default function GameSelector({ season, seasonType, gameId, onGameChange }) {
  const [games, setGames] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!season || !seasonType) return;
    setLoading(true);
    setError(null);
    fetchGames(season, seasonType)
      .then((data) => {
        setGames(data.games);
        if (data.games.length > 0 && !gameId) {
          onGameChange(data.games[0].gameId);
        }
        setLoading(false);
      })
      .catch((e) => {
        setError(e.message);
        setLoading(false);
      });
  }, [season, seasonType]);

  if (error) return <p style={{ color: '#dc2626', fontSize: 13 }}>Failed to load games: {error}</p>;

  return (
    <div style={styles.group}>
      <label style={styles.label}>Game</label>
      <select
        value={gameId || ''}
        onChange={(e) => onGameChange(e.target.value)}
        style={styles.select}
        disabled={loading || games.length === 0}
      >
        {loading && <option>Loading games…</option>}
        {games.map((g) => (
          <option key={g.gameId} value={g.gameId}>
            {g.teamA} vs {g.teamB} — {g.date} ({g.finalScoreA}–{g.finalScoreB})
          </option>
        ))}
      </select>
    </div>
  );
}

const styles = {
  group: { display: 'flex', flexDirection: 'column', gap: '4px' },
  label: { fontSize: '11px', fontWeight: '600', color: '#888', textTransform: 'uppercase', letterSpacing: '0.05em' },
  select: { padding: '7px 10px', borderRadius: '6px', border: '1px solid #d0d0d0', fontSize: '13px', cursor: 'pointer', background: '#fafafa', minWidth: '340px' },
};
```

- [ ] **Step 2: Verify build passes**

```bash
cd /Users/sampath/BSA-Basketball-S26
npm run build 2>&1 | tail -5
```

Expected: `✓ built in` with no errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/GameSelector.jsx
git commit -m "feat: add GameSelector component"
```

---

## Task 6: Rewrite `PlayEditor` component

**Files:**
- Modify: `src/components/PlayEditor.jsx`

- [ ] **Step 1: Replace `src/components/PlayEditor.jsx` entirely**

```jsx
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

  // Reset game when season changes
  useEffect(() => {
    setGameId(null);
    setGame(null);
    setOverrides({});
  }, [season, seasonType]);

  // Load play-by-play when gameId changes
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
```

- [ ] **Step 2: Verify build passes**

```bash
cd /Users/sampath/BSA-Basketball-S26
npm run build 2>&1 | tail -5
```

Expected: `✓ built in` with no errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/PlayEditor.jsx
git commit -m "feat: rewrite PlayEditor with real play-by-play and game clock x-axis"
```

---

## Task 7: Update `StatModel` component

**Files:**
- Modify: `src/components/StatModel.jsx`

- [ ] **Step 1: Replace `src/components/StatModel.jsx`**

```jsx
import { useState, useEffect, useRef } from 'react';
import { sliderConfig } from '../data/statModel';
import { fetchWinProb } from '../api/nbaApi';

function defaultValues() {
  return Object.fromEntries(sliderConfig.map((c) => [c.key, c.default]));
}

export default function StatModel({ season, seasonType }) {
  const [values, setValues] = useState(defaultValues());
  const [result, setResult] = useState(null);   // { gamesMatched, wins, winRate }
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const debounceRef = useRef(null);

  // Fetch on mount and whenever values/season/seasonType change (debounced 300ms)
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setLoading(true);
      setError(null);
      fetchWinProb({ season, seasonType, ...values })
        .then((data) => { setResult(data); setLoading(false); })
        .catch((e) => { setError(e.message); setLoading(false); });
    }, 300);
    return () => clearTimeout(debounceRef.current);
  }, [values, season, seasonType]);

  function handleChange(key, value) {
    setValues((prev) => ({ ...prev, [key]: Number(value) }));
  }

  const winRate = result?.winRate ?? null;
  const probColor = winRate === null ? '#999' : winRate >= 60 ? '#16a34a' : winRate <= 40 ? '#dc2626' : '#2563eb';
  const displayProb = winRate !== null ? `${winRate}%` : '—';

  return (
    <div style={styles.panel}>
      <div style={styles.slidersSection}>
        <h3 style={styles.sectionTitle}>Team Stats</h3>
        {sliderConfig.map((config) => (
          <div key={config.key} style={styles.sliderRow}>
            <div style={styles.sliderLabelRow}>
              <span style={styles.sliderLabel}>{config.label}</span>
              <span style={styles.sliderValue}>{values[config.key]}{config.unit}</span>
            </div>
            <input
              type="range"
              min={config.min}
              max={config.max}
              value={values[config.key]}
              onChange={(e) => handleChange(config.key, e.target.value)}
              style={styles.slider}
            />
            <div style={styles.sliderRange}>
              <span>{config.min}{config.unit}</span>
              <span>{config.max}{config.unit}</span>
            </div>
          </div>
        ))}
      </div>

      <div style={styles.resultSection}>
        <p style={styles.resultLabel}>Win Probability</p>
        <p style={{ ...styles.resultProb, color: probColor, opacity: loading ? 0.4 : 1 }}>
          {displayProb}
        </p>
        {error && <p style={styles.errorText}>Error: {error}</p>}
        {!error && result && (
          <p style={styles.resultSub}>
            {result.gamesMatched > 0
              ? `Based on ${result.gamesMatched} matching games`
              : 'No matching games found'}
          </p>
        )}
        {!error && !result && !loading && (
          <p style={styles.resultSub}>based on stat thresholds</p>
        )}
      </div>
    </div>
  );
}

const styles = {
  panel: { display: 'flex', gap: '32px', background: '#fff', borderRadius: '8px', padding: '28px', boxShadow: '0 1px 3px rgba(0,0,0,0.08)' },
  slidersSection: { flex: 1 },
  sectionTitle: { fontSize: '15px', fontWeight: '600', marginBottom: '20px', color: '#1a1a1a' },
  sliderRow: { marginBottom: '20px' },
  sliderLabelRow: { display: 'flex', justifyContent: 'space-between', marginBottom: '6px' },
  sliderLabel: { fontSize: '14px', color: '#1a1a1a' },
  sliderValue: { fontSize: '14px', fontWeight: '600', color: '#2563eb' },
  slider: { width: '100%', cursor: 'pointer', accentColor: '#2563eb' },
  sliderRange: { display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: '#999', marginTop: '2px' },
  resultSection: { width: '200px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', borderLeft: '1px solid #f0f0f0', paddingLeft: '32px' },
  resultLabel: { fontSize: '13px', color: '#666', textAlign: 'center', marginBottom: '12px' },
  resultProb: { fontSize: '64px', fontWeight: '700', lineHeight: 1, marginBottom: '8px', transition: 'color 0.2s, opacity 0.2s' },
  resultSub: { fontSize: '12px', color: '#999', textAlign: 'center' },
  errorText: { fontSize: '11px', color: '#dc2626', textAlign: 'center', marginBottom: '4px' },
};
```

- [ ] **Step 2: Verify build passes**

```bash
cd /Users/sampath/BSA-Basketball-S26
npm run build 2>&1 | tail -5
```

Expected: `✓ built in` with no errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/StatModel.jsx
git commit -m "feat: update StatModel to use real historical win rates from backend"
```

---

## Task 8: End-to-end verification

**Files:** No changes — verification only.

- [ ] **Step 1: Start the backend server**

```bash
cd /Users/sampath/BSA-Basketball-S26
source server/.venv/bin/activate
python3 -m server.app &
sleep 2
echo "Backend running"
```

- [ ] **Step 2: Start the frontend dev server**

```bash
npm run dev &
sleep 3
echo "Frontend running at http://localhost:5173"
```

- [ ] **Step 3: Verify the golden path manually in a browser**

Open `http://localhost:5173` and verify:

1. Season selector shows "2024-25" and "Regular Season" by default
2. Play Editor tab loads — game dropdown populates with games
3. Select a game — charts appear with real win probability curves and a play-by-play list
4. Quarter filter buttons work (click Q4 to show only Q4 plays)
5. Flip an editable play's outcome — What If chart updates
6. Reset edits button clears overrides
7. Switch to Stat Model tab — win probability shows a real percentage
8. Move a slider — percentage updates after ~300ms debounce
9. Change season to "2023-24 Playoffs" — both tabs update

- [ ] **Step 4: Stop background servers**

```bash
kill %2 %1
```

- [ ] **Step 5: Final commit**

```bash
git add -A
git commit -m "feat: complete nba_api frontend integration"
```
