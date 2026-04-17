import { useState } from 'react';
import TabNav from './components/TabNav';
import PlayEditor from './components/PlayEditor';
import './App.css';

export default function App() {
  const [activeTab, setActiveTab] = useState('Play Editor');

  return (
    <div>
      <h1 style={{ marginBottom: '8px', fontSize: '24px' }}>NBA What If</h1>
      <p style={{ color: '#666', marginBottom: '24px', fontSize: '14px' }}>
        Explore how key moments affected win probability
      </p>
      <TabNav activeTab={activeTab} onTabChange={setActiveTab} />
      <div>
        {activeTab === 'Play Editor' && <PlayEditor />}
        {activeTab === 'Stat Model' && <p>Stat Model coming soon</p>}
      </div>
    </div>
  );
}
