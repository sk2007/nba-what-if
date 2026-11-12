import assert from 'node:assert/strict';
import { afterEach, mock, test } from 'node:test';
import { fetchGames } from '../src/api/nbaApi.js';

afterEach(() => mock.restoreAll());

test('a hung game-list request times out, releases the shared request, and allows retry', async () => {
  const realSetTimeout = globalThis.setTimeout;
  mock.method(globalThis, 'setTimeout', (callback, delay) => {
    assert.equal(delay, 20000);
    return realSetTimeout(callback, 1);
  });
  const request = mock.method(globalThis, 'fetch', (_path, { signal }) => new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => reject(signal.reason), { once: true });
  }));
  const first = fetchGames('2025-26', 'Regular Season');
  const shared = fetchGames('2025-26', 'Regular Season');
  assert.equal(first, shared);
  assert.equal(request.mock.callCount(), 1);
  await assert.rejects(first, /request timed out/);

  const games = [{ gameId: '0022500001' }];
  request.mock.mockImplementation(async () => ({ ok: true, json: async () => ({ games }) }));
  assert.deepEqual(await fetchGames('2025-26', 'Regular Season'), { games });
  assert.equal(request.mock.callCount(), 2);
});

test('the deadline also covers a stalled response body', async () => {
  const realSetTimeout = globalThis.setTimeout;
  mock.method(globalThis, 'setTimeout', (callback) => realSetTimeout(callback, 1));
  mock.method(globalThis, 'fetch', async (_path, { signal }) => ({
    ok: true,
    json: () => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(signal.reason), { once: true });
    })
  }));
  await assert.rejects(fetchGames('2025-26', 'Playoffs'), /request timed out/);
});

test('NBA errors remain visible instead of becoming empty game lists', async () => {
  mock.method(globalThis, 'fetch', async () => ({
    ok: false, status: 503, json: async () => ({ error: 'NBA unavailable' })
  }));
  await assert.rejects(fetchGames('2025-26', 'Regular Season'), /NBA unavailable/);
});
