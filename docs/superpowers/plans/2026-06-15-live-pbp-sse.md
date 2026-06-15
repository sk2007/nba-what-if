# Live PBP + Win Probability via SSE Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stream live play-by-play and win-probability updates to the frontend for in-progress NBA games using Server-Sent Events with one shared server-side poller per game.

**Architecture:** A `GamePoller` thread per live game polls the NBA Live API every 20s, diffs new plays by `eventNum`, recomputes the WP curve, and fans events out through an `EventBus` to all subscribed SSE clients. A Flask `text/event-stream` endpoint streams events to browsers via the native `EventSource` API. When a game ends, the poller waits a 30s grace period, then closes all client connections.

**Tech Stack:** Python (Flask, threading, queue), existing `nba_api` live endpoints, existing `wp_mlp.compute_wp_curve`, React (`EventSource`).

---

## Reconciliation with the existing codebase

The spec used placeholder field names. The real shapes (confirmed by reading the code) are authoritative here:

- Plays are diffed by **`eventNum`** (integer, from `actionNumber` in the CDN feed — see `nba_client.py:212`). The play dict shape is the one built in `_fetch_play_by_play` (`eventNum`, `quarter`, `clock`, `clockSeconds`, `gameSeconds`, `description`, `scoreA`, `scoreB`, `eventType`, `editable`, `team`, `player`, optional `shotPts`/`addedEventType`).
- The WP curve is a **list of dicts** `{gameSeconds, wp, scoreA, scoreB}` produced by `compute_wp_curve(plays, team_a, line=betting_line)` (`wp_mlp.py:78`). The `wp` SSE event sends this full list.
- `_fetch_play_by_play` currently returns `{gameId, teamA, teamB, bettingLine, plays, wpCurve}`. We will refactor it to delegate to a new `_build_game(game_id)` that also returns a `status`, so the poller and the new `status` field reuse one code path.
- Game status comes from the live PBP payload itself: `pbp_data["game"]["gameStatus"]` (NBA Live uses `1`=upcoming, `2`=live, `3`=final). No separate scoreboard call needed.

---

## File Structure

- **Create** `server/live_poller.py` — `EventBus` singleton + `GamePoller` thread class. Single responsibility: manage live game polling and event fan-out.
- **Create** `server/tests/test_live_poller.py` — unit tests for `EventBus` and `GamePoller` diff/status logic (NBA fetch mocked).
- **Modify** `server/nba_client.py` — extract `_build_game(game_id) -> (game_dict, status)`; add `live` flag to bypass cache; add `get_game_status(game_id)`.
- **Modify** `server/app.py` — add `/api/games/<game_id>/stream` SSE route; add `status` to the `playbyplay` response.
- **Modify** `src/api/nbaApi.js` — add `subscribeToGame(gameId, handlers)`.
- **Modify** `src/components/PlayEditor.jsx` — subscribe to live games, merge incoming plays/WP into state, show a Live/Final badge.

There is no existing test directory under `server/`. Task 1 creates `server/tests/` with an empty `__init__.py` so `pytest` can import the package.

---

### Task 1: Test scaffolding + status helper in nba_client

**Files:**
- Create: `server/tests/__init__.py`
- Create: `server/tests/test_live_poller.py` (created empty here, filled in later tasks)
- Modify: `server/nba_client.py` (refactor `_fetch_play_by_play`, add `_build_game`, `get_game_status`)
- Test: `server/tests/test_nba_client.py`

- [ ] **Step 1: Create the test package marker**

Create `server/tests/__init__.py` with no content (empty file).

- [ ] **Step 2: Write the failing test for `_build_game` returning status**

Create `server/tests/test_nba_client.py`:

