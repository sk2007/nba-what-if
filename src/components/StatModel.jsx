import { useState } from 'react';
import { sliderConfig, calcWinProb, defaultValues } from '../data/statModel';

export default function StatModel({ season, seasonType }) {
  const [values, setValues] = useState(defaultValues());

  const winProb = calcWinProb(values);

  function handleChange(key, value) {
    setValues((prev) => ({ ...prev, [key]: Number(value) }));
  }

  const probColor = winProb >= 60 ? '#16a34a' : winProb <= 40 ? '#dc2626' : '#2563eb';

  return (
    <div style={styles.panel}>
      <div style={styles.slidersSection}>
        <h3 style={styles.sectionTitle}>Team Stats</h3>
        {sliderConfig.map((config) => (
          <div key={config.key} style={styles.sliderRow}>
            <div style={styles.sliderLabelRow}>
              <span style={styles.sliderLabel}>{config.label}</span>
              <span style={styles.sliderValue}>
                {values[config.key]}{config.unit}
              </span>
            </div>
            <input
              type="range"
              min={config.min}
              max={config.max}
              value={values[config.key]}
              onChange={(e) => handleChange(config.key, e.target.value)}
              style={styles.slider}
            />
            <div style={styles.sliderRange}>
              <span>{config.min}{config.unit}</span>
              <span>{config.max}{config.unit}</span>
            </div>
          </div>
        ))}
      </div>

      <div style={styles.resultSection}>
        <p style={styles.resultLabel}>Estimated Win Probability</p>
        <p style={{ ...styles.resultProb, color: probColor }}>{winProb}%</p>
        <p style={styles.resultSub}>based on stat thresholds</p>
      </div>
    </div>
  );
}

const styles = {
  panel: {
    display: 'flex',
    gap: '32px',
    background: '#fff',
    borderRadius: '8px',
    padding: '28px',
    boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
  },
  slidersSection: {
    flex: 1,
  },
  sectionTitle: {
    fontSize: '15px',
    fontWeight: '600',
    marginBottom: '20px',
    color: '#1a1a1a',
  },
  sliderRow: {
    marginBottom: '20px',
  },
  sliderLabelRow: {
    display: 'flex',
    justifyContent: 'space-between',
    marginBottom: '6px',
  },
  sliderLabel: {
    fontSize: '14px',
    color: '#1a1a1a',
  },
  sliderValue: {
    fontSize: '14px',
    fontWeight: '600',
    color: '#2563eb',
  },
  slider: {
    width: '100%',
    cursor: 'pointer',
    accentColor: '#2563eb',
  },
  sliderRange: {
    display: 'flex',
    justifyContent: 'space-between',
    fontSize: '11px',
    color: '#999',
    marginTop: '2px',
  },
  resultSection: {
    width: '200px',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    borderLeft: '1px solid #f0f0f0',
    paddingLeft: '32px',
  },
  resultLabel: {
    fontSize: '13px',
    color: '#666',
    textAlign: 'center',
    marginBottom: '12px',
  },
  resultProb: {
    fontSize: '64px',
    fontWeight: '700',
    lineHeight: 1,
    marginBottom: '8px',
  },
  resultSub: {
    fontSize: '12px',
    color: '#999',
    textAlign: 'center',
  },
};
