import math


def win_prob(score_diff, seconds_remaining, total_seconds=2880):
    """
    Returns win probability (0-100 integer) for the team with score_diff advantage.
    score_diff: teamA_score - teamB_score
    seconds_remaining: seconds left in game (0 = end)
    total_seconds: total regulation seconds (2880 = 48 min)
    """
    k = 0.004 * (1 + (total_seconds - seconds_remaining) / total_seconds)
    p = 1 / (1 + math.exp(-k * score_diff * 100))
    return round(p * 100)


def compute_wp_curve(plays):
    """
    Given a list of play dicts (each with gameSeconds, scoreA, scoreB),
    returns a list of { gameSeconds, wp } dicts — one per play plus a
    starting point at gameSeconds=0, wp=50.
    """
    curve = [{"gameSeconds": 0, "wp": 50}]
    total_seconds = _total_seconds_for_plays(plays)
    for play in plays:
        elapsed = play["gameSeconds"]
        remaining = max(0, total_seconds - elapsed)
        diff = play["scoreA"] - play["scoreB"]
        curve.append({
            "gameSeconds": elapsed,
            "wp": win_prob(diff, remaining, total_seconds),
        })
    return curve


def _total_seconds_for_plays(plays):
    """Regulation is 2880s; extend by 300s per OT period detected."""
    if not plays:
        return 2880
    max_quarter = max(p.get("quarter", 4) for p in plays)
    if max_quarter <= 4:
        return 2880
    return 2880 + (max_quarter - 4) * 300