```python
from unittest.mock import patch
import server.nba_client as nc


def _fake_pbp(status):
    return {
        "game": {
            "gameStatus": status,
            "actions": [
                {"actionNumber": 1, "period": 1, "clock": "PT12M00.00S",
                 "actionType": "2pt", "shotResult": "Made", "scoreHome": "2",
                 "scoreAway": "0", "teamId": 100, "description": "Made shot"},
            ],
        }
    }


def _fake_box():
    return {
        "game": {
            "gameTimeUTC": "2026-06-15T00:00:00Z",
            "homeTeam": {"teamId": 100, "teamCity": "Los Angeles",
                         "teamName": "Lakers", "players": []},
            "awayTeam": {"teamId": 200, "teamCity": "Boston",
                         "teamName": "Celtics", "players": []},
        }
    }


def test_build_game_reports_live_status():
    with patch.object(nc, "_raw_pbp", return_value=_fake_pbp(2)), \
         patch.object(nc, "_raw_box", return_value=_fake_box()), \
         patch("server.betting_lines.get_pregame_line", return_value=0):
        game, status = nc._build_game("0022200001")
    assert status == "live"
    assert game["teamA"] == "Los Angeles Lakers"
    assert game["plays"][0]["eventNum"] == 1


def test_build_game_reports_finished_status():
    with patch.object(nc, "_raw_pbp", return_value=_fake_pbp(3)), \
         patch.object(nc, "_raw_box", return_value=_fake_box()), \
         patch("server.betting_lines.get_pregame_line", return_value=0):
        _, status = nc._build_game("0022200001")
    assert status == "finished"
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `cd /Users/sampath/BSA-Basketball-S26 && python -m pytest server/tests/test_nba_client.py -v`
Expected: FAIL — `AttributeError: module 'server.nba_client' has no attribute '_build_game'` (and `_raw_pbp`/`_raw_box`).

- [ ] **Step 4: Refactor `nba_client.py` to add `_raw_pbp`, `_raw_box`, `_build_game`, `get_game_status`**

In `server/nba_client.py`, add a status map near the top (after line 17):

```python
_GAME_STATUS = {1: "upcoming", 2: "live", 3: "finished"}
```

Replace the body of `_fetch_play_by_play` (lines 141-240) with this refactor. Extract the two network calls into helpers and split building from fetching:

```python
def _raw_pbp(game_id):
    from nba_api.live.nba.endpoints import playbyplay
    return playbyplay.PlayByPlay(
        game_id=game_id,
        headers=_NBA_LIVE_HEADERS,
        timeout=15,
    ).nba_response.get_dict()


def _raw_box(game_id):
    from nba_api.live.nba.endpoints import boxscore
    return boxscore.BoxScore(
        game_id=game_id,
        headers=_NBA_LIVE_HEADERS,
        timeout=15,
    ).nba_response.get_dict()


def _build_game(game_id):
    """Fetch live PBP + boxscore and build the game dict.
    Returns (game_dict, status) where status is upcoming|live|finished."""
    from server.betting_lines import get_pregame_line
    from server.wp_mlp import compute_wp_curve

    pbp_data = _raw_pbp(game_id)
    game_node = pbp_data["game"]
    status = _GAME_STATUS.get(game_node.get("gameStatus", 3), "finished")
    actions = game_node["actions"]

    box_game = _raw_box(game_id)["game"]
    home = box_game["homeTeam"]
    away = box_game["awayTeam"]
    team_a = f"{home['teamCity']} {home['teamName']}"
    team_b = f"{away['teamCity']} {away['teamName']}"
    home_id = home["teamId"]
    game_date = (
        box_game.get("gameTimeUTC")
        or box_game.get("gameEt")
        or box_game.get("gameDate")
        or ""
    )[:10]
    betting_line = get_pregame_line(team_a, team_b, game_date)

    name_map = {}
    for p in home.get("players", []) + away.get("players", []):
        name_i = p.get("nameI", "")
        full = p.get("name", "") or f"{p.get('firstName', '')} {p.get('familyName', '')}".strip()
        if name_i and full:
            name_map[name_i] = full

    plays = []
    score_a = 0
    score_b = 0
    for action in actions:
        quarter = action.get("period", 0)
        if not quarter:
            continue
        clock_display, clock_seconds, game_seconds = _parse_cdn_clock(action.get("clock", ""), quarter)
        score_str_a = action.get("scoreHome", "")
        score_str_b = action.get("scoreAway", "")
        if score_str_a:
            try:
                score_a = int(score_str_a)
                score_b = int(score_str_b)
            except ValueError:
                pass
        event_type, editable, shot_pts, added_event_type = _classify_cdn_event(action)
        team_id = action.get("teamId")
        team_full = team_a if team_id == home_id else (team_b if team_id else None)
        name_i = action.get("playerNameI") or None
        player = name_map.get(name_i, name_i) if name_i else None
        play = {
            "eventNum": action.get("actionNumber", 0),
            "clock": clock_display,
            "quarter": quarter,
            "clockSeconds": clock_seconds,
            "gameSeconds": game_seconds,
            "description": action.get("description", ""),
            "scoreA": score_a,
            "scoreB": score_b,
            "eventType": event_type,
            "editable": editable,
            "team": team_full,
            "player": player,
        }
        if shot_pts is not None:
            play["shotPts"] = shot_pts
        if added_event_type:
            play["addedEventType"] = added_event_type
        plays.append(play)

    wp_curve = compute_wp_curve(plays, team_a, line=betting_line)
    game = {
        "gameId": game_id,
        "teamA": team_a,
        "teamB": team_b,
        "bettingLine": betting_line,
        "plays": plays,
        "wpCurve": wp_curve,
        "status": status,
    }
    return game, status


