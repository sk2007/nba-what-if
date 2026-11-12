import { useEffect, useId, useState } from 'react';
import { fetchSeasons } from '../api/nbaApi';

export default function SeasonSelector({ season, onSeasonChange, seasonType, onSeasonTypeChange }) {
  const inputId = useId();
  const [seasons, setSeasons] = useState([]);
  const [seasonTypes, setSeasonTypes] = useState([]);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetchSeasons()
      .then((data) => {
        setSeasons(data.seasons);
        setSeasonTypes(data.seasonTypes ?? []);
      })
      .catch((e) => setError(e.message));
  }, []);

  if (error) return <p style={{ color: 'var(--error)', fontSize: 13 }}>Failed to load seasons: {error}</p>;

  return (
    <div className="season-controls" style={styles.row}>
      <div style={styles.group}>
        <label style={styles.label} htmlFor={`${inputId}-season`}>Season</label>
        <select id={`${inputId}-season`} className="app-select" value={season} onChange={(e) => onSeasonChange(e.target.value)} style={styles.select}>
          {seasons.map((s) => (
            <option key={s.id} value={s.id}>{s.label}</option>
          ))}
        </select>
      </div>
      {seasonType && onSeasonTypeChange && (
        <div style={styles.group}>
          <label style={styles.label} htmlFor={`${inputId}-type`}>Competition</label>
          <select id={`${inputId}-type`} className="app-select" value={seasonType} onChange={(e) => onSeasonTypeChange(e.target.value)} style={styles.select}>
            {seasonTypes.map((type) => (
              <option key={type} value={type}>{type}</option>
            ))}
          </select>
        </div>
      )}
    </div>
  );
}

const styles = {
  row: { display: 'flex', gap: '16px', alignItems: 'flex-end', marginBottom: '20px', flexWrap: 'wrap' },
  group: { display: 'flex', flexDirection: 'column', gap: '4px' },
  label: { fontSize: '11px', fontWeight: '600', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em' },
  select: { padding: '7px 10px', borderRadius: '6px', border: '1px solid var(--line)', fontSize: '13px', cursor: 'pointer', background: 'var(--surface-soft)' },
};
