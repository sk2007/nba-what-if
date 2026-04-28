# Kalshi Bet Advisor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add edge calculation, Kelly Criterion bet sizing, recommendation badges, and a bankroll input panel to the Kalshi Markets page.

**Architecture:** Pure utility functions (`betAdvisor.js`) compute edge and Kelly values from existing market + odds data with no side effects. `KalshiMarkets.jsx` gains bankroll/mode state and passes computed advisor data down to `GameCard` and a new `AdvisorSection` component. A new `BankrollPanel` component renders the top-of-page controls and portfolio summary.

**Tech Stack:** React (existing), plain JS math utilities, inline styles (existing pattern)

---

## File Structure

- **Create:** `src/utils/betAdvisor.js` — pure functions: `computeEdge`, `computeKelly`, `computePortfolioKelly`, `getRecommendation`
- **Modify:** `src/components/KalshiMarkets.jsx` — add `bankroll`/`mode` state, `BankrollPanel` component, `AdvisorSection` component, wire advisor data into `GameCard`

---

### Task 1: Pure utility — edge calculation

**Files:**
- Create: `src/utils/betAdvisor.js`

- [ ] **Step 1: Create the file with `computeEdge`**

```js
// src/utils/betAdvisor.js

/**
 * Convert American moneyline odds to raw implied probability.
 * @param {number} american
 * @returns {number} probability 0–1
 */
function rawImplied(american) {
  if (american < 0) return Math.abs(american) / (Math.abs(american) + 100);
  return 100 / (american + 100);
}

/**
 * Vig-adjust two raw probabilities so they sum to 1.
 * @param {number} p1 raw prob for side 1
 * @param {number} p2 raw prob for side 2
 * @returns {{ adj1: number, adj2: number }}
 */
function vigAdjust(p1, p2) {
  const total = p1 + p2;
  return { adj1: p1 / total, adj2: p2 / total };
}

/**
 * Compute edge between Kalshi yes price and sportsbook implied probability.
 *
 * @param {number} kalshiYesPct  Kalshi mid-price expressed as 0–100
 * @param {{ home_team: string, away_team: string, bookmakers: Array }} oddsGame
 * @param {string} kalshiYesTeam  The team name on the YES side from Kalshi (yes_sub_title)
 * @returns {{ sbImplied: number, sbEdge: number, midpointEdge: number } | null}
 *   Returns null when sportsbook data is unavailable or incomplete.
 */
export function computeEdge(kalshiYesPct, oddsGame, kalshiYesTeam) {
  if (!oddsGame || kalshiYesPct == null) return null;

  const BOOK_PRIORITY = ['draftkings', 'fanduel', 'betmgm', 'caesars', 'pointsbet', 'bovada'];
  let bm = null;
  for (const key of BOOK_PRIORITY) {
    bm = oddsGame.bookmakers?.find(b => b.key === key);
    if (bm) break;
  }
  if (!bm) bm = oddsGame.bookmakers?.[0] ?? null;
  if (!bm) return null;

  const h2h = bm.markets?.find(m => m.key === 'h2h');
  if (!h2h) return null;

  const homeOutcome = h2h.outcomes?.find(o => o.name === oddsGame.home_team);
  const awayOutcome = h2h.outcomes?.find(o => o.name === oddsGame.away_team);
  if (!homeOutcome || !awayOutcome) return null;

  const rawHome = rawImplied(homeOutcome.price);
  const rawAway = rawImplied(awayOutcome.price);
  const { adj1: adjHome, adj2: adjAway } = vigAdjust(rawHome, rawAway);

  // Determine which adjusted probability corresponds to the Kalshi YES team
  const yesTeamLower = (kalshiYesTeam ?? '').toLowerCase();
  const homeNameLower = oddsGame.home_team.toLowerCase();
  const awayNameLower = oddsGame.away_team.toLowerCase();

  let sbImplied;
  if (homeNameLower.split(' ').some(t => yesTeamLower.includes(t))) {
    sbImplied = adjHome * 100;
  } else if (awayNameLower.split(' ').some(t => yesTeamLower.includes(t))) {
    sbImplied = adjAway * 100;
  } else {
    // Fallback: use whichever team name appears in the yes sub_title
    sbImplied = adjHome * 100;
  }

  const kalshiPct = kalshiYesPct; // already 0–100
  const sbEdge = sbImplied - kalshiPct;
  const midpoint = (sbImplied + kalshiPct) / 2;
  const midpointEdge = midpoint - kalshiPct;

  return { sbImplied, sbEdge, midpointEdge };
}
```