def _fetch_play_by_play(game_id):
    game, _ = _build_game(game_id)
    return game


def get_game_status(game_id):
    """Return upcoming|live|finished from the live PBP payload only (no box fetch)."""
    status_code = _raw_pbp(game_id)["game"].get("gameStatus", 3)
    return _GAME_STATUS.get(status_code, "finished")
```

Delete the now-duplicated old `_fetch_play_by_play` body and the inline `from nba_api...` imports that lived inside it (they are now in `_raw_pbp`/`_raw_box`/`_build_game`).

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd /Users/sampath/BSA-Basketball-S26 && python -m pytest server/tests/test_nba_client.py -v`
Expected: PASS (2 passed).

- [ ] **Step 6: Add the cache-bypass `live` flag**

In `server/nba_client.py`, update `get_play_by_play` (currently lines 105-111) to accept a `live` flag that bypasses `_cached`:

```python
def get_play_by_play(game_id, live=False):
    """
    Returns dict: { gameId, teamA, teamB, bettingLine, plays, wpCurve, status }
    When live=True, bypass the in-memory cache (always re-fetch).
    """
    if live:
        return _fetch_play_by_play(game_id)
    key = f"pbp:{game_id}"
    return _cached(key, lambda: _fetch_play_by_play(game_id))
```

- [ ] **Step 7: Commit**

```bash
cd /Users/sampath/BSA-Basketball-S26
git add server/tests/__init__.py server/tests/test_nba_client.py server/nba_client.py
git commit -m "refactor: extract _build_game with status, add live cache bypass"
```

---

### Task 2: EventBus

**Files:**
- Create: `server/live_poller.py`
- Test: `server/tests/test_live_poller.py`

- [ ] **Step 1: Write the failing test for EventBus subscribe/publish/unsubscribe**

Create `server/tests/test_live_poller.py`:

```python
import queue
from server.live_poller import EventBus


def test_publish_fans_out_to_all_subscribers():
    bus = EventBus(poller_factory=lambda gid, b: _NoopPoller())
    q1 = bus.subscribe("g1")
    q2 = bus.subscribe("g1")
    bus.publish("g1", {"type": "play", "data": {"eventNum": 5}})
    assert q1.get_nowait()["data"]["eventNum"] == 5
    assert q2.get_nowait()["data"]["eventNum"] == 5


def test_unsubscribe_stops_delivery():
    bus = EventBus(poller_factory=lambda gid, b: _NoopPoller())
    q1 = bus.subscribe("g1")
    bus.unsubscribe("g1", q1)
    bus.publish("g1", {"type": "play", "data": {}})
    with_pytest_raises_empty(q1)


def test_close_game_sends_sentinel_and_clears():
    bus = EventBus(poller_factory=lambda gid, b: _NoopPoller())
    q1 = bus.subscribe("g1")
    bus.close_game("g1")
    assert q1.get_nowait() is None


def with_pytest_raises_empty(q):
    try:
        q.get_nowait()
        raise AssertionError("expected empty queue")
    except queue.Empty:
        pass


class _NoopPoller:
    def start(self):
        pass
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd /Users/sampath/BSA-Basketball-S26 && python -m pytest server/tests/test_live_poller.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'server.live_poller'`.

