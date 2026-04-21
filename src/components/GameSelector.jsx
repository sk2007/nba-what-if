import { useEffect, useState } from 'react';
import { fetchGames } from '../api/nbaApi';

export default function GameSelector({ season, seasonType, gameId, onGameChange }) {
  const [games, setGames] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!season || !seasonType) return;
    setLoading(true);
    setError(null);
    fetchGames(season, seasonType)
      .then((data) => {
        setGames(data.games);
        if (data.games.length > 0 && !gameId) {
          onGameChange(data.games[0].gameId);
        }
        setLoading(false);
      })
      .catch((e) => {
        setError(e.message);
        setLoading(false);
      });
  }, [season, seasonType]);

  if (error) return <p style={{ color: '#dc2626', fontSize: 13 }}>Failed to load games: {error}</p>;

  return (
    <div style={styles.group}>
      <label style={styles.label}>Game</label>
      <select
        value={gameId || ''}
        onChange={(e) => onGameChange(e.target.value)}
        style={styles.select}
        disabled={loading || games.length === 0}
      >
        {loading && <option>Loading games…</option>}
        {games.map((g) => (
          <option key={g.gameId} value={g.gameId}>
            {g.teamA} vs {g.teamB} — {g.date} ({g.finalScoreA}–{g.finalScoreB})
          </option>
        ))}
      </select>
    </div>
  );
}

const styles = {
  group: { display: 'flex', flexDirection: 'column', gap: '4px' },
  label: { fontSize: '11px', fontWeight: '600', color: '#888', textTransform: 'uppercase', letterSpacing: '0.05em' },
  select: { padding: '7px 10px', borderRadius: '6px', border: '1px solid #d0d0d0', fontSize: '13px', cursor: 'pointer', background: '#fafafa', minWidth: '340px' },
};
