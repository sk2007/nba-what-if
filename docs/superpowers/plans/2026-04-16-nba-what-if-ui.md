# NBA What If UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a static React mockup with two tabs — a Play Editor showing side-by-side win probability charts, and a Stat Model with sliders that update a live win probability estimate.

**Architecture:** Single Vite + React app, no backend, no routing. All data is hardcoded in `src/data/`. Tab state is local React state in `App.jsx`. Charts use Recharts.

**Tech Stack:** Vite, React, Recharts

---

## File Map

| File | Responsibility |
|------|---------------|
| `src/data/plays.js` | Hardcoded win probability curves and play list with what-if variants |
| `src/data/statModel.js` | Slider config and `calcWinProb` formula |
| `src/components/TabNav.jsx` | Tab switcher UI (Play Editor / Stat Model) |
| `src/components/PlayEditor.jsx` | Side-by-side charts + play list with dropdowns |
| `src/components/StatModel.jsx` | Sliders + live win probability display |
| `src/App.jsx` | Root: tab state, renders TabNav + active tab panel |
| `src/App.css` | Global styles |
| `src/index.css` | Reset/base styles |

---

## Task 1: Scaffold Vite + React project and install dependencies

**Files:**
- Create: `package.json`, `vite.config.js`, `index.html`, `src/main.jsx`, `src/App.jsx`, `src/App.css`, `src/index.css`

- [ ] **Step 1: Scaffold the project**

```bash
cd /Users/sampath/BSA-Basketball-S26
npm create vite@latest . -- --template react
```

When prompted, select: `React` → `JavaScript`

- [ ] **Step 2: Install dependencies**

```bash
npm install
npm install recharts
```

- [ ] **Step 3: Verify dev server starts**

```bash
npm run dev
```

Expected: Server starts at `http://localhost:5173` with default Vite + React page. Stop with `Ctrl+C`.

- [ ] **Step 4: Clear boilerplate from App.jsx**

Replace `src/App.jsx` with:

```jsx
function App() {
  return <div>NBA What If</div>;
}

export default App;
```

Replace `src/App.css` with:
```css
* {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}

body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  background: #f5f5f5;
  color: #1a1a1a;
}

#root {
  max-width: 1200px;
  margin: 0 auto;
  padding: 24px;
}
```

Replace `src/index.css` with:
```css
body {
  margin: 0;
}
```

- [ ] **Step 5: Verify it still renders**

```bash
npm run dev
```

Expected: Page shows "NBA What If" text. Stop with `Ctrl+C`.

- [ ] **Step 6: Commit**

```bash
git init
git add .
git commit -m "feat: scaffold Vite + React project with Recharts"
```

---

## Task 2: Create hardcoded play data (`src/data/plays.js`)

**Files:**
- Create: `src/data/plays.js`

- [ ] **Step 1: Create the data file**

Create `src/data/plays.js` with the following content:

```js
// Win probability curve for the actual game (Lakers vs Celtics, Game 7 scenario)
// Each point: { minute: number (0-48), prob: number (0-100) }
export const originalCurve = [
  { minute: 0, prob: 50 },
  { minute: 2, prob: 52 },
  { minute: 4, prob: 55 },
  { minute: 6, prob: 53 },
  { minute: 8, prob: 58 },
  { minute: 10, prob: 60 },
  { minute: 12, prob: 57 },
  { minute: 14, prob: 54 },
  { minute: 16, prob: 51 },
  { minute: 18, prob: 48 },
  { minute: 20, prob: 45 },
  { minute: 22, prob: 47 },
  { minute: 24, prob: 50 },
  { minute: 26, prob: 53 },
  { minute: 28, prob: 56 },
  { minute: 30, prob: 59 },
  { minute: 32, prob: 62 },
  { minute: 34, prob: 65 },
  { minute: 36, prob: 61 },
  { minute: 38, prob: 58 },
  { minute: 40, prob: 54 },
  { minute: 42, prob: 49 },
  { minute: 44, prob: 44 },
  { minute: 46, prob: 41 },
  { minute: 48, prob: 38 },
];

// What-if curve if Play 1 (blown call Q4) went the other way
const whatIfCurve1 = [
  { minute: 0, prob: 50 },
  { minute: 2, prob: 52 },
  { minute: 4, prob: 55 },
  { minute: 6, prob: 53 },
  { minute: 8, prob: 58 },
  { minute: 10, prob: 60 },
  { minute: 12, prob: 57 },
  { minute: 14, prob: 54 },
  { minute: 16, prob: 51 },
  { minute: 18, prob: 48 },
  { minute: 20, prob: 45 },
  { minute: 22, prob: 47 },
  { minute: 24, prob: 50 },
  { minute: 26, prob: 53 },
  { minute: 28, prob: 56 },
  { minute: 30, prob: 59 },
  { minute: 32, prob: 62 },
  { minute: 34, prob: 65 },
  { minute: 36, prob: 61 },
  { minute: 38, prob: 58 },
  { minute: 40, prob: 54 },
  { minute: 42, prob: 62 },
  { minute: 44, prob: 68 },
  { minute: 46, prob: 72 },
  { minute: 48, prob: 75 },
];

// What-if curve if Play 2 (missed free throw Q3) was made
const whatIfCurve2 = [
  { minute: 0, prob: 50 },
  { minute: 2, prob: 52 },
  { minute: 4, prob: 55 },
  { minute: 6, prob: 53 },
  { minute: 8, prob: 58 },
  { minute: 10, prob: 60 },
  { minute: 12, prob: 57 },
  { minute: 14, prob: 54 },
  { minute: 16, prob: 51 },
  { minute: 18, prob: 48 },
  { minute: 20, prob: 50 },
  { minute: 22, prob: 54 },
  { minute: 24, prob: 57 },
  { minute: 26, prob: 60 },
  { minute: 28, prob: 63 },
  { minute: 30, prob: 66 },
  { minute: 32, prob: 69 },
  { minute: 34, prob: 71 },
  { minute: 36, prob: 68 },
  { minute: 38, prob: 65 },
  { minute: 40, prob: 62 },
  { minute: 42, prob: 60 },
  { minute: 44, prob: 58 },
  { minute: 46, prob: 57 },
  { minute: 48, prob: 60 },
];

// What-if curve if Play 3 (turnover Q4) didn't happen
const whatIfCurve3 = [
  { minute: 0, prob: 50 },
  { minute: 2, prob: 52 },
  { minute: 4, prob: 55 },
  { minute: 6, prob: 53 },
  { minute: 8, prob: 58 },
  { minute: 10, prob: 60 },
  { minute: 12, prob: 57 },
  { minute: 14, prob: 54 },
  { minute: 16, prob: 51 },
  { minute: 18, prob: 48 },
  { minute: 20, prob: 45 },
  { minute: 22, prob: 47 },
  { minute: 24, prob: 50 },
  { minute: 26, prob: 53 },
  { minute: 28, prob: 56 },
  { minute: 30, prob: 59 },
  { minute: 32, prob: 62 },
  { minute: 34, prob: 65 },
  { minute: 36, prob: 61 },
  { minute: 38, prob: 58 },
  { minute: 40, prob: 60 },
  { minute: 42, prob: 63 },
  { minute: 44, prob: 61 },
  { minute: 46, prob: 59 },
  { minute: 48, prob: 62 },
];

// What-if curve if Play 4 (missed 3-pointer Q2) was made
const whatIfCurve4 = [
  { minute: 0, prob: 50 },
  { minute: 2, prob: 52 },
  { minute: 4, prob: 55 },
  { minute: 6, prob: 53 },
  { minute: 8, prob: 58 },
  { minute: 10, prob: 60 },
  { minute: 12, prob: 63 },
  { minute: 14, prob: 61 },
  { minute: 16, prob: 58 },
  { minute: 18, prob: 55 },
  { minute: 20, prob: 52 },
  { minute: 22, prob: 54 },
  { minute: 24, prob: 57 },
  { minute: 26, prob: 60 },
  { minute: 28, prob: 63 },
  { minute: 30, prob: 65 },
  { minute: 32, prob: 68 },
  { minute: 34, prob: 70 },
  { minute: 36, prob: 66 },
  { minute: 38, prob: 62 },
  { minute: 40, prob: 58 },
  { minute: 42, prob: 54 },
  { minute: 44, prob: 50 },
  { minute: 46, prob: 48 },
  { minute: 48, prob: 52 },
];

// What-if curve if Play 5 (defensive foul Q4) wasn't called
const whatIfCurve5 = [
  { minute: 0, prob: 50 },
  { minute: 2, prob: 52 },
  { minute: 4, prob: 55 },
  { minute: 6, prob: 53 },
  { minute: 8, prob: 58 },
  { minute: 10, prob: 60 },
  { minute: 12, prob: 57 },
  { minute: 14, prob: 54 },
  { minute: 16, prob: 51 },
  { minute: 18, prob: 48 },
  { minute: 20, prob: 45 },
  { minute: 22, prob: 47 },
  { minute: 24, prob: 50 },
  { minute: 26, prob: 53 },
  { minute: 28, prob: 56 },
  { minute: 30, prob: 59 },
  { minute: 32, prob: 62 },
  { minute: 34, prob: 65 },
  { minute: 36, prob: 61 },
  { minute: 38, prob: 64 },
  { minute: 40, prob: 67 },
  { minute: 42, prob: 65 },
  { minute: 44, prob: 63 },
  { minute: 46, prob: 66 },
  { minute: 48, prob: 70 },
];

export const plays = [
  {
    id: 1,
    time: 'Q4 2:30',
    description: 'Blown call — offensive foul on LeBron James',
    outcomes: ['Foul Called (Actual)', 'No Call'],
    whatIfCurves: {
      'Foul Called (Actual)': originalCurve,
      'No Call': whatIfCurve1,
    },
  },
  {
    id: 2,
    time: 'Q3 4:15',
    description: 'Missed free throw — Anthony Davis (1 of 2)',
    outcomes: ['Missed (Actual)', 'Made'],
    whatIfCurves: {
      'Missed (Actual)': originalCurve,
      'Made': whatIfCurve2,
    },
  },
  {
    id: 3,
    time: 'Q4 5:00',
    description: 'Turnover — Austin Reaves bad pass',
    outcomes: ['Turnover (Actual)', 'No Turnover'],
    whatIfCurves: {
      'Turnover (Actual)': originalCurve,
      'No Turnover': whatIfCurve3,
    },
  },
  {
    id: 4,
    time: 'Q2 8:42',
    description: "Missed corner three — D'Angelo Russell",
    outcomes: ['Missed (Actual)', 'Made'],
    whatIfCurves: {
      'Missed (Actual)': originalCurve,
      'Made': whatIfCurve4,
    },
  },
  {
    id: 5,
    time: 'Q4 1:10',
    description: 'Defensive foul on Rui Hachimura — sent opponents to line',
    outcomes: ['Foul Called (Actual)', 'No Foul'],
    whatIfCurves: {
      'Foul Called (Actual)': originalCurve,
      'No Foul': whatIfCurve5,
    },
  },
];
```