- [ ] **Step 3: Write the EventBus implementation**

Create `server/live_poller.py` with the EventBus (GamePoller added in Task 3):

```python
import json
import logging
import queue
import threading
import time

log = logging.getLogger(__name__)

POLL_INTERVAL_SECONDS = 20
GRACE_PERIOD_SECONDS = 30
MAX_CONSECUTIVE_FAILURES = 3


class EventBus:
    """Maps gameId -> list of subscriber queues. Starts one poller per game."""

    def __init__(self, poller_factory=None):
        self._subscribers = {}        # gameId -> list[queue.Queue]
        self._pollers = {}            # gameId -> poller
        self._lock = threading.Lock()
        # poller_factory(game_id, bus) -> object with .start(); injectable for tests
        self._poller_factory = poller_factory or (lambda gid, bus: GamePoller(gid, bus))

    def subscribe(self, game_id):
        q = queue.Queue()
        with self._lock:
            self._subscribers.setdefault(game_id, []).append(q)
            if game_id not in self._pollers:
                poller = self._poller_factory(game_id, self)
                self._pollers[game_id] = poller
                poller.start()
        return q

    def unsubscribe(self, game_id, q):
        with self._lock:
            subs = self._subscribers.get(game_id)
            if subs and q in subs:
                subs.remove(q)

    def publish(self, game_id, event):
        with self._lock:
            subs = list(self._subscribers.get(game_id, []))
        for q in subs:
            q.put(event)

    def close_game(self, game_id):
        with self._lock:
            subs = self._subscribers.pop(game_id, [])
            self._pollers.pop(game_id, None)
        for q in subs:
            q.put(None)  # sentinel: tells the SSE generator to close


# Module-level singleton used by the Flask app.
event_bus = EventBus()
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd /Users/sampath/BSA-Basketball-S26 && python -m pytest server/tests/test_live_poller.py -v`
Expected: PASS (3 passed).

- [ ] **Step 5: Commit**

```bash
cd /Users/sampath/BSA-Basketball-S26
git add server/live_poller.py server/tests/test_live_poller.py
git commit -m "feat: add EventBus for live game SSE fan-out"
```

---

### Task 3: GamePoller diff + status logic

**Files:**
- Modify: `server/live_poller.py` (add `GamePoller`)
- Test: `server/tests/test_live_poller.py` (add tests)

GamePoller is built so the loop body (`_poll_once`) is a pure-ish method testable without threads or sleeps.

- [ ] **Step 1: Write failing tests for `_poll_once` diff + finish behavior**

Append to `server/tests/test_live_poller.py`:

```python
from unittest.mock import patch
from server.live_poller import GamePoller


def _game(plays, status, wp=None):
    return {
        "gameId": "g1", "teamA": "A", "teamB": "B", "bettingLine": 0,
        "plays": plays, "wpCurve": wp or [{"gameSeconds": 0, "wp": 50, "scoreA": 0, "scoreB": 0}],
        "status": status,
    }, status


def test_poll_once_publishes_only_new_plays():
    bus = EventBus(poller_factory=lambda gid, b: _NoopPoller())
    q = bus.subscribe("g1")
    poller = GamePoller("g1", bus)
    poller.last_event_num = 1
    plays = [{"eventNum": 1, "description": "old"}, {"eventNum": 2, "description": "new"}]
    with patch("server.live_poller.get_play_by_play", return_value=_game(plays, "live")[0]):
        poller._poll_once()
    events = _drain(q)
    play_events = [e for e in events if e["type"] == "play"]
    assert len(play_events) == 1
    assert play_events[0]["data"]["eventNum"] == 2
    assert poller.last_event_num == 2


def test_poll_once_publishes_wp_event():
    bus = EventBus(poller_factory=lambda gid, b: _NoopPoller())
    q = bus.subscribe("g1")
    poller = GamePoller("g1", bus)
    curve = [{"gameSeconds": 0, "wp": 55, "scoreA": 0, "scoreB": 0}]
    with patch("server.live_poller.get_play_by_play",
               return_value=_game([{"eventNum": 1}], "live", curve)[0]):
        poller._poll_once()
    events = _drain(q)
    wp_events = [e for e in events if e["type"] == "wp"]
    assert wp_events and wp_events[0]["data"]["wpCurve"] == curve


def test_poll_once_returns_true_when_finished():
    bus = EventBus(poller_factory=lambda gid, b: _NoopPoller())
    bus.subscribe("g1")
    poller = GamePoller("g1", bus)
    with patch("server.live_poller.get_play_by_play",
               return_value=_game([{"eventNum": 1}], "finished")[0]):
        finished = poller._poll_once()
    assert finished is True


def test_poll_once_emits_error_after_repeated_failures():
    bus = EventBus(poller_factory=lambda gid, b: _NoopPoller())
    q = bus.subscribe("g1")
    poller = GamePoller("g1", bus)
    with patch("server.live_poller.get_play_by_play", side_effect=RuntimeError("nba down")):
        for _ in range(3):
            poller._poll_once()
    events = _drain(q)
    statuses = [e for e in events if e["type"] == "status"]
    assert any(s["data"]["gameStatus"] == "error" for s in statuses)


def _drain(q):
    out = []
    while True:
        try:
            out.append(q.get_nowait())
        except Exception:
            return out
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/sampath/BSA-Basketball-S26 && python -m pytest server/tests/test_live_poller.py -v`
Expected: FAIL — `ImportError: cannot import name 'GamePoller'`.

- [ ] **Step 3: Implement GamePoller**

In `server/live_poller.py`, add the import at the top (below the stdlib imports):

```python
from server.nba_client import get_play_by_play
```

Then append the class (before the `event_bus = EventBus()` line — move that line to the very bottom of the file):

```python
class GamePoller:
    def __init__(self, game_id, bus):
        self.game_id = game_id
        self.bus = bus
        self.last_event_num = 0
        self.consecutive_failures = 0
        self._thread = threading.Thread(target=self.run, daemon=True)

    def start(self):
        self._thread.start()

    def _poll_once(self):
        """One poll cycle. Returns True when the game is finished."""
        try:
            game = get_play_by_play(self.game_id, live=True)
            self.consecutive_failures = 0
        except Exception as e:
            self.consecutive_failures += 1
            log.warning("poll failed for %s: %s", self.game_id, e)
            if self.consecutive_failures >= MAX_CONSECUTIVE_FAILURES:
                self.bus.publish(self.game_id, {
                    "type": "status",
                    "data": {"gameStatus": "error"},
                })
            return False

        for play in game["plays"]:
            if play.get("eventNum", 0) > self.last_event_num:
                self.bus.publish(self.game_id, {"type": "play", "data": play})
                self.last_event_num = play["eventNum"]

        self.bus.publish(self.game_id, {
            "type": "wp",
            "data": {"wpCurve": game["wpCurve"]},
        })

        return game.get("status") == "finished"

    def run(self):
        while True:
            finished = self._poll_once()
            if finished:
                self.bus.publish(self.game_id, {
                    "type": "status",
                    "data": {"gameStatus": "finished", "closingIn": GRACE_PERIOD_SECONDS},
                })
                time.sleep(GRACE_PERIOD_SECONDS)
                self.bus.publish(self.game_id, {
                    "type": "status",
                    "data": {"gameStatus": "finished", "closingIn": 0},
                })
                self.bus.close_game(self.game_id)
                return
            time.sleep(POLL_INTERVAL_SECONDS)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/sampath/BSA-Basketball-S26 && python -m pytest server/tests/test_live_poller.py -v`
