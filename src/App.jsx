import { useState } from 'react';
import SeasonSelector from './components/SeasonSelector';
import PlayEditor from './components/PlayEditor';
import KalshiMarkets from './components/KalshiMarkets';
import './App.css';

const TABS = ['Play Editor', 'Kalshi Markets'];
const KALSHI_PASSWORD = 'Lebron23';
const KALSHI_UNLOCK_KEY = 'kalshi-markets-unlocked';

const tabBarStyle = {
  display: 'flex',
  gap: '4px',
  marginBottom: '24px',
  borderBottom: '1px solid #e5e5e5',
  paddingBottom: '0',
};

function tabStyle(active) {
  return {
    padding: '8px 18px',
    fontSize: '13px',
    fontWeight: active ? '700' : '500',
    color: active ? '#1a1a1a' : '#888',
    background: 'none',
    border: 'none',
    borderBottom: active ? '2px solid #1a1a1a' : '2px solid transparent',
    cursor: 'pointer',
    marginBottom: '-1px',
    transition: 'color 0.15s',
  };
}

const lockStyles = {
  panel: {
    maxWidth: '360px',
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
    paddingTop: '8px',
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
    <form style={lockStyles.panel} onSubmit={handleSubmit}>
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
  const [seasonType, setSeasonType] = useState('Regular Season');
  const [tab, setTab] = useState('Play Editor');
  const [kalshiUnlocked, setKalshiUnlocked] = useState(
    () => sessionStorage.getItem(KALSHI_UNLOCK_KEY) === 'true'
  );

  return (
    <div>
      <h1 style={{ marginBottom: '8px', fontSize: '24px' }}>NBA What If</h1>
      <p style={{ color: '#666', marginBottom: '20px', fontSize: '14px' }}>
        Explore how key moments affected win probability
      </p>
      <div style={tabBarStyle}>
        {TABS.map(t => (
          <button key={t} style={tabStyle(tab === t)} onClick={() => setTab(t)}>{t}</button>
        ))}
      </div>
      {tab === 'Play Editor' && (
        <>
          <SeasonSelector
            season={season}
            seasonType={seasonType}
            onSeasonChange={setSeason}
            onSeasonTypeChange={setSeasonType}
          />
          <PlayEditor season={season} seasonType={seasonType} />
        </>
      )}
      {tab === 'Kalshi Markets' && (
        kalshiUnlocked
          ? <KalshiMarkets />
          : <KalshiPasswordGate onUnlock={() => setKalshiUnlocked(true)} />
      )}
    </div>
  );
}
