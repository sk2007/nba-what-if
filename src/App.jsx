import { useState, useEffect } from 'react';
import SeasonSelector from './components/SeasonSelector';
import PlayEditor from './components/PlayEditor';
import KalshiMarkets from './components/KalshiMarkets';
import GameComparison from './components/GameComparison';
import ClutchIndex from './components/ClutchIndex';
import { fetchGames } from './api/nbaApi';
import './App.css';
import './Studio.css';

const TABS = ['Play Editor', 'Game Comparison', 'Clutch Index', 'Kalshi Markets'];
const TAB_COPY = {
  'Play Editor': ['Play Editor', 'Revisit a game play by play and test how changed outcomes reshape its win probability curve.'],
  'Game Comparison': ['Game Comparison', 'Place two games side by side to compare how momentum shifted from tip-off to the final possession.'],
  'Clutch Index': ['Clutch Index', 'Rank a team’s crunch-time contributors by the win probability they added in high-pressure moments.'],
  'Kalshi Markets': ['Kalshi Markets', 'Review NBA prediction markets, sportsbook context, and bankroll-aware recommendations.'],
};
const KALSHI_PASSWORD = 'Lebron23';
const KALSHI_UNLOCK_KEY = 'kalshi-markets-unlocked';

const lockStyles = {
  panel: {
    maxWidth: '360px',
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
    padding: '18px',
    borderRadius: '10px',
    background: 'var(--surface)',
  },
  label: {
    fontSize: '11px',
    fontWeight: '600',
    color: 'var(--text-secondary)',
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
  },
  inputRow: {
    display: 'flex',
    gap: '8px',
    alignItems: 'center',
  },
  input: {
    flex: 1,
    minWidth: 0,
    padding: '8px 10px',
    borderRadius: '6px',
    border: '1px solid var(--line)',
    fontSize: '13px',
    background: 'var(--surface-soft)',
  },
  button: {
    padding: '8px 14px',
    borderRadius: '6px',
    border: 'none',
    background: 'var(--gold)',
    color: 'var(--on-accent)',
    fontSize: '13px',
    fontWeight: '600',
    cursor: 'pointer',
  },
  error: {
    color: 'var(--error)',
    fontSize: '13px',
    margin: 0,
  },
};

function KalshiPasswordGate({ onUnlock }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  function handleSubmit(e) {
    e.preventDefault();
    if (password === KALSHI_PASSWORD) {
      sessionStorage.setItem(KALSHI_UNLOCK_KEY, 'true');
      onUnlock();
      return;
    }
    setError('Incorrect password');
  }

  return (
    <form className="surface-card" style={lockStyles.panel} onSubmit={handleSubmit}>
      <label style={lockStyles.label} htmlFor="kalshi-password">Kalshi Markets Password</label>
      <div style={lockStyles.inputRow}>
        <input
          id="kalshi-password"
          type="password"
          value={password}
          onChange={(e) => {
            setPassword(e.target.value);
            setError('');
          }}
          style={lockStyles.input}
          autoComplete="current-password"
          autoFocus
        />
        <button type="submit" style={lockStyles.button}>Unlock</button>
      </div>
      {error && <p style={lockStyles.error}>{error}</p>}
    </form>
  );
}

export default function App() {
  const [season, setSeason] = useState('2025-26');
  const [seasonType, setSeasonType] = useState('Regular Season');
  const [tab, setTab] = useState('Play Editor');
  const [kalshiUnlocked, setKalshiUnlocked] = useState(
    () => sessionStorage.getItem(KALSHI_UNLOCK_KEY) === 'true'
  );
  // Shared games list fetched once per season, used by both GameComparison and ClutchIndex
  const [gameList, setGameList] = useState(null);
  const games = gameList?.season === season && gameList?.type === seasonType ? gameList.games : [];

  useEffect(() => {
    let active = true;
    fetchGames(season, seasonType)
      .then((data) => { if (active) setGameList({ season, type: seasonType, games: data.games ?? [] }); })
      .catch(() => {});
    return () => { active = false; };
  }, [season, seasonType]);

  const seasonControls = (
    <SeasonSelector
      season={season}
      onSeasonChange={setSeason}
      seasonType={seasonType}
      onSeasonTypeChange={setSeasonType}
    />
  );

  return (
    <div className="app-shell">
      <header className="app-header">
        <a className="app-brand" href="#" onClick={(event) => { event.preventDefault(); setTab('Play Editor'); }} aria-label="NBA What If home"><img className="app-brand-mark" src="/brand/bsa-logo.jpeg" alt="" width="44" height="44" /><span><span className="app-eyebrow">Bruin Sports Analytics</span><h1 className="app-title">NBA What If<span className="app-title-dot">.</span></h1></span></a>
        <span className="app-header-badge">Basketball, reconsidered.</span>
      </header>

      <nav className="tab-bar" aria-label="Analysis tools">
        {TABS.map(t => (
          <button
            key={t}
            className={`tab-button${tab === t ? ' tab-button--active' : ''}`}
            onClick={() => setTab(t)}
            type="button"
            aria-current={tab === t ? 'page' : undefined}
          >
            {t}
          </button>
        ))}
      </nav>

      <section className={`tool-intro${tab === 'Play Editor' ? ' tool-intro--editor' : ''}`}>
        <h2 className="tool-intro__title">{TAB_COPY[tab][0]}</h2>
        <p className="tool-intro__copy">{TAB_COPY[tab][1]}</p>
      </section>

      {tab === 'Play Editor' && (
        <>
          <PlayEditor key={`${season}:${seasonType}`} season={season} seasonType={seasonType} seasonControls={seasonControls} />
        </>
      )}

      {tab === 'Game Comparison' && (
        <>
          {seasonControls}
          <GameComparison key={`${season}:${seasonType}`} season={season} seasonType={seasonType} />
        </>
      )}

      {tab === 'Clutch Index' && (
        <>
          {seasonControls}
          <ClutchIndex season={season} seasonType={seasonType} games={games} />
        </>
      )}

      {tab === 'Kalshi Markets' && (
        kalshiUnlocked
          ? <KalshiMarkets />
          : <KalshiPasswordGate onUnlock={() => setKalshiUnlocked(true)} />
      )}
      <footer className="app-footer">
        © 2026 Bruin Sports Analytics at UCLA
      </footer>
    </div>
  );
}
