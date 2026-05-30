import { useState, useEffect } from 'react';
import SeasonSelector from './components/SeasonSelector';
import PlayEditor from './components/PlayEditor';
import KalshiMarkets from './components/KalshiMarkets';
import GameComparison from './components/GameComparison';
import ClutchIndex from './components/ClutchIndex';
import { fetchGames } from './api/nbaApi';
import './App.css';

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
    background: '#fff',
  },
  label: {
    fontSize: '11px',
    fontWeight: '600',
    color: '#888',
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
    border: '1px solid #d0d0d0',
    fontSize: '13px',
    background: '#fafafa',
  },
  button: {
    padding: '8px 14px',
    borderRadius: '6px',
    border: 'none',
    background: '#1a1a1a',
    color: '#fff',
    fontSize: '13px',
    fontWeight: '600',
    cursor: 'pointer',
  },
  error: {
    color: '#dc2626',
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
  const [season, setSeason] = useState('2024-25');
  const [tab, setTab] = useState('Play Editor');
  const [kalshiUnlocked, setKalshiUnlocked] = useState(
    () => sessionStorage.getItem(KALSHI_UNLOCK_KEY) === 'true'
  );
  // Shared games list fetched once per season, used by both GameComparison and ClutchIndex
  const [games, setGames] = useState([]);

  useEffect(() => {
    setGames([]);
    fetchGames(season, 'Regular Season')
      .then((data) => setGames(data.games ?? []))
      .catch(() => {});
  }, [season]);

  return (
    <div className="app-shell">
      <header className="app-header">
        <div>
          <p className="app-eyebrow">Bruin Sports Analytics</p>
          <h1 className="app-title">NBA What If</h1>
          <p className="app-subtitle">
            Explore the moments, players, and markets that shape win probability across an NBA season.
          </p>
        </div>
        <span className="app-header-badge">Spring 2026</span>
        <div className="app-header-ball" aria-hidden="true">
          <span className="app-header-ball__line app-header-ball__line--vertical" />
          <span className="app-header-ball__line app-header-ball__line--horizontal" />
          <span className="app-header-ball__curve app-header-ball__curve--left" />
          <span className="app-header-ball__curve app-header-ball__curve--right" />
        </div>
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

      <section className="tool-intro">
        <h2 className="tool-intro__title">{TAB_COPY[tab][0]}</h2>
        <p className="tool-intro__copy">{TAB_COPY[tab][1]}</p>
      </section>

      {tab === 'Play Editor' && (
        <>
          <SeasonSelector season={season} onSeasonChange={setSeason} />
          <PlayEditor season={season} seasonType="Regular Season" />
        </>
      )}

      {tab === 'Game Comparison' && (
        <>
          <SeasonSelector season={season} onSeasonChange={setSeason} />
          <GameComparison season={season} seasonType="Regular Season" />
        </>
      )}

      {tab === 'Clutch Index' && (
        <>
          <SeasonSelector season={season} onSeasonChange={setSeason} />
          <ClutchIndex season={season} seasonType="Regular Season" games={games} />
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
