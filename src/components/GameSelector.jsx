import { useEffect, useState } from 'react';
import { fetchGames } from '../api/nbaApi';

function teamMatches(teamName, term) {
  if (!term.trim()) return true;
  const t = teamName.toLowerCase();
  const q = term.trim().toLowerCase();
  return t.includes(q) || t.split(' ').some((w) => w.startsWith(q));
}

export default function GameSelector({ season, seasonType, gameId, onGameChange }) {
  const [games, setGames] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [team1, setTeam1] = useState('');
  const [team2, setTeam2] = useState('');

  useEffect(() => {
    if (!season || !seasonType) return;
    setLoading(true);
    setError(null);
    setTeam1('');
    setTeam2('');
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

  const filtered = games.filter((g) => {
    const t1A = teamMatches(g.teamA, team1), t1B = teamMatches(g.teamB, team1);
    const t2A = teamMatches(g.teamA, team2), t2B = teamMatches(g.teamB, team2);
    return (t1A && t2B) || (t1B && t2A);
  });

  useEffect(() => {
    if (!filtered.length) return;
    if (!filtered.find((g) => g.gameId === gameId)) {
      onGameChange(filtered[0].gameId);
    }
  }, [team1, team2]);

  if (error) return <p style={{ color: '#dc2626', fontSize: 13 }}>Failed to load games: {error}</p>;

  const hasFilter = team1.trim() || team2.trim();
  const matchLabel = hasFilter
    ? filtered.length > 0 ? `${filtered.length} game${filtered.length > 1 ? 's' : ''}` : 'no matches'
    : '';

  return (
    <div style={styles.wrapper}>
      <div style={styles.group}>
        <label style={styles.label}>Team 1</label>
        <input
          type="text"
          placeholder="e.g. Thunder"
          value={team1}
          onChange={(e) => setTeam1(e.target.value)}
          style={styles.input}
          disabled={loading || games.length === 0}
        />
      </div>
      <div style={styles.vsLabel}>vs</div>
      <div style={styles.group}>
        <label style={styles.label}>Team 2</label>
        <input
          type="text"
          placeholder="e.g. Pacers"
          value={team2}
          onChange={(e) => setTeam2(e.target.value)}
          style={styles.input}
          disabled={loading || games.length === 0}
        />
      </div>
      <div style={styles.group}>
        <label style={styles.label}>Game{matchLabel ? ` — ${matchLabel}` : ''}</label>
        <select
          value={gameId || ''}
          onChange={(e) => onGameChange(e.target.value)}
          style={styles.select}
          disabled={loading || filtered.length === 0}
        >
          {loading && <option>Loading games…</option>}
          {filtered.map((g) => (
            <option key={g.gameId} value={g.gameId}>
              {g.teamA} vs {g.teamB} — {g.date} ({g.finalScoreA}–{g.finalScoreB})
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}

const styles = {
  wrapper: { display: 'flex', gap: '12px', alignItems: 'flex-end', flexWrap: 'wrap' },
  group: { display: 'flex', flexDirection: 'column', gap: '4px' },
  label: { fontSize: '11px', fontWeight: '600', color: '#888', textTransform: 'uppercase', letterSpacing: '0.05em' },
  input: { padding: '7px 10px', borderRadius: '6px', border: '1px solid #d0d0d0', fontSize: '13px', background: '#fafafa', width: '150px', outline: 'none' },
  select: { padding: '7px 10px', borderRadius: '6px', border: '1px solid #d0d0d0', fontSize: '13px', cursor: 'pointer', background: '#fafafa', minWidth: '320px' },
  vsLabel: { fontSize: '13px', color: '#999', paddingBottom: '8px' },
};