- [ ] **Step 2: Commit**

```bash
git add src/data/plays.js
git commit -m "feat: add hardcoded play data and win probability curves"
```

---

## Task 3: Create stat model data and formula (`src/data/statModel.js`)

**Files:**
- Create: `src/data/statModel.js`

- [ ] **Step 1: Create the file**

Create `src/data/statModel.js`:

```js
export const sliderConfig = [
  {
    key: 'threePointPct',
    label: '3-Point %',
    min: 0,
    max: 100,
    default: 35,
    unit: '%',
    // higher is better
    direction: 1,
    // average NBA value used for normalization
    average: 35,
    weight: 0.25,
  },
  {
    key: 'fgPct',
    label: 'Field Goal %',
    min: 0,
    max: 100,
    default: 45,
    unit: '%',
    direction: 1,
    average: 46,
    weight: 0.30,
  },
  {
    key: 'turnovers',
    label: 'Turnovers',
    min: 0,
    max: 30,
    default: 14,
    unit: '',
    // lower is better
    direction: -1,
    average: 14,
    weight: 0.20,
  },
  {
    key: 'rebounds',
    label: 'Rebounds',
    min: 0,
    max: 60,
    default: 40,
    unit: '',
    direction: 1,
    average: 40,
    weight: 0.15,
  },
  {
    key: 'ftPct',
    label: 'Free Throw %',
    min: 0,
    max: 100,
    default: 75,
    unit: '%',
    direction: 1,
    average: 77,
    weight: 0.10,
  },
];

// Returns win probability 0-100 as an integer.
// Each stat is normalized relative to its average (how far above/below average),
// then weighted and summed. Result is clamped so defaults produce ~50%.
export function calcWinProb(values) {
  let score = 0;

  for (const config of sliderConfig) {
    const val = values[config.key];
    const range = config.max - config.min;
    // normalized deviation from average: -1 to +1
    const deviation = ((val - config.average) / (range / 2)) * config.direction;
    score += deviation * config.weight;
  }

  // score is roughly -1 to +1; map to 0-100 centered at 50
  const prob = 50 + score * 50;
  return Math.round(Math.max(0, Math.min(100, prob)));
}

export function defaultValues() {
  return Object.fromEntries(sliderConfig.map((c) => [c.key, c.default]));
}
```

