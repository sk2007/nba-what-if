import { useState, useEffect } from 'react';
import { fetchKalshiNBAEvents, fetchKalshiMarkets, fetchOddsNBA } from '../api/nbaApi';

const styles = {
  container: { padding: '0 0 40px' },
  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: '16px', marginTop: '20px' },
  card: { border: '1px solid #e5e5e5', borderRadius: '10px', padding: '18px', background: '#fff', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' },
  cardTitle: { fontSize: '14px', fontWeight: '700', color: '#1a1a1a', marginBottom: '4px' },
  cardSub: { fontSize: '12px', color: '#888', marginBottom: '14px' },
  marketRow: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid #f0f0f0' },
  teamLabel: { fontSize: '13px', fontWeight: '600', color: '#333', flex: 1 },
  barWrap: { flex: 2, margin: '0 12px', height: '8px', borderRadius: '4px', background: '#f0f0f0', overflow: 'hidden' },
  pctLabel: { fontSize: '13px', fontWeight: '700', minWidth: '40px', textAlign: 'right' },
  statusBadge: { display: 'inline-block', fontSize: '10px', fontWeight: '700', padding: '2px 7px', borderRadius: '99px', marginBottom: '10px', letterSpacing: '0.04em' },
  occurrenceDate: { fontSize: '11px', color: '#aaa', marginTop: '10px' },
  loading: { color: '#999', fontSize: '13px', marginTop: '20px' },
  error: { color: '#c0392b', fontSize: '13px', marginTop: '20px' },
  sectionLabel: { fontSize: '11px', fontWeight: '600', color: '#888', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: '16px' },
  progress: { color: '#999', fontSize: '12px', marginTop: '8px' },
  divider: { margin: '14px 0 10px', borderTop: '1px dashed #e5e5e5' },
  oddsLabel: { fontSize: '10px', fontWeight: '700', color: '#aaa', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: '8px' },
  oddsGrid: { display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '6px', marginBottom: '4px' },
  oddsCol: { display: 'flex', flexDirection: 'column', gap: '2px' },
  oddsHeader: { fontSize: '10px', color: '#bbb', fontWeight: '600', textAlign: 'center', marginBottom: '2px' },
  oddsTeam: { fontSize: '11px', color: '#555', textAlign: 'center', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
  oddsValue: { fontSize: '13px', fontWeight: '700', textAlign: 'center' },
  oddsBookRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '6px' },
  oddsBookName: { fontSize: '10px', color: '#bbb', textTransform: 'uppercase', letterSpacing: '0.05em' },
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
};

function statusStyle(status) {
  if (status === 'active') return { background: '#e6f9ee', color: '#1a7a41' };
  if (status === 'closed') return { background: '#f0f0f0', color: '#888' };
  return { background: '#fff3e0', color: '#e67e22' };
}

function pctColor(pct) {
  if (pct >= 65) return '#1a7a41';
  if (pct >= 45) return '#2563eb';
  return '#c0392b';
}

function americanColor(val) {
  return val < 0 ? '#1a7a41' : '#2563eb';
}

