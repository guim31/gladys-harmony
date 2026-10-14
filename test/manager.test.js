// -----------------------------------------------------------------------------
// The hub manager against simulated hubs and the SDK's fake Gladys: search,
// real-time states, scene events, reconnection, commands, persistence.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ACTIVITY, DEVICE, createHub } from './helpers/fakeHub.js';
import { createDevices, createWorld, deviceOf, featureOf, ids, settle } from './helpers/world.js';

const hubFeature = (world, hub, key) => ids.hub(world, hub).feature(key);
const runningOf = (world, hub, activityId) =>
  world.gladys.fake.lastState(ids.activity(world, hub, activityId).feature('running'));

async function waitFor(check, what) {
  for (let round = 0; round < 500; round += 1) {
    if (check()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
  assert.fail(`timed out waiting for ${what}`);
}

test('a hub found by the SSDP search is published, connected and remembered under /data', async () => {
  const world = await createWorld();
  const { fake } = world.gladys;
  assert.deepEqual(fake.scans, [{ type: 'ssdp', timeout_seconds: 5 }]);
  assert.equal(fake.discoveredDevices.length, 8);
  assert.deepEqual(fake.connectionStatus, { connected: true });
  // Nothing is created yet in Gladys: no state sent for nothing.
  assert.deepEqual(fake.states, []);
  await world.app.stop();
  const saved = JSON.parse(await readFile(join(world.dataDir, 'harmony-state.json'), 'utf8'));
  assert.deepEqual(Object.keys(saved.hubs), ['12345678']);
  assert.equal(saved.hubs['12345678'].host, '192.0.2.40');
  assert.equal(saved.hubs['12345678'].model.activities.length, 4);
  // The Logitech account of the provisioning answer is never stored.
  assert.doesNotMatch(JSON.stringify(saved), /owner@example\.com|9876543/);
});

test('a typed address works without the SSDP search, which the report says is unavailable', async () => {
  const world = await createWorld({
    ssdp: false,
    config: { hosts: '192.0.2.40, 192.0.2.77, 999' },
  });
  const { fake } = world.gladys;
  assert.equal(fake.discoveredDevices.length, 8);
  const { data } = await fake.action('search');
  assert.match(
    data.message.en,
    /^1 hub\(s\), 1 answering: Harmony Living Room \(192\.0\.2\.40, 4 activities, 3 devices, connected\)\./,
  );
  assert.match(data.message.en, /network search through Gladys is unavailable/);
  assert.match(data.message.en, /No hub answers at: 192\.0\.2\.77\./);
  assert.match(data.message.en, /Ignored addresses: 999\./);
  assert.match(data.message.fr, /Aucun hub ne répond à : 192\.0\.2\.77\./);
  await world.app.stop();
});

test('no hub at all: Gladys says so, in every language', async () => {
  const world = await createWorld({ hubs: [] });
  const { fake } = world.gladys;
  assert.equal(fake.connectionStatus.connected, false);
  assert.match(fake.connectionStatus.message.fr, /Aucun Harmony Hub trouvé/);
  assert.deepEqual(fake.discoveredDevices, []);
  const { data } = await fake.action('search');
  assert.equal(data.message.de, 'Kein Harmony Hub gefunden.');
  await world.app.stop();
});

test('an activity started from the remote updates the states and fires the trigger', async () => {
  const world = await createWorld();
  await createDevices(world);
  const [hub] = world.hubs;
  const { fake } = world.gladys;
  assert.equal(fake.lastState(hubFeature(world, hub, 'current_activity')), 'Éteint');
  assert.equal(fake.lastState(hubFeature(world, hub, 'activity')), ACTIVITY.OFF);
  assert.equal(runningOf(world, hub, ACTIVITY.WATCH_TV), 0);

  await hub.pressActivityButton(ACTIVITY.WATCH_TV);
  await settle(world.manager);
  assert.equal(fake.lastState(hubFeature(world, hub, 'current_activity')), 'Watch TV');
  assert.equal(fake.lastState(hubFeature(world, hub, 'activity')), ACTIVITY.WATCH_TV);
  assert.equal(runningOf(world, hub, ACTIVITY.WATCH_TV), 1);
  assert.deepEqual(fake.sceneEvents, [
    {
      key: 'activity_started',
      data: {
        hub: ids.hub(world, hub).device,
        hub_name: 'Harmony Living Room',
        previous_activity_name: 'Éteint',
        activity: ids.activity(world, hub, ACTIVITY.WATCH_TV).device,
        activity_name: 'Watch TV',
      },
    },
  ]);
  assert.ok(fake.widgetRefreshes.includes('harmony'));

  // The starting digest, the "finished" notification and the started digest:
  // one change, one event, one state per feature.
  const watchTvStates = fake.states.filter(
    (state) => state.device_feature_external_id === hubFeature(world, hub, 'activity'),
  );
  assert.deepEqual(
    watchTvStates.map((state) => state.text),
    [ACTIVITY.OFF, ACTIVITY.WATCH_TV],
  );

  await hub.pressActivityButton(ACTIVITY.OFF);
  await settle(world.manager);
  assert.equal(runningOf(world, hub, ACTIVITY.WATCH_TV), 0);
  assert.deepEqual(fake.sceneEvents[1], {
    key: 'powered_off',
    data: {
      hub: ids.hub(world, hub).device,
      hub_name: 'Harmony Living Room',
      previous_activity_name: 'Watch TV',
    },
  });
  await world.app.stop();
});

test('no scene event for what the first read or a reconnection finds', async () => {
  const hub = createHub({ current: ACTIVITY.MUSIC });
  const world = await createWorld({ hubs: [hub] });
  await createDevices(world);
  const { fake } = world.gladys;
  assert.equal(fake.lastState(hubFeature(world, hub, 'current_activity')), 'Listen to Music');

  // Changed while the link was down: published when it is back, but late,
  // so no scene runs on it.
  hub.unplug();
  await settle(world.manager);
  hub.current = ACTIVITY.XBOX;
  hub.plugIn();
  await waitFor(
    () => fake.lastState(hubFeature(world, hub, 'activity')) === ACTIVITY.XBOX,
    'the catch-up',
  );
  assert.deepEqual(fake.sceneEvents, []);
  await world.app.stop();
});

test('two scenes starting each other forever: the scene events pause', async () => {
  let clock = 1_000_000;
  const world = await createWorld({ now: () => clock });
  const [hub] = world.hubs;
  const sequence = [ACTIVITY.WATCH_TV, ACTIVITY.MUSIC];
  for (let round = 0; round < 10; round += 1) {
    await hub.pressActivityButton(sequence[round % 2]);
    await settle(world.manager);
    clock += 1_000;
  }
  assert.equal(world.gladys.fake.sceneEvents.length, 6);
  // A minute later, the events come back.
  clock += 60_000;
  await hub.pressActivityButton(ACTIVITY.OFF);
  await settle(world.manager);
  assert.equal(world.gladys.fake.sceneEvents.length, 7);
  await world.app.stop();
});

test('an activity added in the Harmony app appears in the Discovery list', async () => {
  const world = await createWorld();
  const [hub] = world.hubs;
  await hub.addActivity('Watch Netflix', '30197799');
  await settle(world.manager);
  const names = world.gladys.fake.discoveredDevices.map((device) => device.name);
  assert.ok(names.includes('Harmony Living Room · Watch Netflix'));
  // Read once, after the hub finished syncing with the cloud.
  assert.equal(hub.received('config').length, 2);
  const [hubDevice] = world.gladys.fake.discoveredDevices;
  assert.ok(featureOf(hubDevice, 'activity').supported_options.some((o) => o.value === '30197799'));
  await world.app.stop();
});

test('an activity the configuration does not know yet makes it read again', async () => {
  const world = await createWorld();
  const [hub] = world.hubs;
  hub.config.activity.unshift({ id: '30197800', label: 'Morning News', activityOrder: 9 });
  await hub.pressActivityButton('30197800');
  await settle(world.manager);
  const names = world.gladys.fake.discoveredDevices.map((device) => device.name);
  assert.ok(names.includes('Harmony Living Room · Morning News'));
  await world.app.stop();
});

test('a hub that changed address (DHCP) is followed, the devices keep their ids', async () => {
  const world = await createWorld();
  await createDevices(world);
  const [hub] = world.hubs;
  const before = world.gladys.fake.discoveredDevices.map((device) => device.external_id);
  hub.unplug();
  hub.host = '192.0.2.41';
  hub.plugIn();
  world.gladys.fake.scanResults.ssdp = world.network.ssdpResults();
  await world.gladys.fake.scanRequest();
  await settle(world.manager);
  const after = world.gladys.fake.discoveredDevices;
  assert.deepEqual(
    after.map((device) => device.external_id),
    before,
  );
  assert.deepEqual(after[0].params, [{ name: 'HOST', value: '192.0.2.41' }]);
  await waitFor(() => world.manager.hubs.get('12345678').reachable, 'the new link');
  await hub.pressActivityButton(ACTIVITY.XBOX);
  await settle(world.manager);
  assert.equal(world.gladys.fake.lastState(hubFeature(world, hub, 'activity')), ACTIVITY.XBOX);
  await world.app.stop();
});

test('after a restart with the hub off, its devices stay listed from /data', async () => {
  const first = await createWorld();
  await first.app.stop();
  const [hub] = first.hubs;
  hub.unplug();

  const world = await createWorld({
    hubs: [hub],
    dataDir: first.dataDir,
    gladysDevices: first.gladys.fake.discoveredDevices,
  });
  const { fake } = world.gladys;
  assert.equal(fake.discoveredDevices.length, 8);
  assert.equal(fake.connectionStatus.connected, false);
  assert.match(fake.connectionStatus.message.en, /No Harmony Hub answers/);
  assert.ok(fake.transports.length > 0);
  assert.ok(fake.transports.every((entry) => entry.transport === 'unreachable'));

  hub.plugIn();
  await waitFor(() => fake.connectionStatus.connected, 'the hub back');
  await settle(world.manager);
  assert.equal(fake.transports.at(-1).transport, 'local');
  assert.equal(fake.lastState(hubFeature(world, hub, 'current_activity')), 'Éteint');
  await world.app.stop();
});

test('a lost hub is reported, then followed again when it is back', async () => {
  const world = await createWorld();
  await createDevices(world);
  const [hub] = world.hubs;
  const { fake } = world.gladys;
  hub.unplug();
  await settle(world.manager);
  assert.equal(fake.connectionStatus.connected, false);
  assert.equal(fake.transports.at(-1).transport, 'unreachable');
  hub.plugIn();
  await waitFor(() => fake.connectionStatus.connected, 'the reconnection');
  await settle(world.manager);
  await hub.pressActivityButton(ACTIVITY.MUSIC);
  await settle(world.manager);
  assert.equal(runningOf(world, hub, ACTIVITY.MUSIC), 1);
  await world.app.stop();
});

test('a device added in Gladys gets its states at once', async () => {
  const world = await createWorld({ hubs: [createHub({ current: ACTIVITY.WATCH_TV })] });
  const [hub] = world.hubs;
  const { fake } = world.gladys;
  assert.equal(fake.states.length, 0);
  await createDevices(world, (device) => device.external_id === ids.hub(world, hub).device);
  assert.equal(fake.lastState(hubFeature(world, hub, 'current_activity')), 'Watch TV');
  // Only the created device: the activity devices are not added yet.
  assert.equal(runningOf(world, hub, ACTIVITY.WATCH_TV), undefined);
  await createDevices(world, (device) => device.name.endsWith('Watch TV'));
  assert.equal(runningOf(world, hub, ACTIVITY.WATCH_TV), 1);
  await world.app.stop();
});

test('commands from Gladys: the activity list, an activity switch, the command list, a remote key', async () => {
  const world = await createWorld();
  await createDevices(world);
  const [hub] = world.hubs;
  const { fake } = world.gladys;
  const hubDevice = deviceOf(world, ids.hub(world, hub).device);

  assert.deepEqual(
    await fake.setValue(hubDevice, featureOf(hubDevice, 'activity'), ACTIVITY.MUSIC),
    {
      success: true,
    },
  );
  assert.equal(hub.current, ACTIVITY.MUSIC);
  assert.equal(fake.lastState(hubFeature(world, hub, 'current_activity')), 'Listen to Music');
  // A start from Gladys is still a start: the trigger fires (dim the lights).
  assert.equal(fake.sceneEvents.at(-1).key, 'activity_started');

  const xbox = deviceOf(world, ids.activity(world, hub, ACTIVITY.XBOX).device);
  await fake.setValue(xbox, featureOf(xbox, 'running'), 1);
  assert.equal(hub.current, ACTIVITY.XBOX);
  // Turning off an activity that does not run changes nothing.
  const tvActivity = deviceOf(world, ids.activity(world, hub, ACTIVITY.WATCH_TV).device);
  await fake.setValue(tvActivity, featureOf(tvActivity, 'running'), 0);
  assert.equal(hub.current, ACTIVITY.XBOX);
  assert.equal(runningOf(world, hub, ACTIVITY.WATCH_TV), 0);
  await fake.setValue(xbox, featureOf(xbox, 'running'), 0);
  assert.equal(hub.current, ACTIVITY.OFF);

  const avr = deviceOf(world, ids.appliance(world, hub, DEVICE.AVR).device);
  await fake.setValue(avr, featureOf(avr, 'command'), 'InputGame');
  const tv = deviceOf(world, ids.appliance(world, hub, DEVICE.TV).device);
  await fake.setValue(tv, featureOf(tv, 'return'), 1);
  assert.deepEqual(
    hub.commands.map(({ deviceId, command, status }) => `${deviceId} ${command} ${status}`),
    [
      `${DEVICE.AVR} InputGame press`,
      `${DEVICE.AVR} InputGame release`,
      `${DEVICE.TV} Return press`,
      `${DEVICE.TV} Return release`,
    ],
  );
  // Starting the activity that already runs sends nothing.
  await fake.setValue(hubDevice, featureOf(hubDevice, 'activity'), ACTIVITY.OFF);
  assert.equal(hub.received('runactivity').length, 3);
  await world.app.stop();
});

test('a command Gladys cannot run fails with a message in the configured language', async () => {
  const world = await createWorld({ config: { language: 'es' } });
  await createDevices(world);
  const [hub] = world.hubs;
  const { fake } = world.gladys;
  const hubDevice = deviceOf(world, ids.hub(world, hub).device);
  const ack = await fake.setValue(hubDevice, featureOf(hubDevice, 'activity'), '42');
  assert.deepEqual(ack, { success: false, error: 'Actividad desconocida: 42.' });

  const avr = deviceOf(world, ids.appliance(world, hub, DEVICE.AVR).device);
  const unknown = await fake.setValue(avr, featureOf(avr, 'command'), 'Eject');
  assert.equal(unknown.error, 'Denon AV Receiver no tiene el comando «Eject».');

  hub.unplug();
  await settle(world.manager);
  const offline = await fake.setValue(avr, featureOf(avr, 'command'), 'Mute');
  assert.equal(offline.error, 'Harmony Living Room no responde.');

  const stranger = await fake.setValue(
    { external_id: 'ext:test-integration:device:999-1', features: [] },
    { external_id: 'ext:test-integration:device:999-1:command' },
    'Mute',
  );
  assert.match(stranger.error, /^Dispositivo Harmony desconocido/);
  await world.app.stop();
});

test('without any Gladys poll, the timer keeps the states fresh (a missed notification)', async (t) => {
  const world = await createWorld({ timers: true, timings: { refreshMs: 20 } });
  await createDevices(world);
  const [hub] = world.hubs;
  const { fake } = world.gladys;
  const onPoll = t.mock.fn();
  world.gladys.onPoll(onPoll);
  // The activity changes without a word on the WebSocket.
  hub.current = ACTIVITY.APPLE_TV;
  await waitFor(
    () => fake.lastState(hubFeature(world, hub, 'activity')) === ACTIVITY.APPLE_TV,
    'the timer',
  );
  assert.equal(runningOf(world, hub, ACTIVITY.APPLE_TV), 1);
  assert.equal(onPoll.mock.callCount(), 0);
  // Seen by the timer while connected: a live change, the trigger fires.
  assert.equal(fake.sceneEvents.at(-1).data.activity_name, 'Watch Apple TV');
  assert.ok(hub.received('getCurrentActivity').length >= 2);
  await world.app.stop();
});

test("Gladys' poll is a fallback, skipped right after the timer read", async () => {
  let clock = 1_000_000;
  const world = await createWorld({ now: () => clock });
  await createDevices(world);
  const [hub] = world.hubs;
  const hubDevice = deviceOf(world, ids.hub(world, hub).device);
  const reads = () => hub.received('getCurrentActivity').length;
  const before = reads();
  await world.gladys.fake.poll(hubDevice);
  assert.equal(reads(), before);
  clock += 60_000;
  hub.current = ACTIVITY.MUSIC;
  assert.deepEqual(await world.gladys.fake.poll(hubDevice), { success: true });
  assert.equal(reads(), before + 1);
  assert.equal(world.gladys.fake.lastState(hubFeature(world, hub, 'activity')), ACTIVITY.MUSIC);
  await world.app.stop();
});

test('states are deduplicated by the SDK, with a heartbeat under 12 hours', async (t) => {
  const world = await createWorld();
  await createDevices(world);
  const spy = t.mock.method(world.gladys, 'publishChangedStates');
  const [hub] = world.hubs;
  await world.manager.refresh(world.manager.hubs.get(hub.remoteId));
  const [, options] = spy.mock.calls.at(-1).arguments;
  assert.ok(options.heartbeat > 0 && options.heartbeat <= 12 * 3_600_000);
  const sent = world.gladys.fake.states.length;
  await world.manager.refresh(world.manager.hubs.get(hub.remoteId));
  assert.equal(world.gladys.fake.states.length, sent, 'an unchanged state is not sent again');
  await world.app.stop();
});

test('Gladys restarted: the devices and states are sent again', async () => {
  const world = await createWorld();
  await createDevices(world);
  const { fake } = world.gladys;
  const before = fake.states.length;
  const publications = fake.requests.filter((r) => r.path === '/discovered_device').length;
  await world.gladys.disconnect();
  await world.gladys.connect();
  await settle(world.manager);
  assert.equal(
    fake.requests.filter((r) => r.path === '/discovered_device').length,
    publications + 1,
  );
  assert.ok(fake.states.length > before);
  await world.app.stop();
});

test('a new language renames the "Off" choice; new addresses start a search', async () => {
  const world = await createWorld({
    ssdp: false,
    hubs: [createHub(), createHub({ host: '192.0.2.50', remoteId: '777', name: 'Bedroom' })],
  });
  const { fake } = world.gladys;
  assert.equal(fake.discoveredDevices.length, 0);
  await fake.configUpdated({ hosts: '192.0.2.40', language: 'fr' });
  await settle(world.manager);
  const off = () => featureOf(fake.discoveredDevices[0], 'activity').supported_options.at(-1).label;
  assert.equal(off(), 'Éteint');
  await fake.configUpdated({ hosts: '192.0.2.40', language: 'de' });
  await settle(world.manager);
  assert.equal(off(), 'Aus');
  await fake.configUpdated({ hosts: '192.0.2.40, 192.0.2.50', language: 'de' });
  await settle(world.manager);
  assert.ok(fake.discoveredDevices.some((device) => device.name === 'Harmony Bedroom'));
  await world.app.stop();
});

test('a hub gone for 30 days is forgotten, unless its address is typed', async () => {
  let clock = 1_000_000;
  const world = await createWorld({ now: () => clock });
  const [hub] = world.hubs;
  hub.unplug();
  await settle(world.manager);
  clock += 29 * 24 * 3_600_000;
  await world.manager.rediscover();
  assert.equal(world.manager.hubs.size, 1);
  clock += 2 * 24 * 3_600_000;
  await world.manager.rediscover();
  assert.equal(world.manager.hubs.size, 0);
  assert.equal(world.gladys.fake.discoveredDevices.length, 0);
  await world.app.stop();
});