- [ ] **Step 2: Verify formula at defaults produces ~50%**

Add a temporary check by opening the browser console after the app is running, or verify mentally:
- All defaults are set to average values → all deviations ≈ 0 → score ≈ 0 → prob ≈ 50. ✓

- [ ] **Step 3: Commit**

```bash
git add src/data/statModel.js
git commit -m "feat: add stat model slider config and win probability formula"
```

---

## Task 4: Build `TabNav` component

**Files:**
- Create: `src/components/TabNav.jsx`

- [ ] **Step 1: Create the component**

Create `src/components/TabNav.jsx`:

```jsx
export default function TabNav({ activeTab, onTabChange }) {
  const tabs = ['Play Editor', 'Stat Model'];

  return (
    <nav style={styles.nav}>
      {tabs.map((tab) => (
        <button
          key={tab}
          onClick={() => onTabChange(tab)}
          style={{
            ...styles.tab,
            ...(activeTab === tab ? styles.activeTab : {}),
          }}
        >
          {tab}
        </button>
      ))}
    </nav>
  );
}

const styles = {
  nav: {
    display: 'flex',
    gap: '4px',
    borderBottom: '2px solid #e0e0e0',
    marginBottom: '24px',
  },
  tab: {
    padding: '10px 20px',
    border: 'none',
    background: 'none',
    cursor: 'pointer',
    fontSize: '15px',
    fontWeight: '500',
    color: '#666',
    borderBottom: '2px solid transparent',
    marginBottom: '-2px',
    transition: 'color 0.15s',
  },
  activeTab: {
    color: '#1a1a1a',
    borderBottom: '2px solid #1a1a1a',
  },
};
```

- [ ] **Step 2: Wire TabNav into App.jsx**

Replace `src/App.jsx` with:

```jsx
import { useState } from 'react';
import TabNav from './components/TabNav';
import './App.css';

export default function App() {
  const [activeTab, setActiveTab] = useState('Play Editor');

  return (
    <div>
      <h1 style={{ marginBottom: '8px', fontSize: '24px' }}>NBA What If</h1>
      <p style={{ color: '#666', marginBottom: '24px', fontSize: '14px' }}>
        Explore how key moments affected win probability
      </p>
      <TabNav activeTab={activeTab} onTabChange={setActiveTab} />
      <div>
        {activeTab === 'Play Editor' && <p>Play Editor coming soon</p>}
        {activeTab === 'Stat Model' && <p>Stat Model coming soon</p>}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Start dev server and verify tabs switch**

```bash
npm run dev
```

Expected: Page shows two tabs ("Play Editor", "Stat Model"). Clicking each switches the content text. Stop with `Ctrl+C`.

- [ ] **Step 4: Commit**

```bash
git add src/components/TabNav.jsx src/App.jsx
git commit -m "feat: add TabNav component and tab switching in App"
```

---

## Task 5: Build `PlayEditor` component

**Files:**
- Create: `src/components/PlayEditor.jsx`

- [ ] **Step 1: Create the component**

Create `src/components/PlayEditor.jsx`:

```jsx
import { useState } from 'react';
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
import { originalCurve, plays } from '../data/plays';

const QUARTER_LINES = [12, 24, 36];

