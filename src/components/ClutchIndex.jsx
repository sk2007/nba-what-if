import { useId, useState } from 'react';
import Spinner from './Spinner';

async function fetchClutch(season, seasonType, team) {
  const params = new URLSearchParams({ season, season_type: seasonType, team });
  const res = await fetch(`/api/clutch?${params}`);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `HTTP ${res.status}`);
  }
  return res.json();
}

const SORT_OPTIONS = [
  { key: 'wpAdded', label: 'Total WP Added' },
  { key: 'avgWpAdded', label: 'Avg WP / Play' },
  { key: 'plays', label: 'Crunch Plays' },
];

function Bar({ value, max, color }) {
  const pct = max === 0 ? 0 : Math.max(0, (value / max)) * 100;
  return (
    <div style={barStyles.track}>
      <div style={{ ...barStyles.fill, width: `${Math.min(pct, 100)}%`, background: color }} />
    </div>
  );
}

const barStyles = {
  track: { height: '6px', background: '#f0f0f0', borderRadius: '3px', flex: 1 },
  fill: { height: '100%', borderRadius: '3px', transition: 'width 0.3s' },
};

export default function ClutchIndex({ season, seasonType, games }) {
  const [team, setTeam] = useState('');
  const [teamInput, setTeamInput] = useState('');
  const [players, setPlayers] = useState([]);
  const [gamesAnalyzed, setGamesAnalyzed] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [sortKey, setSortKey] = useState('wpAdded');
  const [activeSuggestion, setActiveSuggestion] = useState(-1);
  const teamInputId = useId();
  const teamListId = useId();

  // Unique team names from the games list for autocomplete
  const teamNames = [...new Set(games.flatMap((g) => [g.teamA, g.teamB]))].sort();
  const suggestions = teamInput.trim()
    ? teamNames.filter((t) => t.toLowerCase().includes(teamInput.trim().toLowerCase()))
    : [];

  function handleSelectTeam(name) {
    setTeamInput(name);
    setTeam(name);
    setActiveSuggestion(-1);
  }

  function handleTeamKeyDown(e) {
    if (!suggestions.length) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveSuggestion((current) => Math.min(current + 1, Math.min(suggestions.length, 6) - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveSuggestion((current) => Math.max(current - 1, 0));
    } else if (e.key === 'Enter' && activeSuggestion >= 0) {
      e.preventDefault();
      handleSelectTeam(suggestions[activeSuggestion]);
    } else if (e.key === 'Escape') {
      setActiveSuggestion(-1);
    }
  }

  async function handleLoad() {
    if (!team) return;
    setLoading(true);
    setError(null);
    setPlayers([]);
    try {
      const data = await fetchClutch(season, seasonType, team);
      setPlayers(data.players ?? []);
      setGamesAnalyzed(data.gamesAnalyzed ?? 0);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  const sorted = [...players].sort((a, b) => {
    if (sortKey === 'avgWpAdded') return b.avgWpAdded - a.avgWpAdded;
    if (sortKey === 'plays') return b.plays - a.plays;
    return b.wpAdded - a.wpAdded;
  });

  const maxWpAdded = Math.max(...sorted.map((p) => Math.abs(p.wpAdded)), 1);
  return (
    <div>
      <div className="mobile-stack" style={styles.controlRow}>
        <div className="mobile-full" style={styles.teamGroup}>
          <label style={styles.label} htmlFor={teamInputId}>Team</label>
          <div style={styles.autocompleteWrapper}>
            <input
              id={teamInputId}
              className="mobile-full"
              type="text"
              placeholder="e.g. Oklahoma City Thunder"
              value={teamInput}
              onChange={(e) => { setTeamInput(e.target.value); setTeam(''); setActiveSuggestion(-1); }}
              onKeyDown={handleTeamKeyDown}
              style={styles.input}
              role="combobox"
              aria-autocomplete="list"
              aria-controls={teamListId}
              aria-expanded={suggestions.length > 0 && Boolean(teamInput) && !team}
              aria-activedescendant={activeSuggestion >= 0 ? `${teamListId}-${activeSuggestion}` : undefined}
            />
            {suggestions.length > 0 && teamInput && !team && (
              <div id={teamListId} role="listbox" style={styles.suggestions}>
                {suggestions.slice(0, 6).map((t, index) => (
                  <div
                    id={`${teamListId}-${index}`}
                    key={t}
                    role="option"
                    aria-selected={activeSuggestion === index}
                    tabIndex={0}
                    style={{ ...styles.suggestion, ...(activeSuggestion === index ? styles.suggestionActive : {}) }}
                    onMouseEnter={() => setActiveSuggestion(index)}
                    onClick={() => handleSelectTeam(t)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') handleSelectTeam(t);
                    }}
                  >
                    {t}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
        <button
          className="mobile-full"
          onClick={handleLoad}
          style={{ ...styles.loadBtn, opacity: (!team || loading) ? 0.5 : 1 }}
          disabled={!team || loading}
        >
          {loading ? 'Loading…' : 'Load'}
        </button>
      </div>

      {error && <p style={styles.error}>Error: {error}</p>}

      {loading && (
        <Spinner
          message={`Analyzing crunch-time plays across ${gamesAnalyzed || 'this season\'s'} games…`}
          hint="This may take a moment if games aren't cached yet."
        />
      )}

      {!loading && players.length > 0 && (
        <>
          <div style={styles.meta}>
            {gamesAnalyzed} games analyzed · Q4/OT, ≤5 min, within 5 pts · min. 5 crunch plays
          </div>

          <div style={styles.sortRow}>
            <span style={styles.label}>Sort by</span>
            {SORT_OPTIONS.map((o) => (
              <button
                key={o.key}
                onClick={() => setSortKey(o.key)}
                style={{ ...styles.sortBtn, ...(sortKey === o.key ? styles.sortBtnActive : {}) }}
              >
                {o.label}
              </button>
            ))}
          </div>

          <div className="responsive-scroll surface-card" style={styles.table}>
            <div className="responsive-table">
            <div style={styles.tableHeader}>
              <span style={{ width: 28 }}>#</span>
              <span style={{ flex: 1 }}>Player</span>
              <span style={{ width: 90, textAlign: 'right' }}>Total WP+</span>
              <span style={{ width: 90, textAlign: 'right' }}>Avg / Play</span>
              <span style={{ width: 60, textAlign: 'right' }}>Plays</span>
              <span style={{ width: 60, textAlign: 'right' }}>Games</span>
            </div>
            {sorted.map((p, i) => {
              const isPositive = p.wpAdded >= 0;
              const color = isPositive ? '#16a34a' : '#dc2626';
              return (
                <div className="table-row-interactive" key={p.player} style={styles.tableRow}>
                  <span style={styles.rank}>{i + 1}</span>
                  <span style={styles.playerCell}>
                    <span style={styles.playerName}>{p.player}</span>
                    <Bar
                      value={Math.abs(p.wpAdded)}
                      max={maxWpAdded}
                      color={color}
                    />
                  </span>
                  <span style={{ width: 90, textAlign: 'right', fontWeight: '700', color, fontSize: '13px' }}>
                    {p.wpAdded > 0 ? '+' : ''}{p.wpAdded}%
                  </span>
                  <span style={{ width: 90, textAlign: 'right', fontSize: '12px', color: p.avgWpAdded >= 0 ? '#16a34a' : '#dc2626' }}>
                    {p.avgWpAdded > 0 ? '+' : ''}{p.avgWpAdded}%
                  </span>
                  <span style={{ width: 60, textAlign: 'right', fontSize: '12px', color: '#666' }}>{p.plays}</span>
                  <span style={{ width: 60, textAlign: 'right', fontSize: '12px', color: '#999' }}>{p.games}</span>
                </div>
              );
            })}
            </div>
          </div>

          {sorted.length === 0 && (
            <p style={styles.empty}>No players with enough crunch-time data for this team.</p>
          )}
        </>
      )}

      {!loading && !error && players.length === 0 && gamesAnalyzed === 0 && (
        <div className="surface-card" style={styles.emptyState}>
          <strong style={styles.emptyTitle}>Find a team’s clutch leaders</strong>
          <p style={styles.hint}>
            {team
              ? 'Click Load to analyze crunch-time performance for the selected team.'
              : 'Start typing a team name, choose a suggestion, and load its crunch-time performance.'}
          </p>
        </div>
      )}

      {!loading && !error && players.length === 0 && gamesAnalyzed > 0 && (
        <div className="surface-card" style={styles.emptyState}>
          <strong style={styles.emptyTitle}>No qualifying players found</strong>
          <p style={styles.hint}>This team does not have enough crunch-time data for the current season filter.</p>
        </div>
      )}
    </div>
  );
}

const styles = {
  controlRow: { display: 'flex', alignItems: 'flex-end', gap: '12px', marginBottom: '16px', flexWrap: 'wrap' },
  teamGroup: { display: 'flex', flexDirection: 'column', gap: '4px', position: 'relative' },
  label: { fontSize: '11px', fontWeight: '600', color: '#888', textTransform: 'uppercase', letterSpacing: '0.05em' },
  autocompleteWrapper: { position: 'relative' },
  input: { padding: '7px 10px', borderRadius: '6px', border: '1px solid #d0d0d0', fontSize: '13px', background: '#fafafa', width: '260px', outline: 'none' },
  suggestions: { position: 'absolute', top: '100%', left: 0, right: 0, background: '#fff', border: '1px solid #e0e0e0', borderRadius: '6px', boxShadow: '0 4px 12px rgba(0,0,0,0.1)', zIndex: 10, marginTop: '2px' },
  suggestion: { padding: '7px 12px', fontSize: '13px', cursor: 'pointer', color: '#1a1a1a', borderBottom: '1px solid #f5f5f5' },
  suggestionActive: { background: '#eff6ff', color: '#1d4ed8' },
  loadBtn: { padding: '7px 18px', borderRadius: '6px', border: 'none', background: '#1a1a1a', color: '#fff', fontSize: '13px', fontWeight: '600', cursor: 'pointer', alignSelf: 'flex-end' },
  error: { color: '#dc2626', fontSize: '13px', margin: '8px 0' },
  loadingBox: { textAlign: 'center', padding: '40px 0' },
  loadingText: { color: '#555', fontSize: '14px', marginBottom: '6px' },
  loadingHint: { color: '#aaa', fontSize: '12px' },
  meta: { fontSize: '11px', color: '#999', marginBottom: '12px' },
  sortRow: { display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '10px', flexWrap: 'wrap' },
  sortBtn: { padding: '4px 10px', borderRadius: '4px', border: '1px solid #e0e0e0', background: '#fafafa', fontSize: '12px', cursor: 'pointer', color: '#555' },
  sortBtnActive: { background: '#1a1a1a', color: '#fff', border: '1px solid #1a1a1a' },
  table: { background: '#fff', borderRadius: '8px', boxShadow: '0 1px 3px rgba(0,0,0,0.08)', overflow: 'hidden' },
  tableHeader: { display: 'flex', gap: '8px', padding: '8px 16px', background: '#f5f5f5', fontSize: '11px', fontWeight: '600', color: '#888', textTransform: 'uppercase', letterSpacing: '0.04em' },
  tableRow: { display: 'flex', gap: '8px', alignItems: 'center', padding: '10px 16px', borderBottom: '1px solid #f5f5f5' },
  rank: { width: 28, fontSize: '11px', fontWeight: '700', color: '#bbb' },
  playerCell: { flex: 1, display: 'flex', flexDirection: 'column', gap: '4px', overflow: 'hidden' },
  playerName: { fontSize: '13px', fontWeight: '600', color: '#1a1a1a', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
  emptyState: { maxWidth: '560px', marginTop: '12px', padding: '26px', borderRadius: '10px', background: '#fff', textAlign: 'center' },
  emptyTitle: { display: 'block', color: '#334155', fontSize: '14px', marginBottom: '7px' },
  hint: { color: '#94a3b8', fontSize: '13px', lineHeight: 1.55 },
  empty: { color: '#aaa', fontSize: '13px', textAlign: 'center', padding: '24px 0' },
};