- [ ] **Step 2: Add `getRecommendation`**

Append to `src/utils/betAdvisor.js`:

```js
/**
 * @param {number} sbEdge  percentage points, e.g. 7.2 means 7.2%
 * @returns {{ label: string, color: string }}
 */
export function getRecommendation(sbEdge) {
  if (sbEdge > 8)  return { label: 'STRONG YES', color: '#1a7a41' };
  if (sbEdge > 3)  return { label: 'LEAN YES',   color: '#2563eb' };
  if (sbEdge >= -3) return { label: 'PASS',       color: '#aaa' };
  if (sbEdge >= -8) return { label: 'LEAN NO',    color: '#e67e22' };
  return               { label: 'STRONG NO',  color: '#c0392b' };
}
```

- [ ] **Step 3: Commit**

```bash
git add src/utils/betAdvisor.js
git commit -m "feat: add computeEdge and getRecommendation utilities"
```

---

### Task 2: Pure utility — Kelly Criterion

**Files:**
- Modify: `src/utils/betAdvisor.js`

- [ ] **Step 1: Add `computeKelly` for single-game mode**

Append to `src/utils/betAdvisor.js`:

```js
/**
 * Single-game Kelly fraction, capped at 0.25.
 *
 * Formula: f = (edge * (b + 1) - 1) / b  where b = payout odds on YES
 * edge here is sbEdge expressed as a fraction (e.g. 0.072 for 7.2%)
 *
 * @param {number} sbEdgePct   edge in percentage points (e.g. 7.2)
 * @param {number} kalshiYesPct  Kalshi mid-price 0–100
 * @param {number} bankroll
 * @returns {{ single: number, halfSingle: number } | null}
 *   Dollar amounts, or null if Kelly is negative (no edge).
 */
export function computeKelly(sbEdgePct, kalshiYesPct, bankroll) {
  if (!bankroll || bankroll <= 0) return null;
  if (!kalshiYesPct || kalshiYesPct <= 0 || kalshiYesPct >= 100) return null;

  const p = kalshiYesPct / 100; // Kalshi implied prob of YES
  const b = (1 / p) - 1;        // payout odds: win b per $1 staked
  const edge = sbEdgePct / 100; // convert pct to fraction

  // Standard Kelly: f* = (p_true * (b+1) - 1) / b
  // p_true ≈ kalshi + edge (sportsbook as truth shifts our estimate)
  const pTrue = p + edge;
  const f = (pTrue * (b + 1) - 1) / b;

  if (f <= 0) return null; // negative Kelly = no edge, don't bet

  const capped = Math.min(f, 0.25);
  const single = Math.round(capped * bankroll);
  const halfSingle = Math.round((capped / 2) * bankroll);
  return { single, halfSingle };
}
```

- [ ] **Step 2: Add `computePortfolioKelly` for portfolio mode**

Append to `src/utils/betAdvisor.js`:

```js
/**
 * Portfolio Kelly: proportionally size bets across all positive-edge games
 * so total allocation never exceeds the full bankroll.
 *
 * Each game's raw Kelly fraction is computed, negatives are zeroed out,
 * then fractions are normalized so they sum to ≤ 1.0 (capped per-game at 0.25).
 *
 * @param {Array<{ sbEdgePct: number, kalshiYesPct: number }>} games
 * @param {number} bankroll
 * @returns {number[]}  Dollar allocation per game (same order as input). Zero = pass.
 */
export function computePortfolioKelly(games, bankroll) {
  if (!bankroll || bankroll <= 0) return games.map(() => 0);

  const fractions = games.map(({ sbEdgePct, kalshiYesPct }) => {
    if (!kalshiYesPct || kalshiYesPct <= 0 || kalshiYesPct >= 100) return 0;
    const p = kalshiYesPct / 100;
    const b = (1 / p) - 1;
    const pTrue = p + sbEdgePct / 100;
    const f = (pTrue * (b + 1) - 1) / b;
    return Math.max(0, Math.min(f, 0.25));
  });

  const total = fractions.reduce((s, f) => s + f, 0);
  if (total === 0) return games.map(() => 0);

  // Scale down if total > 1 so we never over-allocate
  const scale = total > 1 ? 1 / total : 1;
  return fractions.map(f => Math.round(f * scale * bankroll));
}
```

