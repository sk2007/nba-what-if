# Live PBP + Win Probability via SSE

**Date:** 2026-06-15  
**Scope:** Stream live play-by-play and win probability curve to the frontend using Server-Sent Events with a shared server-side game poller.

---

## Goals

- Real-time PBP feed and WP curve updates for in-progress NBA games
- 5–50 concurrent users per game, one NBA API call per game regardless of viewer count
- 30-second grace period after game ends before connection closes
- No new client-side dependencies (native `EventSource` API)

## Architecture

```
NBA Live API
     │
     ▼ (poll every 20s)
GamePoller (one per live game)
     │ new plays + WP events
     ▼
EventBus (dict: gameId → list of client queues)
     │ fan-out
     ▼
SSE endpoint /api/games/<gameId>/stream
     │ text/event-stream
     ▼
Browser (EventSource)
```

## New Files

- `server/live_poller.py` — `GamePoller` class and `EventBus` singleton

## Modified Files

- `server/app.py` — add `/api/games/<gameId>/stream` SSE route; add `status` field to `/api/games/<gameId>/playbyplay` response
- `server/nba_client.py` — add `live=True` flag to `_fetch_play_by_play` to bypass cache
- `src/api/nbaApi.js` — add `subscribeToGame(gameId, handlers)` function
- `src/components/PlayEditor.jsx` — detect live game status, open/close SSE connection, append plays and replace WP curve in state

---

## Event Schema

All SSE events use named event types. Data is JSON.

### `play`
Emitted once per new play since the last poll.
```json
{
  "actionNumber": 142,
  "clock": "PT05M32.00S",
  "period": 3,
  "teamTricode": "LAL",
  "description": "LeBron James 2pt Driving Layup",
  "scoreHome": 78,
  "scoreAway": 71
}
```

### `wp`
Emitted once per poll cycle with the full updated WP curve.
```json
{
  "wpCurve": [0.50, 0.53, 0.48, "..."]
}
```

### `status`
Emitted on game state transitions.
```json
{
  "gameStatus": "finished" | "upcoming" | "error",
  "closingIn": 30
}
```

---

## Server Implementation (`server/live_poller.py`)

### `GamePoller`

- `__init__(gameId)` — stores gameId, initializes `last_action_number = 0`, `finished_at = None`, `consecutive_failures = 0`
- `run()` — loop:
  1. Fetch full PBP with `live=True` (bypasses cache)
  2. Diff plays by `actionNumber > last_action_number`
  3. Publish each new play as a `play` event
  4. Recompute full WP curve via existing `wp_mlp.py` / `win_probability.py` pipeline; publish as `wp` event
  5. Check game status — if finished, set `finished_at`, sleep 30s, emit `status {gameStatus: "finished", closingIn: 0}`, call `EventBus.close_game(gameId)`, exit loop
  6. Sleep 20s, repeat
- On NBA API failure: increment `consecutive_failures`, log, retry next cycle. After 3 consecutive failures emit `status {gameStatus: "error"}` and keep retrying.
- Runs in `threading.Thread(daemon=True)`

### `EventBus` (singleton)

| Method | Behavior |
|---|---|
| `subscribe(gameId) → Queue` | Creates a queue, appends to subscriber list, starts `GamePoller` thread if none running for this game |
| `unsubscribe(gameId, queue)` | Removes queue from subscriber list |
| `publish(gameId, event_dict)` | Puts event onto all queues for this game |
| `close_game(gameId)` | Puts sentinel `None` onto all queues, removes game entry |

All mutations to the subscriber dict are guarded by a `threading.Lock`.

### SSE Route (added to `server/app.py`)

```python
@app.route('/api/games/<game_id>/stream')
def stream(game_id):
    q = event_bus.subscribe(game_id)
    def generate():
        try:
            while True:
                event = q.get(timeout=30)
                if event is None:
                    break
                yield f"event: {event['type']}\ndata: {json.dumps(event['data'])}\n\n"
        finally:
            event_bus.unsubscribe(game_id, q)
    return Response(stream_with_context(generate()), mimetype='text/event-stream')
```

`q.get(timeout=30)` keeps the connection alive between plays without an explicit heartbeat.

### Cache Bypass (`server/nba_client.py`)

`_fetch_play_by_play(game_id, live=False)` — when `live=True`, skip `_cached()` and always call the NBA Live API directly.

### Game Status Field

`/api/games/<gameId>/playbyplay` response gains a top-level `"status": "live" | "finished" | "upcoming"` field derived from the NBA Live scoreboard endpoint.

---

## Client Implementation

### `src/api/nbaApi.js`

```js
export function subscribeToGame(gameId, { onPlay, onWP, onStatus }) {
  const es = new EventSource(`/api/games/${gameId}/stream`);
  es.addEventListener('play', e => onPlay(JSON.parse(e.data)));
  es.addEventListener('wp',   e => onWP(JSON.parse(e.data)));
  es.addEventListener('status', e => onStatus(JSON.parse(e.data)));
  es.onerror = () => es.close();
  return () => es.close(); // cleanup function
}
```

### `src/components/PlayEditor.jsx`

- On mount / `gameId` change: check `status` field from initial PBP fetch
- If `"live"`: call `subscribeToGame`, store cleanup fn
  - `onPlay`: append play to plays state array
  - `onWP`: replace WP curve in state
  - `onStatus` with `"finished"`: show "Final" badge, stop expecting updates
- On unmount: call cleanup fn to close `EventSource`
- On reconnect: re-fetch full PBP via REST first to fill any gap, then re-open SSE stream

---

## Error Handling

| Scenario | Behavior |
|---|---|
| NBA API poll failure | Log, retry next cycle (20s). After 3 consecutive failures emit `status {gameStatus: "error"}` to clients |
| Client disconnects mid-stream | `finally` block in `generate()` always calls `unsubscribe()` |
| All clients disconnect | Poller keeps running; stops only when game ends |
| Client reconnects (EventSource auto-reconnect) | Re-fetches full PBP via REST, then re-opens SSE stream |
| SSE opened for non-live game | Server emits `status` event immediately with `"finished"` or `"upcoming"`, closes stream |
| Concurrent connect/disconnect | `threading.Lock` guards EventBus subscriber dict |

---

## Out of Scope (this iteration)

- Clutch Index live updates
- Boxscore live updates
- `Last-Event-ID` replay / event log persistence
- Authentication on the SSE endpoint
