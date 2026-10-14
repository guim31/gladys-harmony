// -----------------------------------------------------------------------------
// Quiet logs: a normal day (reads, notifications, states) writes nothing at
// the info level; the life of a hub (lost, back) is one line each way, not
// one per attempt; and the Logitech account the hub reveals over HTTP never
// reaches the logs, at any level.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ACCOUNT_EMAIL, ACCOUNT_TOKEN, ACTIVITY, DEVICE } from './helpers/fakeHub.js';
import { createDevices, createWorld, deviceOf, featureOf, ids, settle } from './helpers/world.js';

/** The lines the integration writes (the SDK logger writes through console). */
function captureLogs(t, level) {
  const previous = process.env.LOG_LEVEL;
  process.env.LOG_LEVEL = level;
  const lines = [];
  const record = (...args) => lines.push(args.map(String).join(' '));
  t.mock.method(console, 'log', record);
  t.mock.method(console, 'error', record);
  t.after(() => {
    process.env.LOG_LEVEL = previous;
  });
  return lines;
}

async function waitFor(check, what) {
  for (let round = 0; round < 500; round += 1) {
    if (check()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
  assert.fail(`timed out waiting for ${what}`);
}

test('a normal cycle writes nothing at the info level', async (t) => {
  const world = await createWorld({ timers: true, timings: { refreshMs: 10 } });
  await createDevices(world);
  const [hub] = world.hubs;
  const lines = captureLogs(t, 'info');
  // Reads of the timer, notifications, states: nothing to say.
  await hub.pressActivityButton(ACTIVITY.WATCH_TV);
  await settle(world.manager);
  const reads = hub.received('getCurrentActivity').length;
  await waitFor(() => hub.received('getCurrentActivity').length >= reads + 3, 'three reads');
  await hub.pressActivityButton(ACTIVITY.OFF);
  await settle(world.manager);
  await world.manager.poll(deviceOf(world, ids.hub(world, hub).device));
  await world.gladys.fake.widgetGet('harmony');
  await world.app.stop();
  assert.deepEqual(lines, []);
});

test('a user action is one info line; a lost hub one warning, its return one line', async (t) => {
  const world = await createWorld({ clientTimings: { reconnectMinMs: 2, reconnectMaxMs: 4 } });
  await createDevices(world);
  const [hub] = world.hubs;
  const lines = captureLogs(t, 'info');
  const avr = deviceOf(world, ids.appliance(world, hub, DEVICE.AVR).device);
  await world.gladys.fake.setValue(avr, featureOf(avr, 'volume-up'), 1);
  assert.equal(lines.length, 1);
  assert.match(lines[0], /\[INFO\] \[harmony\] Sending VolumeUp to Denon AV Receiver$/);

  hub.unplug();
  // Several reconnection attempts fail while it is unplugged.
  await waitFor(() => world.network.sockets.length === 1 && hub.online === false, 'the loss');
  await new Promise((resolve) => setTimeout(resolve, 40));
  await settle(world.manager);
  hub.plugIn();
  await waitFor(() => world.gladys.fake.connectionStatus.connected, 'the return');
  await settle(world.manager);
  await world.app.stop();
  assert.deepEqual(
    lines.slice(1).map((line) => line.replace(/^\[[^\]]+\] /, '')),
    [
      '[WARN] [harmony] Harmony Living Room (192.0.2.40) unreachable, retrying in the background',
      '[INFO] [harmony] Harmony Living Room (192.0.2.40) answers again',
    ],
  );
});

test('the Logitech account never reaches the logs, even at the debug level', async (t) => {
  const lines = captureLogs(t, 'debug');
  const world = await createWorld();
  await createDevices(world);
  const [hub] = world.hubs;
  await hub.pressActivityButton(ACTIVITY.MUSIC);
  await world.gladys.fake.action('search');
  await settle(world.manager);
  await world.app.stop();
  assert.ok(lines.length >= 5, 'the debug level shows the details');
  const all = lines.join('\n');
  assert.ok(!all.includes(ACCOUNT_EMAIL), 'the account e-mail was logged');
  assert.ok(!all.includes(ACCOUNT_TOKEN), 'the account token was logged');
  assert.ok(!all.includes('9876543'), 'the account id was logged');
});