- [ ] **Step 3: Commit**

```bash
git add src/utils/betAdvisor.js
git commit -m "feat: add computeKelly and computePortfolioKelly utilities"
```

---

### Task 3: BankrollPanel component + advisor state

**Files:**
- Modify: `src/components/KalshiMarkets.jsx`

- [ ] **Step 1: Add new styles and advisor state to `KalshiMarkets`**

In `KalshiMarkets.jsx`, add these entries to the `styles` object (after `oddsBookName`):

```js
  advisorDivider: { margin: '14px 0 10px', borderTop: '1px dashed #e5e5e5' },
  advisorLabel: { fontSize: '10px', fontWeight: '700', color: '#aaa', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: '8px' },
  recommendBadge: { display: 'inline-block', fontSize: '11px', fontWeight: '700', padding: '3px 9px', borderRadius: '99px', marginBottom: '8px', letterSpacing: '0.05em' },
  edgeLine: { fontSize: '12px', color: '#555', marginBottom: '4px' },
  kellyLine: { fontSize: '12px', color: '#333', fontWeight: '600', marginBottom: '4px' },
  rationale: { fontSize: '11px', color: '#888', fontStyle: 'italic', marginTop: '4px' },
  bankrollPanel: { background: '#f8f8f8', border: '1px solid #e5e5e5', borderRadius: '10px', padding: '16px 20px', marginBottom: '20px', display: 'flex', alignItems: 'center', gap: '20px', flexWrap: 'wrap' },
  bankrollInput: { border: '1px solid #ccc', borderRadius: '6px', padding: '6px 10px', fontSize: '14px', width: '120px' },
  modeToggle: { display: 'flex', gap: '0', borderRadius: '6px', overflow: 'hidden', border: '1px solid #ccc' },
  modeBtn: { padding: '6px 14px', fontSize: '12px', fontWeight: '600', cursor: 'pointer', border: 'none', background: '#fff', color: '#555' },
  modeBtnActive: { padding: '6px 14px', fontSize: '12px', fontWeight: '600', cursor: 'pointer', border: 'none', background: '#1a1a1a', color: '#fff' },
  portfolioSummary: { fontSize: '12px', color: '#555', marginLeft: 'auto' },
  bankrollPrompt: { fontSize: '11px', color: '#bbb', marginTop: '8px' },
```

In the `KalshiMarkets` function, add `bankroll` and `mode` state after the existing `useState` calls:

```js
  const [bankroll, setBankroll] = useState('');
  const [mode, setMode] = useState('single');
```

- [ ] **Step 2: Add `BankrollPanel` component above `GameCard`**

Add this component to `KalshiMarkets.jsx` above the `GameCard` function definition:

```jsx
function BankrollPanel({ bankroll, setBankroll, mode, setMode, portfolioSummary }) {
  return (
    <div style={styles.bankrollPanel}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <span style={{ fontSize: '13px', color: '#555', fontWeight: '600' }}>Bankroll</span>
        <span style={{ fontSize: '13px', color: '#555' }}>$</span>
        <input
          style={styles.bankrollInput}
          type="number"
          min="0"
          placeholder="0"
          value={bankroll}
          onChange={e => setBankroll(e.target.value)}
        />
      </div>
      <div style={styles.modeToggle}>
        <button
          style={mode === 'single' ? styles.modeBtnActive : styles.modeBtn}
          onClick={() => setMode('single')}
        >
          Single-game
        </button>
        <button
          style={mode === 'portfolio' ? styles.modeBtnActive : styles.modeBtn}
          onClick={() => setMode('portfolio')}
        >
          Portfolio
        </button>
      </div>
      {portfolioSummary && (
        <div style={styles.portfolioSummary}>{portfolioSummary}</div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add src/components/KalshiMarkets.jsx
git commit -m "feat: add BankrollPanel component and bankroll/mode state"
```

---

### Task 4: AdvisorSection component

**Files:**
- Modify: `src/components/KalshiMarkets.jsx`

- [ ] **Step 1: Import advisor utilities**

At the top of `KalshiMarkets.jsx`, add the import after the existing imports:

