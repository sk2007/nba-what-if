# Player Props Modal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "View Props" button to each game card that opens a modal showing Kalshi player prop markets (Points, Rebounds, Assists, Threes, PRA) organized in tabs, fetched on demand.

**Architecture:** A new backend route `/api/kalshi/props` proxies Kalshi markets filtered to active-only. A new `fetchKalshiProps` helper in `nbaApi.js` calls it. A `PropsModal` component and "View Props" button are added to `GameCard` in `KalshiMarkets.jsx`, with modal state (open, active tab, cached markets per tab) living inside `GameCard`.

**Tech Stack:** Flask (existing), React (existing), inline styles (existing pattern)

---

## File Structure

- **Modify:** `api/index.py` — add `/api/kalshi/props` route
- **Modify:** `src/api/nbaApi.js` — add `fetchKalshiProps` helper
- **Modify:** `src/components/KalshiMarkets.jsx` — add modal styles, `PropsModal` component, "View Props" button in `GameCard`, modal state in `GameCard`

---

### Task 1: Backend route `/api/kalshi/props`

**Files:**
- Modify: `api/index.py`

- [ ] **Step 1: Add the route**

Open `api/index.py`. Append the following after the existing `/api/kalshi/markets` route (at the end of the file):

```python
PROP_SERIES = {'KXNBAPTS', 'KXNBAREB', 'KXNBAAST', 'KXNBA3PT', 'KXNBAPRA'}


@app.get('/api/kalshi/props')
def kalshi_props():
    game_suffix = request.args.get('game_suffix')
    series = request.args.get('series')
    if not game_suffix or not series:
        return jsonify({'error': 'game_suffix and series are required'}), 400
    if series not in PROP_SERIES:
        return jsonify({'error': f'series must be one of {sorted(PROP_SERIES)}'}), 400
    event_ticker = f'{series}-{game_suffix}'
    try:
        r = http_requests.get(
            f'{KALSHI_BASE}/markets',
            params={'event_ticker': event_ticker, 'limit': 50},
            headers=KALSHI_HEADERS,
            timeout=10,
        )
        r.raise_for_status()
        all_markets = r.json().get('markets', [])
        active = [m for m in all_markets if m.get('status') == 'active']
        return jsonify({'markets': active})
    except Exception as e:
        return jsonify({'error': str(e)}), 503
```

- [ ] **Step 2: Smoke-test the route locally**

Start the Flask dev server if it isn't running:
```bash
cd /Users/sampath/BSA-Basketball-S26
python -m flask --app api/index.py run --port 5000
```

In a second terminal:
```bash
curl "http://localhost:5000/api/kalshi/props?game_suffix=26APR30DENMIN&series=KXNBAPTS"
```

Expected: JSON with a `markets` array containing active player point markets for DEN vs MIN. Each market should have `title`, `yes_sub_title`, `yes_ask_dollars`, `yes_bid_dollars`, `status: "active"`.

```bash
curl "http://localhost:5000/api/kalshi/props?game_suffix=26APR30DENMIN"
```
Expected: `{"error": "game_suffix and series are required"}` with HTTP 400.

```bash
curl "http://localhost:5000/api/kalshi/props?game_suffix=26APR30DENMIN&series=KXNBAFAKE"
```
Expected: `{"error": "series must be one of ..."}` with HTTP 400.

- [ ] **Step 3: Commit**

```bash
git add api/index.py
git commit -m "feat: add /api/kalshi/props route for player prop markets"
```

---

### Task 2: Frontend API helper `fetchKalshiProps`

**Files:**
- Modify: `src/api/nbaApi.js`

- [ ] **Step 1: Append the helper to `nbaApi.js`**

Open `src/api/nbaApi.js`. Append after the existing `fetchKalshiMarkets` function (before `recomputeWpCurve`):

```js
export async function fetchKalshiProps(gameSuffix, series) {
  const params = new URLSearchParams({ game_suffix: gameSuffix, series });
  const res = await fetch(`/api/kalshi/props?${params}`);
  if (!res.ok) throw new Error(`Kalshi props HTTP ${res.status}`);
  const data = await res.json();
  return data.markets || [];
}
```

- [ ] **Step 2: Commit**

```bash
git add src/api/nbaApi.js
git commit -m "feat: add fetchKalshiProps API helper"
```

---

### Task 3: PropsModal styles and component

**Files:**
- Modify: `src/components/KalshiMarkets.jsx`

- [ ] **Step 1: Add modal styles to the `styles` object**

