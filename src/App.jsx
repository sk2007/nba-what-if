import { useState } from 'react';
import TabNav from './components/TabNav';
import SeasonSelector from './components/SeasonSelector';
import PlayEditor from './components/PlayEditor';
import StatModel from './components/StatModel';
import './App.css';

export default function App() {
  const [activeTab, setActiveTab] = useState('Play Editor');
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
      <TabNav activeTab={activeTab} onTabChange={setActiveTab} />
      <div>
        {activeTab === 'Play Editor' && <PlayEditor season={season} seasonType={seasonType} />}
        {activeTab === 'Stat Model' && <StatModel season={season} seasonType={seasonType} />}
      </div>
    </div>
  );
}
