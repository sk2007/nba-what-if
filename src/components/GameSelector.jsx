import { useEffect, useEffectEvent, useId, useMemo, useState } from 'react';
import { fetchGames } from '../api/nbaApi';

function teamMatches(teamName, term) {
  if (!term.trim()) return true;
  const t = teamName.toLowerCase();
  const q = term.trim().toLowerCase();
  return t.includes(q) || t.split(' ').some((w) => w.startsWith(q));
}

export default function GameSelector({
  season,
  seasonType,
  gameId,
  onGameChange
}) {
  return (
    <SeasonGames
      key={`${season}:${seasonType}`}
      {...{ season, seasonType, gameId, onGameChange }}
    />
  );
}

function SeasonGames({ season, seasonType, gameId, onGameChange }) {
  const inputId = useId();
  const [games, setGames] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [team1, setTeam1] = useState('');
  const [team2, setTeam2] = useState('');
  const [date, setDate] = useState('');
  const [visibleCount, setVisibleCount] = useState(60);
  const [reload, setReload] = useState(0);
  const selectGame = useEffectEvent(onGameChange);

  useEffect(() => {
    if (!season || !seasonType) return;
    let active = true;
    fetchGames(season, seasonType)
      .then((data) => {
        if (!active) return;
        setGames(data.games ?? []);
        setLoading(false);
      })
      .catch((e) => {
        if (!active) return;
        setError(e.message);
        setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [season, seasonType, reload]);

  const filtered = useMemo(
    () =>
      games.filter((g) => {
        const t1A = teamMatches(g.teamA, team1),
          t1B = teamMatches(g.teamB, team1);
        const t2A = teamMatches(g.teamA, team2),
          t2B = teamMatches(g.teamB, team2);
        return ((t1A && t2B) || (t1B && t2A)) && (!date || g.date === date);
      }),
    [games, team1, team2, date]
  );

  useEffect(() => {
    if (!games.length) return;
    if (!games.some((game) => game.gameId === gameId))
      selectGame(games[0].gameId);
  }, [games, gameId]);

  function refreshGames() {
    setLoading(true);
    setError(null);
    setGames([]);
    setReload((value) => value + 1);
  }

  const hasFilter = team1.trim() || team2.trim() || date;
  const matchLabel = hasFilter
    ? filtered.length > 0
      ? `${filtered.length} game${filtered.length > 1 ? 's' : ''}`
      : 'no matches'
    : `${games.length} game${games.length === 1 ? '' : 's'}`;

  return (
    <div className="game-browser">
      <div className="game-browser-heading">
        <div>
          <p className="studio-eyebrow">Game library</p>
          <h2>Find your game</h2>
        </div>
        <button
          type="button"
          className="studio-icon-button"
          aria-label={error ? 'Retry loading games' : 'Refresh games'}
          disabled={loading}
          onClick={refreshGames}
        >
          ↻
        </button>
      </div>
      <label className="studio-field" htmlFor={`${inputId}-team-1`}>
        Team or matchup
        <input
          id={`${inputId}-team-1`}
          type="search"
          placeholder="Search a team…"
          value={team1}
          onChange={(e) => {
            setTeam1(e.target.value);
            setVisibleCount(60);
          }}
          disabled={loading || games.length === 0}
        />
      </label>
      <details className="game-browser-filters">
        <summary>Matchup filters{team2 || date ? ' · Active' : ''}</summary>
        <label className="studio-field" htmlFor={`${inputId}-team-2`}>
          Opponent
          <input
            id={`${inputId}-team-2`}
            type="search"
            placeholder="Any opponent"
            value={team2}
            onChange={(e) => {
              setTeam2(e.target.value);
              setVisibleCount(60);
            }}
            disabled={loading || games.length === 0}
          />
        </label>
        <label className="studio-field" htmlFor={`${inputId}-date`}>
          Game date
          <input
            id={`${inputId}-date`}
            type="date"
            value={date}
            onChange={(e) => {
              setDate(e.target.value);
              setVisibleCount(60);
            }}
          />
        </label>
      </details>
      <div className="game-browser-count" role="status">
        {loading
          ? `Loading ${season} games…`
          : error
            ? 'Games unavailable'
            : `${matchLabel} · ${season}`}
      </div>
      {error && (
        <div className="studio-empty studio-error" role="alert">
          <strong>We couldn’t load this season.</strong>
          <p>
            NBA data is temporarily unavailable. Your season selection is saved.
          </p>
          <button className="studio-button" onClick={refreshGames}>
            Try again
          </button>
          <details>
            <summary>Error details</summary>
            <p>{error}</p>
          </details>
        </div>
      )}
      {loading && (
        <div className="game-browser-skeleton" aria-hidden="true">
          {[1, 2, 3, 4].map((n) => (
            <div key={n}>
              <span />
              <span />
            </div>
          ))}
        </div>
      )}
      {!loading && !error && (
        <div className="game-browser-list" aria-label="Available games">
          {filtered.slice(0, visibleCount).map((g) => (
            <button
              key={g.gameId}
              className="game-browser-item"
              aria-pressed={gameId === g.gameId}
              onClick={() => onGameChange(g.gameId)}
            >
              <span className="game-browser-date">
                {new Date(`${g.date}T12:00:00`).toLocaleDateString('en-US', {
                  month: 'short',
                  day: 'numeric',
                  year: 'numeric'
                })}
                <span>Final</span>
              </span>
              <span className="game-browser-team">
                <span>{g.teamB}</span>
                <b>{g.finalScoreB}</b>
              </span>
              <span className="game-browser-team">
                <span>{g.teamA}</span>
                <b>{g.finalScoreA}</b>
              </span>
            </button>
          ))}
          {filtered.length > visibleCount && (
            <button
              className="studio-button"
              onClick={() => setVisibleCount((count) => count + 60)}
            >
              Show more games ({filtered.length - visibleCount} remaining)
            </button>
          )}
          {filtered.length === 0 && (
            <div className="studio-empty">
              <strong>
                {hasFilter ? 'No matching games' : 'No completed games yet'}
              </strong>
              <p>
                {hasFilter
                  ? 'Try another team or clear your filters.'
                  : 'Completed games will appear here when NBA data is available.'}
              </p>
              {hasFilter && (
                <button
                  className="studio-button"
                  onClick={() => {
                    setTeam1('');
                    setTeam2('');
                    setDate('');
                  }}
                >
                  Clear filters
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