```js
import { computeEdge, computeKelly, getRecommendation } from '../utils/betAdvisor';
```

- [ ] **Step 2: Add `AdvisorSection` component**

Add this below `BankrollPanel` and above `GameCard`:

```jsx
function AdvisorSection({ kalshiYesPct, kalshiYesTeam, oddsGame, bankroll, mode, portfolioAllocation }) {
  const parsedBankroll = parseFloat(bankroll);
  const hasBankroll = !isNaN(parsedBankroll) && parsedBankroll > 0;

  if (!kalshiYesPct || kalshiYesPct <= 0) {
    return (
      <>
        <div style={styles.advisorDivider} />
        <div style={{ ...styles.edgeLine, color: '#bbb' }}>Insufficient market data</div>
      </>
    );
  }

  const edge = computeEdge(kalshiYesPct, oddsGame, kalshiYesTeam);

  if (!edge) {
    return (
      <>
        <div style={styles.advisorDivider} />
        <div style={styles.advisorLabel}>Bet Advisor</div>
        <div style={styles.edgeLine}>No sportsbook data available</div>
      </>
    );
  }

  const { sbEdge, midpointEdge, sbImplied } = edge;
  const rec = getRecommendation(sbEdge);

  let kellySizing = null;
  if (hasBankroll && mode === 'single') {
    kellySizing = computeKelly(sbEdge, kalshiYesPct, parsedBankroll);
  }

  const direction = sbEdge > 3 ? 'underprices' : sbEdge < -3 ? 'overprices' : 'fairly prices';
  const action = sbEdge > 3 ? `Lean YES on ${kalshiYesTeam}.` : sbEdge < -3 ? `Lean NO on ${kalshiYesTeam}.` : 'No clear edge.';
  const rationale = `Kalshi ${direction} ${kalshiYesTeam} at ${kalshiYesPct}¢ vs ${sbImplied.toFixed(1)}% sportsbook implied. ${action}`;

  return (
    <>
      <div style={styles.advisorDivider} />
      <div style={styles.advisorLabel}>Bet Advisor</div>
      <span style={{ ...styles.recommendBadge, background: rec.color + '22', color: rec.color }}>
        {rec.label}
      </span>
      <div style={styles.edgeLine}>
        Sportsbook edge: <strong>{sbEdge > 0 ? '+' : ''}{sbEdge.toFixed(1)}%</strong>
        {' '}| Midpoint edge: <strong>{midpointEdge > 0 ? '+' : ''}{midpointEdge.toFixed(1)}%</strong>
      </div>
      {hasBankroll && mode === 'single' && kellySizing && (
        <div style={styles.kellyLine}>
          Single-game: ${kellySizing.single} &nbsp;(half-Kelly: ${kellySizing.halfSingle})
        </div>
      )}
      {hasBankroll && mode === 'single' && !kellySizing && (
        <div style={{ ...styles.kellyLine, color: '#bbb' }}>No edge — skip this bet</div>
      )}
      {hasBankroll && mode === 'portfolio' && portfolioAllocation != null && (
        <div style={styles.kellyLine}>Portfolio allocation: ${portfolioAllocation}</div>
      )}
      {!hasBankroll && (
        <div style={styles.bankrollPrompt}>Enter bankroll above to see bet sizing.</div>
      )}
      <div style={styles.rationale}>{rationale}</div>
    </>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add src/components/KalshiMarkets.jsx
git commit -m "feat: add AdvisorSection component"
```

---

### Task 5: Wire advisor into GameCard and compute portfolio allocation

**Files:**
- Modify: `src/components/KalshiMarkets.jsx`

- [ ] **Step 1: Update `GameCard` to accept and render advisor props**

Replace the existing `GameCard` function:

```jsx
function GameCard({ event, markets, oddsGame, bankroll, mode, portfolioAllocation }) {
  const occurrenceDate = markets[0]?.occurrence_datetime
    ? new Date(markets[0].occurrence_datetime).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
    : null;

  const status = markets[0]?.status ?? 'unknown';

  // Use first market with both sides for advisor
  const advisorMarket = markets.find(mk => mk.yes_sub_title && mk.no_sub_title) ?? null;
  const kalshiYesPct = advisorMarket
    ? Math.round((parseFloat(advisorMarket.yes_ask_dollars) + parseFloat(advisorMarket.yes_bid_dollars)) / 2 * 100)
    : null;

  return (
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
    </div>
  );
}
```

