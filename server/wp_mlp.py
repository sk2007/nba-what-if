import os
import numpy as np

_DIR = os.path.dirname(os.path.dirname(__file__))
_ONNX_PATH = os.path.join(_DIR, 'wp_model_mlp.onnx')
_STATS_PATH = os.path.join(_DIR, 'wp_model_stats.npz')

# Numeric feature order must match pipeline training order
_NUM_COLS = [
    'periodSecondsLeft', 'secondsLeft', 'scoreDif', 'scoreTimePressure',
    'pointsTotal', 'possession', 'homeFouls', 'awayFouls', 'homeBonus',
    'awayBonus', 'homeFreeThrows', 'awayFreeThrows', 'homeEjections',
    'awayEjections', 'line',
]
# OHE categories for 'quarter' in sklearn fit order
_QUARTER_CATS = ['OT', 'Q1', 'Q2', 'Q3', 'Q4']

_session = None
_num_mean = None
_num_std = None
_available = None  # None = not yet attempted


def _load():
    import onnxruntime as ort
    stats = np.load(_STATS_PATH)
    num_mean = stats['num_mean'].astype(np.float32)
    num_std = stats['num_std'].astype(np.float32)
    session = ort.InferenceSession(_ONNX_PATH, providers=['CPUExecutionProvider'])
    return session, num_mean, num_std


def _ensure_loaded():
    global _session, _num_mean, _num_std, _available
    if _available is not None:
        return
    try:
        _session, _num_mean, _num_std = _load()
        _available = True
    except Exception:
        _available = False


def _transform(row_dict):
    """Replaces sklearn pipeline: passthrough numerics + OHE quarter."""
    nums = np.array([[row_dict[c] for c in _NUM_COLS]], dtype=np.float32)
    q = row_dict.get('quarter', 'Q4')
    ohe = np.zeros((1, len(_QUARTER_CATS)), dtype=np.float32)
    if q in _QUARTER_CATS:
        ohe[0, _QUARTER_CATS.index(q)] = 1.0
    X = np.concatenate([nums, ohe], axis=1)
    n = len(_NUM_COLS)
    X[:, :n] = (X[:, :n] - _num_mean) / (_num_std + 1e-8)
    return X


def available():
    _ensure_loaded()
    return _available


def predict_proba(row_dict):
    """Return home-win probability (0-1) for a single game-state row dict."""
    _ensure_loaded()
    X = _transform(row_dict)
    output = _session.run(None, {'input': X})
    return float(output[0][0][0])


def _quarter_label(quarter):
    if quarter == 1: return 'Q1'
    if quarter == 2: return 'Q2'
    if quarter == 3: return 'Q3'
    if quarter == 4: return 'Q4'
    return 'OT'


def compute_wp_curve(plays, team_a, line=0):
    """
    Compute MLP win-probability curve from play list.
    team_a: the home team name (scoreA = home score).
    Falls back to sigmoid formula if model unavailable.
    """
    _ensure_loaded()
    if not _available:
        from server.win_probability import compute_wp_curve as sigmoid_curve
        return sigmoid_curve(plays)

    try:
        line = float(line or 0)
    except (TypeError, ValueError):
        line = 0

    max_quarter = max((p.get('quarter', 4) for p in plays), default=4)
    total_seconds = 2880 if max_quarter <= 4 else 2880 + (max_quarter - 4) * 300

    home_fouls_period = 0
    away_fouls_period = 0
    prev_quarter = None
    home_ejections = 0
    away_ejections = 0

    initial_row = {
        'periodSecondsLeft': 720,
        'secondsLeft': total_seconds,
        'scoreDif': 0,
        'scoreTimePressure': 0,
        'pointsTotal': 0,
        'possession': 0,
        'homeFouls': 0,
        'awayFouls': 0,
        'homeBonus': 0,
        'awayBonus': 0,
        'homeFreeThrows': 0,
        'awayFreeThrows': 0,
        'homeEjections': 0,
        'awayEjections': 0,
        'line': line,
        'quarter': 'Q1',
    }
    curve = [{
        'gameSeconds': 0,
        'wp': round(predict_proba(initial_row) * 100),
        'scoreA': 0,
        'scoreB': 0,
    }]

    if not plays:
        return curve

    for play in plays:
        quarter = play.get('quarter', 1)
        if quarter != prev_quarter:
            home_fouls_period = 0
            away_fouls_period = 0
            prev_quarter = quarter

        etype = play.get('eventType', '')
        team = play.get('team')
        is_home_team = team == team_a

        if etype == 'foul':
            if is_home_team:
                home_fouls_period += 1
            else:
                away_fouls_period += 1
        elif etype == 'ejection':
            if is_home_team:
                home_ejections += 1
            else:
                away_ejections += 1

        score_a = play.get('scoreA', 0)
        score_b = play.get('scoreB', 0)
        score_dif = score_a - score_b
        clock_seconds = play.get('clockSeconds', 0)
        game_seconds = play.get('gameSeconds', 0)
        seconds_left = max(0, total_seconds - game_seconds)
        score_time_pressure = score_dif / (seconds_left + 1)
        points_total = score_a + score_b

        row = {
            'periodSecondsLeft': clock_seconds,
            'secondsLeft': seconds_left,
            'scoreDif': score_dif,
            'scoreTimePressure': score_time_pressure,
            'pointsTotal': points_total,
            'possession': 1 if is_home_team else 0,
            'homeFouls': home_fouls_period,
            'awayFouls': away_fouls_period,
            'homeBonus': 1 if home_fouls_period >= 5 else 0,
            'awayBonus': 1 if away_fouls_period >= 5 else 0,
            'homeFreeThrows': 1 if (etype == 'free_throw' and is_home_team) else 0,
            'awayFreeThrows': 1 if (etype == 'free_throw' and not is_home_team) else 0,
            'homeEjections': home_ejections,
            'awayEjections': away_ejections,
            'line': line,
            'quarter': _quarter_label(quarter),
        }

        p = predict_proba(row)
        curve.append({'gameSeconds': game_seconds, 'wp': round(p * 100), 'scoreA': score_a, 'scoreB': score_b})

    return curve