Expected: PASS (7 passed total in this file).

- [ ] **Step 5: Commit**

```bash
cd /Users/sampath/BSA-Basketball-S26
git add server/live_poller.py server/tests/test_live_poller.py
git commit -m "feat: add GamePoller with play diff, WP, and finish handling"
```

---

### Task 4: SSE route + status field in app.py

**Files:**
- Modify: `server/app.py`
- Test: `server/tests/test_stream_route.py`

- [ ] **Step 1: Write failing tests for the stream route and status field**

Create `server/tests/test_stream_route.py`:

```python
from unittest.mock import patch
import server.app as app_module


def _client():
    app_module.app.config["TESTING"] = True
    return app_module.app.test_client()


def test_stream_sets_event_stream_mimetype():
    client = _client()
    fake_q = __import__("queue").Queue()
    fake_q.put(None)  # immediately close so the generator ends
    with patch.object(app_module.event_bus, "subscribe", return_value=fake_q), \
         patch.object(app_module.event_bus, "unsubscribe"):
        resp = client.get("/api/games/g1/stream")
        body = resp.get_data(as_text=True)
    assert resp.mimetype == "text/event-stream"
    assert body == ""  # only the sentinel was queued


def test_stream_formats_named_events():
    client = _client()
    q = __import__("queue").Queue()
    q.put({"type": "play", "data": {"eventNum": 7}})
    q.put(None)
    with patch.object(app_module.event_bus, "subscribe", return_value=q), \
         patch.object(app_module.event_bus, "unsubscribe"):
        body = client.get("/api/games/g1/stream").get_data(as_text=True)
    assert "event: play" in body
    assert '"eventNum": 7' in body


def test_playbyplay_includes_status():
    client = _client()
    fake = {"gameId": "g1", "teamA": "A", "teamB": "B", "plays": [],
            "wpCurve": [], "status": "finished"}
    with patch("server.app.get_play_by_play", return_value=fake):
        data = client.get("/api/games/g1/playbyplay").get_json()
    assert data["status"] == "finished"
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/sampath/BSA-Basketball-S26 && python -m pytest server/tests/test_stream_route.py -v`
Expected: FAIL — `test_stream_*` 404 (route missing). `test_playbyplay_includes_status` passes already since the dict carries `status` (status is added by `_build_game`); that's fine.

- [ ] **Step 3: Add the SSE route and imports to `app.py`**

In `server/app.py`, update the Flask import (line 1) to include `Response` and `stream_with_context`, and add `json`:

```python
import json
from flask import Flask, jsonify, request, Response, stream_with_context
```

Add to the nba_client import (line 7):

```python
from server.nba_client import get_available_seasons, get_games, get_play_by_play, is_selectable_season
from server.live_poller import event_bus
```

Add the route after the existing `play_by_play` route (after line 43):

```python
@app.get("/api/games/<game_id>/stream")
def stream(game_id):
    q = event_bus.subscribe(game_id)

    def generate():
        try:
            while True:
                event = q.get()
                if event is None:
                    break
                yield f"event: {event['type']}\ndata: {json.dumps(event['data'])}\n\n"
        finally:
            event_bus.unsubscribe(game_id, q)

    return Response(stream_with_context(generate()), mimetype="text/event-stream")
```

