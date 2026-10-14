import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import {
  NAMES,
  REMOTE_KEYS,
  activityLabel,
  buildHubDevices,
  hubName,
  hubStates,
} from '../src/devices.js';
import { parseConfig } from '../src/harmony/model.js';
import { ACTIVITY, readFixture } from './helpers/fakeHub.js';

const gladys = createFakeGladys();

function hub(overrides = {}) {
  return {
    remoteId: '12345678',
    host: '192.0.2.40',
    name: 'Living Room',
    current: ACTIVITY.OFF,
    model: parseConfig(readFixture('hub-config.json')),
    ...overrides,
  };
}

const byName = (devices, name) => devices.find((device) => device.name === name);

test('a hub gives the hub, one device per activity and one per controllable appliance', () => {
  const devices = buildHubDevices(gladys, hub(), 'en');
  assert.deepEqual(
    devices.map((device) => device.name),
    [
      'Harmony Living Room',
      'Harmony Living Room · Watch TV',
      'Harmony Living Room · Watch Apple TV',
      'Harmony Living Room · Listen to Music',
      'Harmony Living Room · Play Xbox',
      'Harmony Living Room · Samsung TV',
      'Harmony Living Room · Denon AV Receiver',
      'Harmony Living Room · Apple TV',
    ],
  );
  // The smart plug has no usable command: no device.
  assert.equal(byName(devices, 'Harmony Living Room · Smart Plug'), undefined);
  for (const device of devices) {
    assert.equal(device.should_poll, false);
    assert.equal(device.poll_frequency, undefined);
  }
});

test('the external ids come from the hub id and the ids of the hub, never from a label', () => {
  const devices = buildHubDevices(gladys, hub({ name: 'Renamed' }), 'fr');
  assert.deepEqual(
    devices.map((device) => device.external_id),
    [
      'ext:test-integration:hub:12345678',
      'ext:test-integration:activity:12345678-30197730',
      'ext:test-integration:activity:12345678-30197731',
      'ext:test-integration:activity:12345678-30197732',
      'ext:test-integration:activity:12345678-30197733',
      'ext:test-integration:device:12345678-38343689',
      'ext:test-integration:device:12345678-38343690',
      'ext:test-integration:device:12345678-38343691',
    ],
  );
});

test('the hub offers its activities then "Off" in the activity list', () => {
  const [hubDevice] = buildHubDevices(gladys, hub(), 'fr');
  const [current, choice] = hubDevice.features;
  assert.equal(current.name, 'Activité en cours');
  assert.equal(current.read_only, true);
  assert.equal(choice.name, 'Activité');
  assert.equal(choice.type, 'select');
  assert.deepEqual(choice.supported_options, [
    { value: '30197730', label: 'Watch TV' },
    { value: '30197731', label: 'Watch Apple TV' },
    { value: '30197732', label: 'Listen to Music' },
    { value: '30197733', label: 'Play Xbox' },
    { value: '-1', label: 'Éteint' },
  ]);
  assert.deepEqual(hubDevice.params, [{ name: 'HOST', value: '192.0.2.40' }]);
});

test('an appliance lists all its commands, and gets push buttons for the usual keys it has', () => {
  const devices = buildHubDevices(gladys, hub(), 'en');
  const avr = byName(devices, 'Harmony Living Room · Denon AV Receiver');
  const [command, ...keys] = avr.features;
  assert.equal(command.type, 'select');
  assert.equal(command.supported_options.length, 12);
  assert.deepEqual(command.supported_options[0], { value: 'PowerOff', label: 'Power Off' });
  assert.deepEqual(
    keys.map((feature) => [feature.category, feature.type, feature.name]),
    [
      ['television', 'volume-up', 'Volume up'],
      ['television', 'volume-down', 'Volume down'],
      ['television', 'volume-mute', 'Mute'],
    ],
  );
  const appleTv = byName(devices, 'Harmony Living Room · Apple TV');
  assert.deepEqual(
    appleTv.features.slice(1).map((feature) => feature.type),
    [
      'up',
      'down',
      'left',
      'right',
      'enter',
      'menu',
      'play',
      'pause',
      'rewind',
      'forward',
      'previous',
      'next',
    ],
  );
});

test('states: the current activity in words and by id, and the running activity switched on', () => {
  const states = hubStates(gladys, hub({ current: ACTIVITY.MUSIC }), 'de');
  const value = (suffix) => states.find((state) => state.id.endsWith(suffix)).value;
  assert.deepEqual(value(':current_activity'), { text: 'Listen to Music' });
  assert.deepEqual(value(':activity'), { text: ACTIVITY.MUSIC });
  assert.equal(value('12345678-30197732:running'), 1);
  assert.equal(value('12345678-30197730:running'), 0);
  assert.deepEqual(
    hubStates(gladys, hub({ current: ACTIVITY.OFF }), 'de').find((state) =>
      state.id.endsWith(':current_activity'),
    ).value,
    { text: 'Aus' },
  );
  assert.deepEqual(hubStates(gladys, hub({ current: null }), 'en'), []);
});

test('an activity unknown to the configuration shows its id until it is read again', () => {
  assert.equal(activityLabel(hub(), '999', 'en'), '#999');
});

test('a hub is named after its name in the app, with Harmony in front of a room name', () => {
  assert.equal(hubName({ name: 'Living Room' }), 'Harmony Living Room');
  assert.equal(hubName({ name: 'Harmony Hub' }), 'Harmony Hub');
  assert.equal(hubName({ name: 'Salon harmony' }), 'Salon harmony');
  assert.equal(hubName({ name: null }), 'Harmony Hub');
  assert.equal(hubName({ name: '  ' }), 'Harmony Hub');
});

test('every remote key has a name in every language, and the names of a device stay distinct', () => {
  for (const language of Object.keys(NAMES)) {
    const names = REMOTE_KEYS.map((key) => NAMES[language][key.type]);
    assert.ok(names.every(Boolean), language);
    assert.equal(new Set(names).size, names.length, `${language}: duplicate remote key name`);
    assert.ok(!names.includes(NAMES[language].command), `${language}: a key named like the list`);
  }
});
