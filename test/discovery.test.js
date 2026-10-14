import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hubAddresses, mapLimit, parseSsdpHeaders } from '../src/discovery.js';
import { readFixture } from './helpers/fakeHub.js';

test('only the answers naming the Harmony device type are kept, once per address', () => {
  assert.deepEqual(hubAddresses(readFixture('ssdp-results.json')), ['192.0.2.40']);
  assert.deepEqual(hubAddresses(null), []);
  assert.deepEqual(hubAddresses([{ source_ip: '192.0.2.9' }]), []);
});

test('SSDP headers are read case-insensitively, the first value wins', () => {
  assert.deepEqual(
    parseSsdpHeaders('HTTP/1.1 200 OK\r\nST: a\r\nst: b\r\nLocation: http://x/\r\n'),
    {
      st: 'a',
      location: 'http://x/',
    },
  );
});

test('mapLimit runs at most `limit` tasks at a time and keeps the order', async () => {
  let running = 0;
  let peak = 0;
  const results = await mapLimit([1, 2, 3, 4, 5], 2, async (n) => {
    running += 1;
    peak = Math.max(peak, running);
    await new Promise((resolve) => setImmediate(resolve));
    running -= 1;
    if (n === 3) {
      throw new Error('three');
    }
    return n * 10;
  });
  assert.equal(peak, 2);
  assert.deepEqual(results[0], { value: 10 });
  assert.equal(results[2].error.message, 'three');
  assert.deepEqual(results[4], { value: 50 });
});