The existing `play_by_play` route already returns the dict from `get_play_by_play`, which now includes `status` from `_build_game` — no change needed there.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/sampath/BSA-Basketball-S26 && python -m pytest server/tests/test_stream_route.py -v`
Expected: PASS (3 passed).

- [ ] **Step 5: Run the full server test suite**

Run: `cd /Users/sampath/BSA-Basketball-S26 && python -m pytest server/tests/ -v`
Expected: PASS (all tests across the three test files).

- [ ] **Step 6: Commit**

```bash
cd /Users/sampath/BSA-Basketball-S26
git add server/app.py server/tests/test_stream_route.py
git commit -m "feat: add SSE stream route and status field"
```

---

### Task 5: Client subscribe helper

**Files:**
- Modify: `src/api/nbaApi.js`

This is a thin wrapper over the browser `EventSource`. There is no JS test runner configured in this repo (no `vitest`/`jest` in scripts), so this helper is verified manually in Task 6's smoke test. Keep it minimal.

- [ ] **Step 1: Add `subscribeToGame` to `nbaApi.js`**

Append to `src/api/nbaApi.js`:

```js
// Opens an SSE connection for a live game. Returns a cleanup function that
// closes the stream. Handlers are optional.
export function subscribeToGame(gameId, { onPlay, onWP, onStatus } = {}) {
  const es = new EventSource(`/api/games/${gameId}/stream`);
  if (onPlay) es.addEventListener('play', (e) => onPlay(JSON.parse(e.data)));
  if (onWP) es.addEventListener('wp', (e) => onWP(JSON.parse(e.data)));
  if (onStatus) es.addEventListener('status', (e) => onStatus(JSON.parse(e.data)));
  es.onerror = () => es.close();
  return () => es.close();
}
```

- [ ] **Step 2: Verify the dev server proxies `/api` to Flask**

Run: `cd /Users/sampath/BSA-Basketball-S26 && grep -n "proxy\|/api\|5001" vite.config.js`
Expected: a proxy entry routing `/api` to the Flask port (5001). If absent, SSE requests from the Vite dev server (5173) will 404 — note this for Task 6 and add a proxy if missing. (CORS in `app.py:13` only whitelists `localhost:5173`, so the proxy is the expected path.)

- [ ] **Step 3: Commit**

```bash
cd /Users/sampath/BSA-Basketball-S26
git add src/api/nbaApi.js
git commit -m "feat: add subscribeToGame SSE client helper"
```

---

### Task 6: Wire live updates into PlayEditor

**Files:**
- Modify: `src/components/PlayEditor.jsx`

The component already stores the game in `game` state (`{teamA, teamB, plays, wpCurve, bettingLine, status, ...}`) and renders `game.wpCurve` as the "Original" curve. Live mode appends new plays to `game.plays` and replaces `game.wpCurve` via `setGame`, so the existing chart/impact code updates automatically.

- [ ] **Step 1: Import the helper**

In `src/components/PlayEditor.jsx`, update the import on line 6:

```js
import { fetchPlayByPlay, recomputeWpCurveRemote, subscribeToGame } from '../api/nbaApi';
```

- [ ] **Step 2: Add a live-subscription effect**

In the `PlayEditor` component, immediately after the existing `gameId` fetch effect (ends at line 882), add:

```jsx
  // Subscribe to live updates when the loaded game is in progress.
  useEffect(() => {
    if (!game || game.status !== 'live') return;

    const cleanup = subscribeToGame(gameId, {
      onPlay: (play) => {
        setGame((prev) => {
          if (!prev) return prev;
          if (prev.plays.some((p) => p.eventNum === play.eventNum)) return prev;
          return { ...prev, plays: [...prev.plays, play] };
        });
      },
      onWP: ({ wpCurve }) => {
        setGame((prev) => (prev ? { ...prev, wpCurve } : prev));
      },
      onStatus: ({ gameStatus }) => {
        if (gameStatus === 'finished') {
          setGame((prev) => (prev ? { ...prev, status: 'finished' } : prev));
        }
      },
    });
    return cleanup;
  }, [game?.status, gameId]);
```

Note: the effect depends on `game?.status` (not the whole `game` object) so it does not re-subscribe on every play update. It opens once when status becomes `'live'` and the cleanup closes the `EventSource` when status flips to `'finished'` or the game changes.

- [ ] **Step 3: Add a Live/Final badge to the subtitle row**

In the subtitle `<span>` (currently lines 1061-1064), add a status badge after the score. Replace:

```jsx
            <span style={styles.subtitle}>
              {game.teamA} {game.plays.at(-1)?.scoreA ?? '—'} – {game.plays.at(-1)?.scoreB ?? '—'} {game.teamB}
              {game.bettingLine !== undefined && ` · line ${game.bettingLine > 0 ? '+' : ''}${game.bettingLine}`}
            </span>