function WinProbChart({ data, title, color }) {
  return (
    <div style={styles.chartPanel}>
      <h3 style={styles.chartTitle}>{title}</h3>
      <ResponsiveContainer width="100%" height={260}>
        <LineChart data={data} margin={{ top: 8, right: 16, left: 0, bottom: 8 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
          <XAxis
            dataKey="minute"
            label={{ value: 'Game Time (min)', position: 'insideBottom', offset: -4, fontSize: 12 }}
            domain={[0, 48]}
            tickCount={9}
            tick={{ fontSize: 11 }}
          />
          <YAxis
            domain={[0, 100]}
            tickFormatter={(v) => `${v}%`}
            tick={{ fontSize: 11 }}
            width={42}
          />
          <Tooltip
            formatter={(v) => [`${v}%`, 'Win Prob']}
            labelFormatter={(l) => `Minute ${l}`}
          />
          {QUARTER_LINES.map((min) => (
            <ReferenceLine
              key={min}
              x={min}
              stroke="#ccc"
              strokeDasharray="4 2"
              label={{ value: `Q${min / 12 + 1}`, position: 'top', fontSize: 10, fill: '#999' }}
            />
          ))}
          <ReferenceLine y={50} stroke="#ddd" strokeDasharray="4 2" />
          <Line
            type="monotone"
            dataKey="prob"
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
  const [selectedOutcomes, setSelectedOutcomes] = useState(
    Object.fromEntries(plays.map((p) => [p.id, p.outcomes[0]]))
  );

  // The what-if curve is determined by the last play whose outcome was changed
  // from its default (first outcome). If none changed, show original.
  const whatIfCurve = (() => {
    for (let i = plays.length - 1; i >= 0; i--) {
      const play = plays[i];
      const selected = selectedOutcomes[play.id];
      if (selected !== play.outcomes[0]) {
        return play.whatIfCurves[selected];
      }
    }
    return originalCurve;
  })();

  function handleOutcomeChange(playId, outcome) {
    setSelectedOutcomes((prev) => ({ ...prev, [playId]: outcome }));
  }

  return (
    <div>
      <div style={styles.chartsRow}>
        <WinProbChart data={originalCurve} title="Original" color="#2563eb" />
        <WinProbChart data={whatIfCurve} title="What If Scenario" color="#dc2626" />
      </div>
      <div style={styles.playList}>
        <h3 style={styles.playListTitle}>Edit a Play</h3>
        {plays.map((play) => (
          <div key={play.id} style={styles.playRow}>
            <span style={styles.playTime}>{play.time}</span>
            <span style={styles.playDesc}>{play.description}</span>
            <select
              value={selectedOutcomes[play.id]}
              onChange={(e) => handleOutcomeChange(play.id, e.target.value)}
              style={styles.select}
            >
              {play.outcomes.map((outcome) => (
                <option key={outcome} value={outcome}>
                  {outcome}
                </option>
              ))}
            </select>
          </div>
        ))}
      </div>
    </div>
  );
}

const styles = {
  chartsRow: {
    display: 'flex',
    gap: '16px',
    marginBottom: '32px',
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
  playListTitle: {
    fontSize: '15px',
    fontWeight: '600',
    marginBottom: '16px',
    color: '#1a1a1a',
  },
  playRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    padding: '10px 0',
    borderBottom: '1px solid #f0f0f0',
  },
  playTime: {
    fontSize: '12px',
    fontWeight: '600',
    color: '#666',
    minWidth: '70px',
  },
  playDesc: {
    flex: 1,
    fontSize: '14px',
    color: '#1a1a1a',
  },
  select: {
    padding: '6px 10px',
    borderRadius: '6px',
    border: '1px solid #d0d0d0',
    fontSize: '13px',
    cursor: 'pointer',
    background: '#fafafa',
  },
};
```

- [ ] **Step 2: Wire PlayEditor into App.jsx**

Replace the Play Editor placeholder in `src/App.jsx`:

```jsx
import { useState } from 'react';
import TabNav from './components/TabNav';
import PlayEditor from './components/PlayEditor';
import './App.css';

export default function App() {
  const [activeTab, setActiveTab] = useState('Play Editor');

  return (
    <div>
      <h1 style={{ marginBottom: '8px', fontSize: '24px' }}>NBA What If</h1>
      <p style={{ color: '#666', marginBottom: '24px', fontSize: '14px' }}>
        Explore how key moments affected win probability
      </p>
      <TabNav activeTab={activeTab} onTabChange={setActiveTab} />
      <div>
        {activeTab === 'Play Editor' && <PlayEditor />}
        {activeTab === 'Stat Model' && <p>Stat Model coming soon</p>}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Start dev server and verify Play Editor**

```bash
npm run dev
```

Expected:
- Two side-by-side charts render with labeled axes and quarter lines
- Play list shows 5 rows, each with a time, description, and dropdown
- Changing a dropdown outcome updates the right "What If" chart curve
- Resetting all dropdowns to their first option restores the right chart to match the left

Stop with `Ctrl+C`.

- [ ] **Step 4: Commit**

```bash
git add src/components/PlayEditor.jsx src/App.jsx
git commit -m "feat: add PlayEditor with side-by-side win probability charts"
```

---

## Task 6: Build `StatModel` component

**Files:**
- Create: `src/components/StatModel.jsx`

- [ ] **Step 1: Create the component**

Create `src/components/StatModel.jsx`:

```jsx
import { useState } from 'react';
import { sliderConfig, calcWinProb, defaultValues } from '../data/statModel';

export default function StatModel() {
  const [values, setValues] = useState(defaultValues());

  const winProb = calcWinProb(values);

  function handleChange(key, value) {
    setValues((prev) => ({ ...prev, [key]: Number(value) }));
  }

  const probColor = winProb >= 60 ? '#16a34a' : winProb <= 40 ? '#dc2626' : '#2563eb';

  return (
    <div style={styles.panel}>
      <div style={styles.slidersSection}>
        <h3 style={styles.sectionTitle}>Team Stats</h3>
        {sliderConfig.map((config) => (
          <div key={config.key} style={styles.sliderRow}>
            <div style={styles.sliderLabelRow}>
              <span style={styles.sliderLabel}>{config.label}</span>
              <span style={styles.sliderValue}>
                {values[config.key]}{config.unit}
              </span>
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
        <p style={styles.resultLabel}>Estimated Win Probability</p>
        <p style={{ ...styles.resultProb, color: probColor }}>{winProb}%</p>
        <p style={styles.resultSub}>based on stat thresholds</p>
      </div>
    </div>
  );
}

const styles = {
  panel: {
    display: 'flex',
    gap: '32px',
    background: '#fff',
    borderRadius: '8px',
    padding: '28px',
    boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
  },
  slidersSection: {
    flex: 1,
  },
  sectionTitle: {
    fontSize: '15px',
    fontWeight: '600',
    marginBottom: '20px',
    color: '#1a1a1a',
  },
  sliderRow: {
    marginBottom: '20px',
  },
  sliderLabelRow: {
    display: 'flex',
    justifyContent: 'space-between',
    marginBottom: '6px',
  },
  sliderLabel: {
    fontSize: '14px',
    color: '#1a1a1a',
  },
  sliderValue: {
    fontSize: '14px',
    fontWeight: '600',
    color: '#2563eb',
  },
  slider: {
    width: '100%',
    cursor: 'pointer',
    accentColor: '#2563eb',
  },
  sliderRange: {
    display: 'flex',
    justifyContent: 'space-between',
    fontSize: '11px',
    color: '#999',
    marginTop: '2px',
  },
  resultSection: {
    width: '200px',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    borderLeft: '1px solid #f0f0f0',
    paddingLeft: '32px',
  },
  resultLabel: {
    fontSize: '13px',
    color: '#666',
    textAlign: 'center',
    marginBottom: '12px',
  },
  resultProb: {
    fontSize: '64px',
    fontWeight: '700',
    lineHeight: 1,
    marginBottom: '8px',
  },
  resultSub: {
    fontSize: '12px',
    color: '#999',
    textAlign: 'center',
  },
};
```

- [ ] **Step 2: Wire StatModel into App.jsx**

Replace `src/App.jsx` with:

```jsx
import { useState } from 'react';
import TabNav from './components/TabNav';
import PlayEditor from './components/PlayEditor';
import StatModel from './components/StatModel';
import './App.css';

export default function App() {
  const [activeTab, setActiveTab] = useState('Play Editor');

  return (
    <div>
      <h1 style={{ marginBottom: '8px', fontSize: '24px' }}>NBA What If</h1>
      <p style={{ color: '#666', marginBottom: '24px', fontSize: '14px' }}>
        Explore how key moments affected win probability
      </p>
      <TabNav activeTab={activeTab} onTabChange={setActiveTab} />
      <div>
        {activeTab === 'Play Editor' && <PlayEditor />}
        {activeTab === 'Stat Model' && <StatModel />}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Start dev server and verify Stat Model**

```bash
npm run dev
```

Expected:
- Stat Model tab shows 5 labeled sliders on the left
- Each slider shows its current value
- Large percentage on the right updates live as any slider moves
- Default values produce approximately 50%
- Moving sliders toward better stats increases the percentage; worse stats decrease it
- Percentage color: green ≥60%, red ≤40%, blue otherwise

Stop with `Ctrl+C`.

- [ ] **Step 4: Commit**

```bash
git add src/components/StatModel.jsx src/App.jsx
git commit -m "feat: add StatModel tab with sliders and live win probability"
```

---

## Task 7: Final polish and verification

**Files:**
- Modify: `src/App.css`

- [ ] **Step 1: Add a game context header to PlayEditor**

The charts currently have no game context label. Add a subtitle in `src/components/PlayEditor.jsx` directly above the `chartsRow` div:

```jsx
// Add this just inside the return, before the chartsRow div:
<p style={{ fontSize: '13px', color: '#666', marginBottom: '16px' }}>
  Lakers vs. Celtics — Game 7 (Hardcoded Scenario) · Lakers Win Probability
</p>
```

- [ ] **Step 2: Run dev server and do a full walkthrough**

```bash
npm run dev
```

Verify the full golden path:
1. Page loads with "Play Editor" tab active
2. Two charts render side-by-side, both showing identical curves initially
3. Change a play dropdown — right chart updates to a diverging curve
4. Change another dropdown — right chart updates again
5. Switch to "Stat Model" tab
6. Move each slider — win probability updates live
7. Move turnovers to max (30) — probability should drop significantly
8. Move 3-Point % to max (100) — probability should rise significantly

Stop with `Ctrl+C`.

- [ ] **Step 3: Build for production to verify no errors**

```bash
npm run build
```

Expected: Build completes with no errors. Output in `dist/`.

- [ ] **Step 4: Final commit**

```bash
git add -A
git commit -m "feat: add game context label and complete NBA What If static mockup"
```
