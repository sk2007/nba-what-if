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
