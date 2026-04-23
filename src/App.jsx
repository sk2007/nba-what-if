import { useState } from 'react';
import SeasonSelector from './components/SeasonSelector';
import PlayEditor from './components/PlayEditor';
import './App.css';

export default function App() {
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
      <PlayEditor season={season} seasonType={seasonType} />
    </div>
  );
}
