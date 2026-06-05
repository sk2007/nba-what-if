import { useEffect, useState } from 'react';
import { fetchSeasons } from '../api/nbaApi';

export default function SeasonSelector({ season, onSeasonChange, seasonType, onSeasonTypeChange }) {
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

  if (error) return <p style={{ color: '#dc2626', fontSize: 13 }}>Failed to load seasons: {error}</p>;

  return (
    <div style={styles.row}>
      <div style={styles.group}>
        <label style={styles.label}>Season</label>
        <select className="app-select" value={season} onChange={(e) => onSeasonChange(e.target.value)} style={styles.select}>
          {seasons.map((s) => (
            <option key={s.id} value={s.id}>{s.label}</option>
          ))}
        </select>
      </div>
      {seasonType && onSeasonTypeChange && (
        <div style={styles.group}>
          <label style={styles.label}>Type</label>
          <select className="app-select" value={seasonType} onChange={(e) => onSeasonTypeChange(e.target.value)} style={styles.select}>
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
  label: { fontSize: '11px', fontWeight: '600', color: '#888', textTransform: 'uppercase', letterSpacing: '0.05em' },
  select: { padding: '7px 10px', borderRadius: '6px', border: '1px solid #d0d0d0', fontSize: '13px', cursor: 'pointer', background: '#fafafa' },
};
