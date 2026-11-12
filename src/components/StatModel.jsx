import { useState, useEffect, useRef } from 'react';
import { sliderConfig } from '../data/statModel';
import { fetchWinProb } from '../api/nbaApi';

function defaultValues() {
  return Object.fromEntries(sliderConfig.map((c) => [c.key, c.default]));
}

export default function StatModel({ season, seasonType }) {
  const [values, setValues] = useState(defaultValues());
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const debounceRef = useRef(null);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setLoading(true);
      setError(null);
      fetchWinProb({ season, seasonType, ...values })
        .then((data) => { setResult(data); setLoading(false); })
        .catch((e) => { setError(e.message); setLoading(false); });
    }, 300);
    return () => clearTimeout(debounceRef.current);
  }, [values, season, seasonType]);

  function handleChange(key, value) {
    setValues((prev) => ({ ...prev, [key]: Number(value) }));
  }

  const winRate = result?.winRate ?? null;
  const probColor = winRate === null ? 'var(--text-secondary)' : winRate >= 60 ? 'var(--success)' : winRate <= 40 ? 'var(--error)' : 'var(--electric-blue)';
  const displayProb = winRate !== null ? `${winRate}%` : '—';

  return (
    <div style={styles.panel}>
      <div style={styles.slidersSection}>
        <h3 style={styles.sectionTitle}>Team Stats</h3>
        {sliderConfig.map((config) => (
          <div key={config.key} style={styles.sliderRow}>
            <div style={styles.sliderLabelRow}>
              <span style={styles.sliderLabel}>{config.label}</span>
              <span style={styles.sliderValue}>{values[config.key]}{config.unit}</span>
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
        <p style={styles.resultLabel}>Win Probability</p>
        <p style={{ ...styles.resultProb, color: probColor, opacity: loading ? 0.4 : 1 }}>
          {displayProb}
        </p>
        {error && <p style={styles.errorText}>Error: {error}</p>}
        {!error && result && (
          <p style={styles.resultSub}>logistic regression model</p>
        )}
        {!error && !result && !loading && (
          <p style={styles.resultSub}>logistic regression model</p>
        )}
      </div>
    </div>
  );
}

const styles = {
  panel: { display: 'flex', gap: '32px', background: 'var(--surface)', borderRadius: '8px', padding: '28px', boxShadow: '0 1px 3px rgba(0,0,0,0.08)' },
  slidersSection: { flex: 1 },
  sectionTitle: { fontFamily: 'var(--font-heading)', fontSize: '15px', fontWeight: '600', marginBottom: '20px', color: 'var(--text-primary)' },
  sliderRow: { marginBottom: '20px' },
  sliderLabelRow: { display: 'flex', justifyContent: 'space-between', marginBottom: '6px' },
  sliderLabel: { fontSize: '14px', color: 'var(--text-primary)' },
  sliderValue: { fontSize: '14px', fontWeight: '600', color: 'var(--electric-blue)' },
  slider: { width: '100%', cursor: 'pointer', accentColor: 'var(--electric-blue)' },
  sliderRange: { display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: 'var(--text-secondary)', marginTop: '2px' },
  resultSection: { width: '200px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', borderLeft: '1px solid var(--line)', paddingLeft: '32px' },
  resultLabel: { fontSize: '13px', color: 'var(--text-secondary)', textAlign: 'center', marginBottom: '12px' },
  resultProb: { fontSize: '64px', fontWeight: '700', lineHeight: 1, marginBottom: '8px', transition: 'color 0.2s, opacity 0.2s' },
  resultSub: { fontSize: '12px', color: 'var(--text-secondary)', textAlign: 'center' },
  errorText: { fontSize: '11px', color: 'var(--error)', textAlign: 'center', marginBottom: '4px' },
};