- [ ] **Step 2: Compute portfolio allocations and summary in `KalshiMarkets` render**

Add this block inside the `KalshiMarkets` function body, just before the `return` statement:

```js
  // Build per-event advisor inputs for portfolio Kelly
  const parsedBankroll = parseFloat(bankroll);
  const hasBankroll = !isNaN(parsedBankroll) && parsedBankroll > 0;

  const advisorInputs = events.map(ev => {
    const markets = marketsByEvent[ev.event_ticker] ?? [];
    const mk = markets.find(m => m.yes_sub_title && m.no_sub_title);
    if (!mk) return { sbEdgePct: 0, kalshiYesPct: 0 };
    const kalshiYesPct = Math.round((parseFloat(mk.yes_ask_dollars) + parseFloat(mk.yes_bid_dollars)) / 2 * 100);
    const oddsGame = matchOdds(oddsGames, ev.title);
    const edge = computeEdge(kalshiYesPct, oddsGame, mk.yes_sub_title);
    return { sbEdgePct: edge?.sbEdge ?? 0, kalshiYesPct };
  });

  const portfolioAllocations = hasBankroll
    ? computePortfolioKelly(advisorInputs, parsedBankroll)
    : events.map(() => null);

  const edgeCount = advisorInputs.filter(a => a.sbEdgePct > 3).length;
  const totalPortfolioAlloc = portfolioAllocations.reduce((s, a) => s + (a ?? 0), 0);
  const portfolioSummary = hasBankroll && edgeCount > 0
    ? `${edgeCount} edge${edgeCount > 1 ? 's' : ''} detected tonight — recommended total allocation: $${totalPortfolioAlloc} (${Math.round(totalPortfolioAlloc / parsedBankroll * 100)}% of bankroll)`
    : null;
```

- [ ] **Step 3: Import `computePortfolioKelly` (add to existing import line)**

Update the import at the top of `KalshiMarkets.jsx` to:

```js
import { computeEdge, computeKelly, computePortfolioKelly, getRecommendation } from '../utils/betAdvisor';
```

- [ ] **Step 4: Update the JSX return to wire everything together**

Replace the `return` block in `KalshiMarkets`:

```jsx
  return (
    <div style={styles.container}>
      <div style={styles.sectionLabel}>Kalshi NBA Game Markets</div>
      <BankrollPanel
        bankroll={bankroll}
        setBankroll={setBankroll}
        mode={mode}
        setMode={setMode}
        portfolioSummary={portfolioSummary}
      />
      {loading && <div style={styles.loading}>Loading NBA events from Kalshi…</div>}
      {err && <div style={styles.error}>Error: {err}</div>}
      {!loading && !err && !allLoaded && (
        <div style={styles.progress}>Loading odds… {loadedCount}/{events.length}</div>
      )}
      {!loading && !err && (
        <div style={styles.grid}>
          {events.map((ev, i) => (
            <GameCard
              key={ev.event_ticker}
              event={ev}
              markets={marketsByEvent[ev.event_ticker] ?? []}
              oddsGame={matchOdds(oddsGames, ev.title)}
              bankroll={bankroll}
              mode={mode}
              portfolioAllocation={portfolioAllocations[i]}
            />
          ))}
        </div>
      )}
    </div>
  );
```

- [ ] **Step 5: Commit**

```bash
git add src/components/KalshiMarkets.jsx
git commit -m "feat: wire bet advisor into GameCard with portfolio Kelly support"
```

---

### Task 6: Verify and push

- [ ] **Step 1: Run the dev server**

```bash
npm run dev
```

Open `http://localhost:5173`, navigate to Kalshi Markets tab. Verify:
- Bankroll panel appears at top with input and Single-game / Portfolio toggle
- Each card shows "BET ADVISOR" section with badge and edge line (even with no bankroll)
- "Enter bankroll above to see bet sizing." appears on cards when no bankroll set
- Entering a bankroll shows Kelly sizing on cards in single-game mode
- Switching to portfolio mode shows "Portfolio allocation: $X" instead
- Portfolio summary line appears in bankroll panel when edges exist
- Cards with no sportsbook data show "No sportsbook data available" gracefully

- [ ] **Step 2: Push**

```bash
git push
```
