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