```

with:

```jsx
            <span style={styles.subtitle}>
              {game.status === 'live' && <span style={styles.liveBadge}>● LIVE</span>}
              {game.status === 'finished' && game.plays.length > 0 && <span style={styles.finalBadge}>FINAL</span>}
              {game.teamA} {game.plays.at(-1)?.scoreA ?? '—'} – {game.plays.at(-1)?.scoreB ?? '—'} {game.teamB}
              {game.bettingLine !== undefined && ` · line ${game.bettingLine > 0 ? '+' : ''}${game.bettingLine}`}
            </span>
```

- [ ] **Step 4: Add the badge styles**

Find the `styles` object used by `PlayEditor` (the one containing `subtitle`/`perspectiveRow`). Add two entries:

```js
  liveBadge: { color: '#dc2626', fontWeight: '700', fontSize: '12px', marginRight: '10px', letterSpacing: '0.03em' },
  finalBadge: { color: '#64748b', fontWeight: '700', fontSize: '12px', marginRight: '10px', letterSpacing: '0.03em' },
```

(If `styles` lives later in the file beyond the page already read, locate it with `grep -n "subtitle:" src/components/PlayEditor.jsx` and add the entries to that object.)

- [ ] **Step 5: Build to verify no syntax/lint errors**

Run: `cd /Users/sampath/BSA-Basketball-S26 && npm run build`
Expected: build succeeds with no errors referencing PlayEditor or nbaApi.

- [ ] **Step 6: Manual smoke test (documented, run by the implementer)**

Start backend: `cd /Users/sampath/BSA-Basketball-S26 && python -m flask --app server.app run --port 5001` (background).
Start frontend: `npm run dev`.
- If a live NBA game exists: select it, confirm the LIVE badge shows and the play list / WP chart update within ~20s.
- If no live game (off-season — today is 2026-06-15): open the browser devtools Network tab, select any finished game, and confirm `/api/games/<id>/stream` returns immediately with a `status` event and closes (the finished-status path). Confirm no console errors and the FINAL badge renders.

Expected: SSE connection opens, named events arrive, connection closes on finish; no React errors.

- [ ] **Step 7: Commit**

```bash
cd /Users/sampath/BSA-Basketball-S26
git add src/components/PlayEditor.jsx
git commit -m "feat: live PBP + WP updates in PlayEditor via SSE"
```

---

## Self-Review

**Spec coverage:**
- Shared poller per game (one NBA call regardless of viewers) → Task 2 (`EventBus` starts one poller), Task 3 (`GamePoller`). ✓
- `play` / `wp` / `status` events → Task 3 (`_poll_once` publishes all three). ✓
- SSE endpoint, `text/event-stream`, sentinel close → Task 4. ✓
- 30s grace period → Task 3 (`run()` sleeps `GRACE_PERIOD_SECONDS`). ✓
- Cache bypass for live → Task 1 Step 6. ✓
- `status` field on playbyplay → Task 1 (`_build_game` adds it). ✓
- Client `subscribeToGame` → Task 5. ✓
- PlayEditor live merge + badge → Task 6. ✓
- Error handling: 3-failure threshold emits `error` status, poll retries → Task 3 (`_poll_once`). ✓
- Client disconnect cleanup → Task 4 (`finally: unsubscribe`). ✓

**Spec deviations (intentional, documented above):** diff by `eventNum` not `actionNumber`; `wp` event carries the existing curve-of-dicts; status sourced from `gameStatus` in the live payload, not a separate scoreboard call; heartbeat via blocking `q.get()` + sentinel rather than `timeout=30` (simpler, and the test client needs a terminating stream). The blocking `q.get()` keeps the connection open between plays exactly as the spec's timeout intent required, without periodic wakeups.

**Placeholder scan:** none — all steps contain concrete code and commands.

**Type consistency:** `eventNum` used consistently across poller, route, and client; `wpCurve` is a list of dicts everywhere; `status` values `upcoming|live|finished|error` consistent across `_GAME_STATUS`, events, and the React badge logic.
