import json
import logging
import queue
import threading
import time

from server.nba_client import get_play_by_play

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
        poller = None
        with self._lock:
            subs = self._subscribers.get(game_id)
            if subs and q in subs:
                subs.remove(q)
            # When the last subscriber leaves, stop the poller so it doesn't
            # keep hitting the NBA API for a game nobody is watching.
            if subs is not None and not subs:
                self._subscribers.pop(game_id, None)
                poller = self._pollers.pop(game_id, None)
        if poller is not None:
            poller.stop()

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


class GamePoller:
    def __init__(self, game_id, bus):
        self.game_id = game_id
        self.bus = bus
        self.last_event_num = 0
        self.consecutive_failures = 0
        self._stopped = False
        self._thread = threading.Thread(target=self.run, daemon=True)

    def start(self):
        self._thread.start()

    def stop(self):
        """Signal the poll loop to exit at its next iteration."""
        self._stopped = True

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
        while not self._stopped:
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
            self._interruptible_sleep(POLL_INTERVAL_SECONDS)

    def _interruptible_sleep(self, seconds):
        """Sleep in short slices so stop() takes effect promptly."""
        slept = 0.0
        while slept < seconds and not self._stopped:
            time.sleep(min(1.0, seconds - slept))
            slept += 1.0


# Module-level singleton used by the Flask app.
event_bus = EventBus()