function formatAmerican(val) {
  return val > 0 ? `+${val}` : `${val}`;
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// Pick the most liquid/well-known book available for a game
const BOOK_PRIORITY = ['draftkings', 'fanduel', 'betmgm', 'caesars', 'pointsbet', 'bovada'];

function pickBook(bookmakers) {
  for (const key of BOOK_PRIORITY) {
    const bm = bookmakers.find(b => b.key === key);
    if (bm) return bm;
  }
  return bookmakers[0] ?? null;
}

function getMarket(bookmaker, key) {
  return bookmaker?.markets?.find(m => m.key === key) ?? null;
}

// All words from a full team name that might appear in a Kalshi title (city or nickname)
function teamTokens(fullName) {
  return fullName.toLowerCase().split(' ');
}

// Match an odds-api game to a Kalshi event — at least one token from each team must appear in the title
function matchOdds(oddsGames, kalshiTitle) {
  if (!oddsGames) return null;
  const title = kalshiTitle.toLowerCase();
  return oddsGames.find(g => {
    const homeTokens = teamTokens(g.home_team);
    const awayTokens = teamTokens(g.away_team);
    return homeTokens.some(t => title.includes(t)) && awayTokens.some(t => title.includes(t));
  }) ?? null;
}

function OddsSection({ oddsGame }) {
  if (!oddsGame) return null;
  const bm = pickBook(oddsGame.bookmakers ?? []);
  if (!bm) return null;

  const h2h = getMarket(bm, 'h2h');
  const spreads = getMarket(bm, 'spreads');
  const totals = getMarket(bm, 'totals');

  const homeH2H = h2h?.outcomes?.find(o => o.name === oddsGame.home_team);
  const awayH2H = h2h?.outcomes?.find(o => o.name === oddsGame.away_team);
  const homeSpread = spreads?.outcomes?.find(o => o.name === oddsGame.home_team);
  const awaySpread = spreads?.outcomes?.find(o => o.name === oddsGame.away_team);
  const over = totals?.outcomes?.find(o => o.name === 'Over');
  const under = totals?.outcomes?.find(o => o.name === 'Under');

  const homeName = oddsGame.home_team.split(' ').pop();
  const awayName = oddsGame.away_team.split(' ').pop();

  return (
    <>
      <div style={styles.divider} />
      <div style={styles.oddsLabel}>{bm.title} Odds</div>
      <div style={styles.oddsGrid}>
        {/* Moneyline */}
        <div style={styles.oddsCol}>
          <div style={styles.oddsHeader}>ML</div>
          {awayH2H && <>
            <div style={styles.oddsTeam}>{awayName}</div>
            <div style={{ ...styles.oddsValue, color: americanColor(awayH2H.price) }}>{formatAmerican(awayH2H.price)}</div>
          </>}
          {homeH2H && <>
            <div style={styles.oddsTeam}>{homeName}</div>
            <div style={{ ...styles.oddsValue, color: americanColor(homeH2H.price) }}>{formatAmerican(homeH2H.price)}</div>
          </>}
        </div>
        {/* Spread */}
        <div style={styles.oddsCol}>
          <div style={styles.oddsHeader}>Spread</div>
          {awaySpread && <>
            <div style={styles.oddsTeam}>{awayName}</div>
            <div style={styles.oddsValue}>{awaySpread.point > 0 ? '+' : ''}{awaySpread.point}</div>
          </>}
          {homeSpread && <>
            <div style={styles.oddsTeam}>{homeName}</div>
            <div style={styles.oddsValue}>{homeSpread.point > 0 ? '+' : ''}{homeSpread.point}</div>
          </>}
        </div>
        {/* Total */}
        <div style={styles.oddsCol}>
          <div style={styles.oddsHeader}>O/U</div>
          {over && <>
            <div style={styles.oddsTeam}>Over</div>
            <div style={styles.oddsValue}>{over.point}</div>
          </>}
          {under && <>
            <div style={styles.oddsTeam}>Under</div>
            <div style={styles.oddsValue}>{under.point}</div>
          </>}
        </div>
      </div>
    </>
  );
}

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

function GameCard({ event, markets, oddsGame }) {
  const occurrenceDate = markets[0]?.occurrence_datetime
    ? new Date(markets[0].occurrence_datetime).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
    : null;

  const status = markets[0]?.status ?? 'unknown';

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
    </div>
  );
}

export default function KalshiMarkets() {
  const [events, setEvents] = useState([]);
  const [marketsByEvent, setMarketsByEvent] = useState({});
  const [oddsGames, setOddsGames] = useState(null);
  const [loadedCount, setLoadedCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);
  const [bankroll, setBankroll] = useState('');
  const [mode, setMode] = useState('single');

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const [evs, odds] = await Promise.all([
          fetchKalshiNBAEvents(20),
          fetchOddsNBA().catch(() => null),
        ]);
        if (cancelled) return;
        setEvents(evs);
        if (odds && !odds.error) setOddsGames(odds);
        setLoading(false);

        for (let i = 0; i < evs.length; i++) {
          if (cancelled) break;
          if (i > 0) await sleep(200);
          try {
            const markets = await fetchKalshiMarkets(evs[i].event_ticker);
            if (cancelled) break;
            const filtered = markets.filter(mk => mk.yes_sub_title && mk.no_sub_title);
            setMarketsByEvent(prev => ({ ...prev, [evs[i].event_ticker]: filtered }));
          } catch {
            // skip failures silently
          }
          setLoadedCount(i + 1);
        }
      } catch (e) {
        if (!cancelled) setErr(e.message);
        setLoading(false);
      }
    }

    load();
    return () => { cancelled = true; };
  }, []);

  const allLoaded = loadedCount === events.length && events.length > 0;

  return (
    <div style={styles.container}>
      <div style={styles.sectionLabel}>Kalshi NBA Game Markets</div>
      {loading && <div style={styles.loading}>Loading NBA events from Kalshi…</div>}
      {err && <div style={styles.error}>Error: {err}</div>}
      {!loading && !err && !allLoaded && (
        <div style={styles.progress}>Loading odds… {loadedCount}/{events.length}</div>
      )}
      {!loading && !err && (
        <div style={styles.grid}>
          {events.map(ev => (
            <GameCard
              key={ev.event_ticker}
              event={ev}
              markets={marketsByEvent[ev.event_ticker] ?? []}
              oddsGame={matchOdds(oddsGames, ev.title)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
