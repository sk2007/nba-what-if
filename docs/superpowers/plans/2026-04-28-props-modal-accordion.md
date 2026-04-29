# Props Modal Accordion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the flat list of player prop markets in `PropsModal` with a player-grouped accordion where each player starts collapsed and opening one closes the others.

**Architecture:** Parse player name from `yes_sub_title` by splitting on `": "`, group markets into `{ player, lines[] }` objects, and render accordion rows using a single `openPlayer` state variable that resets on tab change.

**Tech Stack:** React (hooks), inline styles (existing pattern in this file)

---

### Task 1: Add accordion styles and grouping helper

**Files:**
- Modify: `src/components/KalshiMarkets.jsx`

- [ ] **Step 1: Add two new style entries to the `styles` object**

In [src/components/KalshiMarkets.jsx](src/components/KalshiMarkets.jsx), find the `styles` object (starts at line 5). Add these two entries at the end, before the closing `}`:

```js
  playerHeader: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 0', cursor: 'pointer', borderBottom: '1px solid #f0f0f0', userSelect: 'none' },
  playerName: { fontSize: '13px', fontWeight: '700', color: '#1a1a1a' },
```

- [ ] **Step 2: Add the grouping helper function**

After the `sleep` function (around line 78) and before `BOOK_PRIORITY`, add:

```js
function groupByPlayer(markets) {
  const map = new Map();
  for (const mk of markets) {
    const player = mk.yes_sub_title?.split(': ')[0] ?? 'Unknown';
    if (!map.has(player)) map.set(player, []);
    map.get(player).push(mk);
  }
  return Array.from(map.entries()).map(([player, lines]) => ({ player, lines }));
}
```

- [ ] **Step 3: Verify the app still loads (no syntax errors)**

Start or reload the dev server and open the app. The page should render without console errors.

- [ ] **Step 4: Commit**

```bash
git add src/components/KalshiMarkets.jsx
git commit -m "feat: add groupByPlayer helper and accordion styles to PropsModal"
```

---

### Task 2: Rewrite PropsModal render to use accordion

**Files:**
- Modify: `src/components/KalshiMarkets.jsx:186-251`

- [ ] **Step 1: Add `openPlayer` state and reset effect to `PropsModal`**

Replace the opening of `PropsModal` (lines 186–209) with:

```jsx
function PropsModal({ gameTitle, gameSuffix, onClose }) {
  const [activeTab, setActiveTab] = useState('KXNBAPTS');
  const [propsByTab, setPropsByTab] = useState({});
  const [tabLoading, setTabLoading] = useState(false);
  const [openPlayer, setOpenPlayer] = useState(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (propsByTab[activeTab] !== undefined) return;
      setTabLoading(true);
      try {
        const markets = await fetchKalshiProps(gameSuffix, activeTab);
        if (!cancelled) setPropsByTab(prev => ({ ...prev, [activeTab]: markets }));
      } catch {
        if (!cancelled) setPropsByTab(prev => ({ ...prev, [activeTab]: [] }));
      } finally {
        if (!cancelled) setTabLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [activeTab, gameSuffix]);

  useEffect(() => {
    setOpenPlayer(null);
  }, [activeTab]);

  const markets = propsByTab[activeTab];
  const playerGroups = markets ? groupByPlayer(markets) : [];
```

- [ ] **Step 2: Replace the modal body render with the accordion**

Replace the `<div style={styles.modalBody}>` block (lines 229–248) with:

```jsx
        <div style={styles.modalBody}>
          {tabLoading && <div style={styles.modalEmpty}>Loading…</div>}
          {!tabLoading && markets && markets.length === 0 && (
            <div style={styles.modalEmpty}>No active markets</div>
          )}
          {!tabLoading && playerGroups.map(({ player, lines }) => {
            const isOpen = openPlayer === player;
            return (
              <div key={player}>
                <div
                  style={styles.playerHeader}
                  onClick={() => setOpenPlayer(isOpen ? null : player)}
                >
                  <span style={styles.playerName}>{player}</span>
                  <span style={{ fontSize: '11px', color: '#aaa' }}>{isOpen ? '▼' : '▶'}</span>
                </div>
                {isOpen && lines.map(mk => {
                  const pct = Math.round((parseFloat(mk.yes_ask_dollars) + parseFloat(mk.yes_bid_dollars)) / 2 * 100);
                  const color = pctColor(pct);
                  const lineLabel = mk.yes_sub_title?.split(': ')[1] ?? mk.yes_sub_title;
                  return (
                    <div key={mk.ticker} style={{ ...styles.propRow, paddingLeft: '12px' }}>
                      <span style={styles.propLabel}>{lineLabel}</span>
                      <div style={styles.barWrap}>
                        <div style={{ height: '100%', width: `${pct}%`, background: color, borderRadius: '4px', transition: 'width 0.4s' }} />
                      </div>
                      <span style={{ ...styles.pctLabel, color }}>{pct}¢</span>
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
```

- [ ] **Step 3: Verify the accordion works**

Open the app, click "View Player Props" on a game card, open the Rebounds tab (which had visible data). You should see:
- A list of player name rows, all collapsed
- Clicking a player expands their lines (threshold labels only, e.g. `"4+"` not `"Jonathan Kuminga: 4+"`)
- Clicking another player closes the first and opens the new one
- Clicking the same player again collapses it
- Switching tabs resets all players to collapsed

- [ ] **Step 4: Commit**

```bash
git add src/components/KalshiMarkets.jsx
git commit -m "feat: accordion player grouping in PropsModal"
```
