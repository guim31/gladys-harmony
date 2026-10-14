import { test } from 'node:test';
import assert from 'node:assert/strict';
import { COMMON_COMMANDS, DELAY_BOUNDS, REPEAT_BOUNDS } from '../src/scenes.js';
import { ACTIVITY, DEVICE, createHub } from './helpers/fakeHub.js';
import { createDevices, createWorld, ids } from './helpers/world.js';

test('"Start a Harmony activity" waits for the hub, then the states follow', async () => {
  const world = await createWorld();
  await createDevices(world);
  const [hub] = world.hubs;
  const { fake } = world.gladys;
  const ack = await fake.sceneAction('start_activity', {
    activity: ids.activity(world, hub, ACTIVITY.APPLE_TV).device,
  });
  assert.deepEqual(ack, { success: true });
  assert.equal(hub.current, ACTIVITY.APPLE_TV);
  assert.equal(fake.lastState(ids.hub(world, hub).feature('current_activity')), 'Watch Apple TV');
  await world.app.stop();
});

test('"Start a Harmony activity" refuses a device that is not an activity', async () => {
  const world = await createWorld({ config: { language: 'en' } });
  const [hub] = world.hubs;
  const ack = await world.gladys.fake.sceneAction('start_activity', {
    activity: ids.appliance(world, hub, DEVICE.TV).device,
  });
  assert.deepEqual(ack, { success: false, error: 'Samsung TV is not a Harmony activity.' });
  const unknown = await world.gladys.fake.sceneAction('start_activity', {
    activity: 'ext:test-integration:activity:1-2',
  });
  assert.match(unknown.error, /^Unknown Harmony device/);
  await world.app.stop();
});

test('"Turn everything off" takes the hub, or any of its devices', async () => {
  const world = await createWorld({ hubs: [createHub({ current: ACTIVITY.WATCH_TV })] });
  const [hub] = world.hubs;
  const { fake } = world.gladys;
  await fake.sceneAction('power_off', { hub: ids.appliance(world, hub, DEVICE.AVR).device });
  assert.equal(hub.current, ACTIVITY.OFF);
  hub.current = ACTIVITY.MUSIC;
  await world.manager.refresh(world.manager.hubs.get(hub.remoteId));
  await fake.sceneAction('power_off', { hub: ids.hub(world, hub).device });
  assert.equal(hub.current, ACTIVITY.OFF);
  // Already off: nothing is sent.
  const runs = hub.received('runactivity').length;
  assert.deepEqual(await fake.sceneAction('power_off', { hub: ids.hub(world, hub).device }), {
    success: true,
  });
  assert.equal(hub.received('runactivity').length, runs);
  await world.app.stop();
});

test('"Send a Harmony command": from the list, repeated with a delay', async () => {
  const world = await createWorld();
  const [hub] = world.hubs;
  const started = Date.now();
  const ack = await world.gladys.fake.sceneAction('send_command', {
    device: ids.appliance(world, hub, DEVICE.AVR).device,
    command: 'VolumeUp',
    repeat: 3,
    delay_ms: 20,
  });
  assert.deepEqual(ack, { success: true });
  assert.deepEqual(
    hub.commands.map(({ command, status }) => `${command} ${status}`),
    ['press', 'release', 'press', 'release', 'press', 'release'].map((s) => `VolumeUp ${s}`),
  );
  assert.ok(Date.now() - started >= 40);
  await world.app.stop();
});

test('"Send a Harmony command": a typed command wins over the list, by name or label', async () => {
  const world = await createWorld();
  const [hub] = world.hubs;
  await world.gladys.fake.sceneAction('send_command', {
    device: ids.appliance(world, hub, DEVICE.TV).device,
    command: 'Mute',
    custom_command: ' Input Hdmi2 ',
  });
  assert.deepEqual(
    hub.commands.map((c) => c.command),
    ['InputHdmi2', 'InputHdmi2'],
  );
  await world.app.stop();
});

test('"Send a Harmony command": the errors say what is wrong', async () => {
  const world = await createWorld({ config: { language: 'fr' } });
  const [hub] = world.hubs;
  const { fake } = world.gladys;
  const avr = ids.appliance(world, hub, DEVICE.AVR).device;
  assert.equal(
    (await fake.sceneAction('send_command', { device: avr })).error,
    'Choisissez une commande, ou saisissez-en une.',
  );
  assert.equal(
    (await fake.sceneAction('send_command', { device: avr, command: 'ChannelUp' })).error,
    "Denon AV Receiver n'a pas de commande « ChannelUp ».",
  );
  assert.equal(
    (
      await fake.sceneAction('send_command', {
        device: ids.activity(world, hub, ACTIVITY.XBOX).device,
        command: 'Mute',
      })
    ).error,
    "Play Xbox n'est pas un appareil piloté par un Harmony Hub.",
  );
  hub.refusals.set('vnd.logitech.harmony/vnd.logitech.harmony.engine?holdAction', {
    code: 503,
    msg: 'Busy',
  });
  assert.equal(
    (await fake.sceneAction('send_command', { device: avr, command: 'Mute' })).error,
    'Mute a échoué : Mute refused (503 Busy).',
  );
  await world.app.stop();
});

test('out-of-range repeats and delays are brought back within bounds', async () => {
  const world = await createWorld();
  const [hub] = world.hubs;
  await world.gladys.fake.sceneAction('send_command', {
    device: ids.appliance(world, hub, DEVICE.AVR).device,
    command: 'Mute',
    repeat: 0,
    delay_ms: -5,
  });
  assert.equal(hub.commands.length, 2);
  assert.deepEqual(REPEAT_BOUNDS, { min: 1, max: 20, default: 1 });
  assert.deepEqual(DELAY_BOUNDS, { min: 0, max: 5000, default: 400 });
  await world.app.stop();
});

test('the usual commands of the list are distinct Logitech command names', () => {
  const values = COMMON_COMMANDS.map((command) => command.value);
  assert.equal(new Set(values).size, values.length);
  for (const command of COMMON_COMMANDS) {
    assert.match(command.value, /^[A-Z][A-Za-z]+$/);
  }
});
