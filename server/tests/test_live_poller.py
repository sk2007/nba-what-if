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