In `KalshiMarkets.jsx`, find the closing `};` of the `styles` object (after `bankrollPrompt`). Add these entries before the closing brace:

```js
  viewPropsBtn: { marginTop: '14px', width: '100%', padding: '8px 0', fontSize: '12px', fontWeight: '600', color: '#2563eb', background: 'none', border: '1px solid #2563eb', borderRadius: '6px', cursor: 'pointer', letterSpacing: '0.03em' },
  backdrop: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' },
  modal: { background: '#fff', borderRadius: '12px', width: '100%', maxWidth: '640px', maxHeight: '80vh', display: 'flex', flexDirection: 'column', boxShadow: '0 8px 40px rgba(0,0,0,0.18)', margin: '0 16px' },
  modalHeader: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '18px 20px 0', borderBottom: '1px solid #f0f0f0', paddingBottom: '14px' },
  modalTitle: { fontSize: '15px', fontWeight: '700', color: '#1a1a1a' },
  modalClose: { fontSize: '20px', color: '#aaa', background: 'none', border: 'none', cursor: 'pointer', lineHeight: 1, padding: '0 4px' },
  modalTabs: { display: 'flex', borderBottom: '1px solid #f0f0f0', padding: '0 20px' },
  modalTab: { padding: '10px 14px', fontSize: '12px', fontWeight: '600', color: '#888', cursor: 'pointer', border: 'none', background: 'none', borderBottom: '2px solid transparent', marginBottom: '-1px' },
  modalTabActive: { padding: '10px 14px', fontSize: '12px', fontWeight: '600', color: '#1a1a1a', cursor: 'pointer', border: 'none', background: 'none', borderBottom: '2px solid #1a1a1a', marginBottom: '-1px' },
  modalBody: { overflowY: 'auto', padding: '16px 20px', flex: 1 },
  modalEmpty: { color: '#bbb', fontSize: '13px', textAlign: 'center', padding: '32px 0' },
  propRow: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid #f0f0f0' },
  propLabel: { fontSize: '13px', color: '#333', flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', marginRight: '8px' },
```

- [ ] **Step 2: Add import for `fetchKalshiProps`**

Find the existing import line at the top of `KalshiMarkets.jsx`:
```js
import { fetchKalshiNBAEvents, fetchKalshiMarkets, fetchOddsNBA } from '../api/nbaApi';
```

Replace it with:
```js
import { fetchKalshiNBAEvents, fetchKalshiMarkets, fetchOddsNBA, fetchKalshiProps } from '../api/nbaApi';
```

- [ ] **Step 3: Add the `PropsModal` component**

Add this component above the `BankrollPanel` function definition (i.e., before `function BankrollPanel`):

