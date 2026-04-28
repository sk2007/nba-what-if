import { useState } from 'react';
import SeasonSelector from './components/SeasonSelector';
import PlayEditor from './components/PlayEditor';
import KalshiMarkets from './components/KalshiMarkets';
import './App.css';

const TABS = ['Play Editor', 'Kalshi Markets'];

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

export default function App() {
  const [season, setSeason] = useState('2024-25');
  const [seasonType, setSeasonType] = useState('Regular Season');
  const [tab, setTab] = useState('Play Editor');

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
      {tab === 'Kalshi Markets' && <KalshiMarkets />}
    </div>
  );
}
