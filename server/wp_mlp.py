import os
import joblib
import torch
import numpy as np
import pandas as pd

_DIR = os.path.dirname(os.path.dirname(__file__))
_PIPELINE_PATH = os.path.join(_DIR, 'wp_model_feature_pipeline.joblib')
_MODEL_PATH = os.path.join(_DIR, 'wp_model_mlp.pt')


class _WPNet(torch.nn.Module):
    def __init__(self, n_in, hidden):
        super().__init__()
        layers = []
        prev = n_in
        for h in hidden:
            layers += [torch.nn.Linear(prev, h), torch.nn.ReLU()]
            prev = h
        layers += [torch.nn.Linear(prev, 1), torch.nn.Sigmoid()]
        self.net = torch.nn.Sequential(*layers)

    def forward(self, x):
        return self.net(x)


def _load():
    pipeline = joblib.load(_PIPELINE_PATH)
    ckpt = torch.load(_MODEL_PATH, map_location='cpu', weights_only=False)
    n_in = ckpt['n_numeric'] + ckpt['n_onehot']
    model = _WPNet(n_in, ckpt['hidden_layers'])
    model.load_state_dict(ckpt['state_dict'], strict=False)
    model.eval()
    num_mean = ckpt['state_dict']['num_mean']
    num_std = ckpt['state_dict']['num_std']
    n_numeric = ckpt['n_numeric']
    return pipeline, model, num_mean, num_std, n_numeric


try:
    _pipeline, _model, _num_mean, _num_std, _n_numeric = _load()
    _available = True
except Exception:
    _available = False


def available():
    return _available


def predict_proba(row_dict):
    """Return home-win probability (0-1) for a single game-state row dict."""
    row = pd.DataFrame([row_dict])
    X_raw = _pipeline.transform(row)
    X = torch.tensor(X_raw, dtype=torch.float32)
    X[:, :_n_numeric] = (X[:, :_n_numeric] - _num_mean) / (_num_std + 1e-8)
    with torch.no_grad():
        return float(_model(X).item())


def _quarter_label(quarter):
    if quarter == 1: return 'Q1'
    if quarter == 2: return 'Q2'
    if quarter == 3: return 'Q3'
    if quarter == 4: return 'Q4'
    return 'OT'


def _period_total_seconds(quarter):
    return 720 if quarter <= 4 else 300


def compute_wp_curve(plays, team_a, line=0):
    """
    Compute MLP win-probability curve from play list.
    team_a: the home team name (scoreA = home score).
    Falls back to sigmoid formula if model unavailable.
    """
    if not _available:
        from server.win_probability import compute_wp_curve as sigmoid_curve
        return sigmoid_curve(plays)

    if not plays:
        return [{'gameSeconds': 0, 'wp': 50}]

    max_quarter = max(p.get('quarter', 4) for p in plays)
    total_seconds = 2880 if max_quarter <= 4 else 2880 + (max_quarter - 4) * 300

    # Track running foul counts per period (reset each quarter)
    home_fouls_period = 0
    away_fouls_period = 0
    prev_quarter = None
    home_ejections = 0
    away_ejections = 0

    curve = [{'gameSeconds': 0, 'wp': 50}]

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
        elif etype in ('ejection',):
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

        # Bonus: 5+ fouls in a period triggers bonus (NBA rule)
        home_bonus = 1 if home_fouls_period >= 5 else 0
        away_bonus = 1 if away_fouls_period >= 5 else 0

        # Possession: 1=home has ball, 0=away. Infer from team on this play.
        possession = 1 if is_home_team else 0

        # Active free throw situations
        home_fts = 1 if (etype == 'free_throw' and is_home_team) else 0
        away_fts = 1 if (etype == 'free_throw' and not is_home_team) else 0

        row = {
            'periodSecondsLeft': clock_seconds,
            'secondsLeft': seconds_left,
            'scoreDif': score_dif,
            'scoreTimePressure': score_time_pressure,
            'pointsTotal': points_total,
            'possession': possession,
            'homeFouls': home_fouls_period,
            'awayFouls': away_fouls_period,
            'homeBonus': home_bonus,
            'awayBonus': away_bonus,
            'homeFreeThrows': home_fts,
            'awayFreeThrows': away_fts,
            'homeEjections': home_ejections,
            'awayEjections': away_ejections,
            'line': line,
            'quarter': _quarter_label(quarter),
        }

        p = predict_proba(row)
        curve.append({'gameSeconds': game_seconds, 'wp': round(p * 100), 'scoreA': score_a, 'scoreB': score_b})

    return curve