```jsx
const PROP_TABS = [
  { label: 'Points',   series: 'KXNBAPTS' },
  { label: 'Rebounds', series: 'KXNBAREB' },
  { label: 'Assists',  series: 'KXNBAAST' },
  { label: 'Threes',   series: 'KXNBA3PT' },
  { label: 'PRA',      series: 'KXNBAPRA' },
];

function PropsModal({ gameTitle, gameSuffix, onClose }) {
  const [activeTab, setActiveTab] = useState('KXNBAPTS');
  const [propsByTab, setPropsByTab] = useState({});
  const [tabLoading, setTabLoading] = useState(false);

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

  const markets = propsByTab[activeTab];

  return (
    <div style={styles.backdrop} onClick={onClose}>
      <div style={styles.modal} onClick={e => e.stopPropagation()}>
        <div style={styles.modalHeader}>
          <div style={styles.modalTitle}>{gameTitle} — Player Props</div>
          <button style={styles.modalClose} onClick={onClose}>×</button>
        </div>
        <div style={styles.modalTabs}>
          {PROP_TABS.map(tab => (
            <button
              key={tab.series}
              style={activeTab === tab.series ? styles.modalTabActive : styles.modalTab}
              onClick={() => setActiveTab(tab.series)}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <div style={styles.modalBody}>
          {tabLoading && <div style={styles.modalEmpty}>Loading…</div>}
          {!tabLoading && markets && markets.length === 0 && (
            <div style={styles.modalEmpty}>No active markets</div>
          )}
          {!tabLoading && markets && markets.map(mk => {
            const pct = Math.round((parseFloat(mk.yes_ask_dollars) + parseFloat(mk.yes_bid_dollars)) / 2 * 100);
            const color = pctColor(pct);
            return (
              <div key={mk.ticker} style={styles.propRow}>
                <span style={styles.propLabel}>{mk.yes_sub_title}</span>
                <div style={styles.barWrap}>
                  <div style={{ height: '100%', width: `${pct}%`, background: color, borderRadius: '4px', transition: 'width 0.4s' }} />
                </div>
                <span style={{ ...styles.pctLabel, color }}>{pct}¢</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Commit**

```bash
git add src/components/KalshiMarkets.jsx
git commit -m "feat: add PropsModal component and styles"
```

---

### Task 4: Wire "View Props" button into GameCard

**Files:**
- Modify: `src/components/KalshiMarkets.jsx`

- [ ] **Step 1: Update `GameCard` to add modal state and "View Props" button**

Find the existing `GameCard` function. It currently starts with:
```jsx
function GameCard({ event, markets, oddsGame, bankroll, mode, portfolioAllocation }) {
```

Replace the entire `GameCard` function with:

```jsx
function GameCard({ event, markets, oddsGame, bankroll, mode, portfolioAllocation }) {
  const occurrenceDate = markets[0]?.occurrence_datetime
    ? new Date(markets[0].occurrence_datetime).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
    : null;

  const status = markets[0]?.status ?? 'unknown';

  const advisorMarket = markets.find(mk => mk.yes_sub_title && mk.no_sub_title) ?? null;
  const kalshiYesPct = advisorMarket
    ? Math.round((parseFloat(advisorMarket.yes_ask_dollars) + parseFloat(advisorMarket.yes_bid_dollars)) / 2 * 100)
    : null;

  const [modalOpen, setModalOpen] = useState(false);
  const gameSuffix = event.event_ticker.split('-').slice(1).join('-');

  return (
    <>
      <div style={styles.card}>
        <div style={styles.cardTitle}>{event.title}</div>
        <div style={styles.cardSub}>{event.sub_title}</div>
        <span style={{ ...styles.statusBadge, ...statusStyle(status) }}>
          {status.toUpperCase()}
        </span>
        {markets.map(mk => {
          const pct = Math.round((parseFloat(mk.yes_ask_dollars) + parseFloat(mk.yes_bid_dollars)) / 2 * 100);
          const color = pctColor(pct);
          return (
            <div key={mk.ticker} style={styles.marketRow}>
              <span style={styles.teamLabel}>{mk.yes_sub_title}</span>
              <div style={styles.barWrap}>
                <div style={{ height: '100%', width: `${pct}%`, background: color, borderRadius: '4px', transition: 'width 0.4s' }} />
              </div>
              <span style={{ ...styles.pctLabel, color }}>{pct}¢</span>
            </div>
          );
        })}
        {occurrenceDate && <div style={styles.occurrenceDate}>{occurrenceDate}</div>}
        <OddsSection oddsGame={oddsGame} />
        <AdvisorSection
          kalshiYesPct={kalshiYesPct}
          kalshiYesTeam={advisorMarket?.yes_sub_title ?? ''}
          oddsGame={oddsGame}
          bankroll={bankroll}
          mode={mode}
          portfolioAllocation={portfolioAllocation}
        />
        <button style={styles.viewPropsBtn} onClick={() => setModalOpen(true)}>
          View Player Props
        </button>
      </div>
      {modalOpen && (
        <PropsModal
          gameTitle={event.title}
          gameSuffix={gameSuffix}
          onClose={() => setModalOpen(false)}
        />
      )}
    </>
  );
}
```

- [ ] **Step 2: Verify the build passes**

```bash
npm run build 2>&1 | tail -10
```

Expected: `✓ built in ...ms` with no errors (chunk size warning is fine).

- [ ] **Step 3: Commit**

```bash
git add src/components/KalshiMarkets.jsx
git commit -m "feat: add View Props button and wire PropsModal into GameCard"
```

---

### Task 5: Verify end-to-end and push

- [ ] **Step 1: Start the dev server**

```bash
npm run dev
```

Open `http://localhost:5173` and navigate to the Kalshi Markets tab.

Verify:
- Each active game card has a "View Player Props" button at the bottom
- Clicking it opens a modal with the game title in the header
- 5 tabs are shown: Points | Rebounds | Assists | Threes | PRA
- The Points tab loads immediately and shows prop rows (player name + bar + ¢)
- Switching to Rebounds fetches and displays rebounds props
- Switching back to Points does NOT re-fetch (cached)
- If a series has no active markets, "No active markets" is shown
- Clicking the backdrop or the × closes the modal

- [ ] **Step 2: Push**

```bash
git push
```
