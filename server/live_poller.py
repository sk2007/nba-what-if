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
