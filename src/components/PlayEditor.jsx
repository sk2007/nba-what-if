import { useState } from 'react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
  ResponsiveContainer,
} from 'recharts';
import { originalCurve, plays } from '../data/plays';

const QUARTER_LINES = [12, 24, 36];

function WinProbChart({ data, title, color }) {
  return (
    <div style={styles.chartPanel}>
      <h3 style={styles.chartTitle}>{title}</h3>
      <ResponsiveContainer width="100%" height={260}>
        <LineChart data={data} margin={{ top: 8, right: 16, left: 0, bottom: 8 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
          <XAxis
            dataKey="minute"
            label={{ value: 'Game Time (min)', position: 'insideBottom', offset: -4, fontSize: 12 }}
            domain={[0, 48]}
            tickCount={9}
            tick={{ fontSize: 11 }}
          />
          <YAxis
            domain={[0, 100]}
            tickFormatter={(v) => `${v}%`}
            tick={{ fontSize: 11 }}
            width={42}
          />
          <Tooltip
            formatter={(v) => [`${v}%`, 'Win Prob']}
            labelFormatter={(l) => `Minute ${l}`}
          />
          {QUARTER_LINES.map((min) => (
            <ReferenceLine
              key={min}
              x={min}
              stroke="#ccc"
              strokeDasharray="4 2"
              label={{ value: `Q${min / 12 + 1}`, position: 'top', fontSize: 10, fill: '#999' }}
            />
          ))}
          <ReferenceLine y={50} stroke="#ddd" strokeDasharray="4 2" />
          <Line
            type="monotone"
            dataKey="prob"
            stroke={color}
            strokeWidth={2.5}
            dot={false}
            activeDot={{ r: 4 }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export default function PlayEditor() {
  const [selectedOutcomes, setSelectedOutcomes] = useState(
    Object.fromEntries(plays.map((p) => [p.id, p.outcomes[0]]))
  );

  const whatIfCurve = (() => {
    for (let i = plays.length - 1; i >= 0; i--) {
      const play = plays[i];
      const selected = selectedOutcomes[play.id];
      if (selected !== play.outcomes[0]) {
        return play.whatIfCurves[selected];
      }
    }
    return originalCurve;
  })();

  function handleOutcomeChange(playId, outcome) {
    setSelectedOutcomes((prev) => ({ ...prev, [playId]: outcome }));
  }

  return (
    <div>
      <div style={styles.chartsRow}>
        <WinProbChart data={originalCurve} title="Original" color="#2563eb" />
        <WinProbChart data={whatIfCurve} title="What If Scenario" color="#dc2626" />
      </div>
      <div style={styles.playList}>
        <h3 style={styles.playListTitle}>Edit a Play</h3>
        {plays.map((play) => (
          <div key={play.id} style={styles.playRow}>
            <span style={styles.playTime}>{play.time}</span>
            <span style={styles.playDesc}>{play.description}</span>
            <select
              value={selectedOutcomes[play.id]}
              onChange={(e) => handleOutcomeChange(play.id, e.target.value)}
              style={styles.select}
            >
              {play.outcomes.map((outcome) => (
                <option key={outcome} value={outcome}>
                  {outcome}
                </option>
              ))}
            </select>
          </div>
        ))}
      </div>
    </div>
  );
}

const styles = {
  chartsRow: {
    display: 'flex',
    gap: '16px',
    marginBottom: '32px',
  },
  chartPanel: {
    flex: 1,
    background: '#fff',
    borderRadius: '8px',
    padding: '16px',
    boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
  },
  chartTitle: {
    fontSize: '15px',
    fontWeight: '600',
    marginBottom: '12px',
    color: '#1a1a1a',
  },
  playList: {
    background: '#fff',
    borderRadius: '8px',
    padding: '20px',
    boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
  },
  playListTitle: {
    fontSize: '15px',
    fontWeight: '600',
    marginBottom: '16px',
    color: '#1a1a1a',
  },
  playRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    padding: '10px 0',
    borderBottom: '1px solid #f0f0f0',
  },
  playTime: {
    fontSize: '12px',
    fontWeight: '600',
    color: '#666',
    minWidth: '70px',
  },
  playDesc: {
    flex: 1,
    fontSize: '14px',
    color: '#1a1a1a',
  },
  select: {
    padding: '6px 10px',
    borderRadius: '6px',
    border: '1px solid #d0d0d0',
    fontSize: '13px',
    cursor: 'pointer',
    background: '#fafafa',
  },
};
