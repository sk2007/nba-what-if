# BSA Basketball — NBA Win Probability & What-If Analyzer

**Bruin Sports Analytics, UCLA — Spring 2026**

An interactive full-stack web application for exploring how hypothetical changes to NBA game plays affect win probability. Combines a React frontend, Flask API, and an ONNX-deployed MLP neural network to model game momentum in real time.

---

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Project Structure](#project-structure)
3. [Frontend](#frontend)
4. [Backend](#backend)
5. [Win Probability Models](#win-probability-models)
6. [Key Algorithms](#key-algorithms)
7. [External APIs & Integrations](#external-apis--integrations)
8. [Configuration](#configuration)
9. [Running the App](#running-the-app)
10. [Deployment (Vercel)](#deployment-vercel)
11. [ML Assets](#ml-assets)
12. [Environment Variables](#environment-variables)

---

## Architecture Overview

```
Browser (React + Vite)
        │
        │  /api/* (proxied in dev, serverless function in prod)
        ▼
Flask API (server/app.py)
        │
        ├── nba_client.py       ── nba.com / stats.nba.com (via nba_api)
        ├── wp_mlp.py           ── ONNX MLP inference
        ├── win_probability.py  ── sigmoid fallback
        ├── server/cache/       ── file-based JSON cache
        └── External APIs       ── Kalshi, The-Odds-API
```

**Data flow (Play Editor):**
1. UI fetches play-by-play → Flask checks in-memory/file cache, then live nba_api
2. Backend computes WP curve via MLP for every play
3. UI renders Recharts line graph
4. User edits a play → POST recompute → backend rewalks plays with overrides → new WP curve returned

---

## Project Structure

```
├── src/                              # React frontend
│   ├── App.jsx                       # Root component, tab routing, season selector
│   ├── main.jsx                      # React entry point
│   ├── index.css                     # Global design-system CSS variables
│   ├── api/
│   │   └── nbaApi.js                 # API client utilities
│   ├── components/
│   │   ├── PlayEditor.jsx            # Core what-if play editor (~900 lines)
│   │   ├── KalshiMarkets.jsx         # Prediction market viewer & bet advisor
│   │   ├── GameComparison.jsx        # Side-by-side game momentum comparison
│   │   ├── ClutchIndex.jsx           # Player clutch ranking with autocomplete
│   │   ├── GameSelector.jsx          # Game picker dropdown
│   │   ├── SeasonSelector.jsx        # Season dropdown
│   │   └── Spinner.jsx               # Bouncing basketball loading animation
│   ├── utils/
│   │   └── betAdvisor.js             # Kelly criterion & bet edge calculations
│   └── data/
│       └── statModel.js              # Stats model utilities
│
├── server/                           # Flask backend
│   ├── app.py                        # Flask routes (~350 lines)
│   ├── nba_client.py                 # NBA API wrapper & caching
│   ├── wp_mlp.py                     # ONNX MLP inference
│   ├── win_probability.py            # Sigmoid fallback model
│   ├── seed_cache.py                 # One-time cache seeder
│   ├── requirements.txt              # Python dependencies
│   └── cache/                        # JSON game data cache
│
├── api/
│   └── index.py                      # Vercel serverless Flask wrapper
│
├── wp_model_mlp.onnx                 # ONNX inference model
├── wp_model_mlp.onnx.data            # Model weights
├── wp_model_stats.npz                # Feature normalization stats
├── wp_model_mlp.pt                   # PyTorch checkpoint (retraining)
├── wp_model_feature_pipeline.joblib  # Scikit-learn preprocessing pipeline
├── convert_to_onnx.py                # PyTorch → ONNX export script
├── vite.config.js
├── vercel.json
├── package.json
└── .env                              # ODDS_API_KEY
```

---

## Frontend

### Stack

| Tool | Version | Role |
|------|---------|------|
| React | 19.2.4 | UI framework |
| Vite | 8.0.4 | Build tool & dev server |
| @vitejs/plugin-react | 6.0.1 | JSX transform (Oxc compiler) |
| Recharts | 3.8.1 | Win probability line/bar charts |
| csv-parse | 6.2.1 | CSV parsing utilities |

### Routing

Tab-based client-side routing in `App.jsx` — no React Router. Four tabs:
- **Play Editor** — what-if play editing with live WP recomputation
- **Game Comparison** — dual-game momentum visualization
- **Clutch Index** — per-player clutch performance ranking
- **Kalshi Markets** — prediction market viewer (password-gated)

### Styling

CSS custom properties (design tokens) defined in `index.css`:

```css
--navy, --blue, --slate, --muted       /* color palette */
--shadow-sm, --shadow-md               /* elevation */
--surface, --surface-soft              /* background surfaces */
```

No CSS-in-JS library — components use inline styles referencing these tokens. Responsive breakpoints at 820px and 560px.

### Components

| Component | Lines | Key Responsibility |
|-----------|-------|--------------------|
| `PlayEditor` | ~900 | Play list, override controls (Made/Missed), add-play modal, WP chart |
| `KalshiMarkets` | ~720 | Event browser, market cards, bet advisor overlay |
| `ClutchIndex` | ~360 | Team autocomplete, player ranking table, WP-added bar chart |
| `GameComparison` | ~280 | Dual game selector, overlaid WP curves |
| `GameSelector` | ~100 | Season-aware game dropdown with team/date display |

### Dev Proxy

Vite proxies `/api/*` to `http://localhost:5001` during development, so the frontend never needs to know the backend port.

---

## Backend

### Stack

| Library | Version | Role |
|---------|---------|------|
| Flask | 3.0.3 | Web framework |
| Flask-CORS | 4.0.1 | CORS headers |
| nba_api | 1.4.1 | NBA Stats scraping client |
| onnxruntime | ≥1.17.0 | ONNX model inference |
| numpy | ≥1.24.0 | Numerical operations |
| requests | 2.31.0 | External HTTP calls |
| python-dotenv | latest | `.env` file loading |

### API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/seasons` | Available seasons (2014-25 → 2024-25) and season types |
| GET | `/api/games?season=&type=` | All games for a season |
| GET | `/api/games/<id>/playbyplay` | Play-by-play with precomputed WP curve |
| GET | `/api/games/<id>/boxscore` | Team stats (FG%, 3PT%, FT%, REB, TOV) |
| POST | `/api/wp/recompute` | Recompute WP curve with play overrides |
| GET | `/api/clutch?season=&team=` | Clutch index — player WP-added in crunch time |
| GET | `/api/kalshi/nba/events` | Kalshi NBA event listings |
| GET | `/api/kalshi/markets?ticker=` | Markets for a Kalshi event |
| GET | `/api/kalshi/props?game=` | Player proposition markets |
| GET | `/api/odds/nba` | Sportsbook lines (spreads, totals, moneylines) |

### Caching

Two-layer read-through cache in `nba_client.py`:

1. **In-memory** — Python dict `_cache`, cleared on restart
2. **File-based** — JSON files under `server/cache/` (e.g., `games_2024-25_Regular_Season.json`)

Read order: in-memory → file → live nba_api fetch → write to both layers.

---

## Win Probability Models

### Primary: MLP Neural Network (ONNX)

**Input features (20 total):**

```
Numeric (15, z-score normalized):
  periodSecondsLeft   secondsLeft      scoreDif
  scoreTimePressure   pointsTotal      possession (home=1 / away=0)
  homeFouls           awayFouls        homeBonus        awayBonus
  homeFreeThrows      awayFreeThrows   homeEjections    awayEjections
  line

Quarter one-hot (5):
  Q1  Q2  Q3  Q4  OT
```

**Architecture:**

```
Input(20) → Linear + ReLU → [hidden layers] → Linear + Sigmoid → Output(1)
```

Output is home team win probability in [0, 1].

**Conversion (`convert_to_onnx.py`):**
Loads `wp_model_mlp.pt`, traces the model with a dummy input, and exports to ONNX opset 17. Run once after retraining.

### Fallback: Sigmoid Formula

Used when the ONNX runtime is unavailable:

```python
def win_prob(score_diff, seconds_remaining, total_seconds=2880):
    k = 0.004 * (1 + (total_seconds - seconds_remaining) / total_seconds)
    p = 1 / (1 + exp(-k * score_diff * 100))
    return round(p * 100)
```

The `k` coefficient scales with elapsed game time — late-game score differentials carry higher certainty.

---

## Key Algorithms

### WP Curve Generation

For each game, the backend iterates plays chronologically, maintains a running game-state object (scores, fouls, bonus status, possession), and calls the MLP at each step. Result:

```json
[{ "gameSeconds": 0, "wp": 0.5, "scoreA": 0, "scoreB": 0 }, ...]
```

### Play Override Recomputation (`POST /api/wp/recompute`)

1. Receive play list with `overrides` dict keyed by `eventNum`
2. Walk plays in order, applying score deltas (e.g., flip 2 pts when Made → Missed)
3. Maintain full game state through the walk
4. Call MLP at each step with updated state
5. Return the new WP curve

### Clutch Index (`GET /api/clutch`)

**Filter criteria:** Q4 only, ≤ 300 seconds remaining, score margin ≤ 5 points, editable play types only.

**Metric:** Win probability added per play:

```
delta = wp_after_play(state) - wp_before_play(state)
```

Sign-flipped for away team contributions. Players with fewer than 3 qualifying plays are excluded. Results sorted by total WP added descending.

### Bet Advisor (`src/utils/betAdvisor.js`)

1. Convert American odds → implied probability
2. Remove vig: normalize two raw probs to sum to 1
3. Compute edge: `edge = sportsbook_implied - kalshi_mid_price`
4. Kelly fraction: `f = (edge * (b + 1) - 1) / b`, capped at 25%
5. Recommendation tiers: STRONG YES / LEAN YES / PASS / LEAN NO / STRONG NO

---

## External APIs & Integrations

| API | Base URL | Data | Auth |
|-----|----------|------|------|
| NBA CDN | `data.nba.com/data/v2015` | Schedules, dates | None |
| NBA Stats | `stats.nba.com` (via nba_api) | Play-by-play, boxscores | None |
| Kalshi | `api.elections.kalshi.com/trade-api/v2` | Prediction market quotes | None (public) |
| The-Odds-API | `api.the-odds-api.com/v4` | Sportsbook lines | `ODDS_API_KEY` |

---

## Configuration

### `vite.config.js`

- React plugin using Oxc transform
- Dev server proxy: `/api` → `http://localhost:5001`

### `vercel.json`

```json
{
  "buildCommand": "npm run build",
  "outputDirectory": "dist",
  "functions": {
    "api/index.py": {
      "includeFiles": "wp_model_mlp.onnx|wp_model_mlp.onnx.data|wp_model_stats.npz|server/**"
    }
  },
  "rewrites": [
    { "source": "/api/(.*)", "destination": "/api/index.py" },
    { "source": "/(.*)",     "destination": "/index.html" }
  ]
}
```

Frontend served as static files from `dist/`. All `/api/*` routes hit the Python serverless function. ML model files are bundled into the function at deploy time.

---

## Running the App

### Prerequisites

- Node.js ≥ 18
- Python ≥ 3.10
- virtualenv / venv

### Development

```bash
# 1. Install frontend dependencies
npm install

# 2. Start the Vite dev server (http://localhost:5173)
npm run dev

# 3. In a separate terminal, set up Python environment
cd server
python -m venv .venv
source .venv/bin/activate       # Windows: .venv\Scripts\activate
pip install -r requirements.txt

# 4. Start the Flask server (http://localhost:5001)
python -m flask --app app run --port 5001
```

Vite proxies `/api/*` to `:5001`, so the UI at `:5173` talks to Flask transparently.

### Production Build (local preview)

```bash
npm run build       # outputs to dist/
npm run preview     # serves dist/ at http://localhost:4173
```

---

## Deployment (Vercel)

Push to the connected Git branch. Vercel will:

1. Run `npm run build` → produce `dist/` (static frontend)
2. Bundle `api/index.py` as a Python serverless function
3. Include `wp_model_mlp.onnx`, `wp_model_mlp.onnx.data`, `wp_model_stats.npz`, and the entire `server/` directory in the function package
4. Route `/api/*` to the function; everything else serves `index.html` (SPA fallback)

---

## ML Assets

| File | Description |
|------|-------------|
| `wp_model_mlp.onnx` | Inference graph — used at runtime by `wp_mlp.py` |
| `wp_model_mlp.onnx.data` | External weights file (required alongside `.onnx`) |
| `wp_model_stats.npz` | Normalization parameters (`mean`, `std` for 15 numeric features) |
| `wp_model_mlp.pt` | PyTorch checkpoint — only needed for retraining or re-export |
| `wp_model_feature_pipeline.joblib` | Scikit-learn pipeline — only needed for retraining |
| `convert_to_onnx.py` | Export script: loads `.pt`, exports to ONNX opset 17 |

**To retrain and redeploy the model:**
1. Retrain with PyTorch, save new `.pt` checkpoint
2. `python convert_to_onnx.py` — overwrites `.onnx` + `.onnx.data`
3. Recompute normalization stats → overwrite `wp_model_stats.npz`
4. Deploy

---

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `ODDS_API_KEY` | Yes (for odds tab) | API key for The-Odds-API |

Set in `.env` at project root for local development. Add as a Vercel environment variable for production.

---

*Bruin Sports Analytics — UCLA © 2026*
