import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  findActivity,
  findCommand,
  findDevice,
  parseConfig,
  restoreModel,
} from '../src/harmony/model.js';
import { readFixture } from './helpers/fakeHub.js';

test("aioharmony's configuration: activities, commands from the action JSON, a null action skipped", () => {
  const model = parseConfig(readFixture('aioharmony-config.json'));
  assert.deepEqual(
    model.activities.map(({ id, label }) => ({ id, label })),
    [
      { id: '1', label: 'Watch TV' },
      { id: '2', label: 'Listen Music' },
    ],
  );
  assert.deepEqual(
    model.devices.map((device) => [device.label, device.commands.map((c) => c.name)]),
    [
      ['TV', ['PowerToggle', 'VolumeUp']],
      ['AVR', []],
    ],
  );
});

test('a full configuration: PowerOff and unlabelled activities left out, sorted by activityOrder', () => {
  const raw = readFixture('hub-config.json');
  // The hub does not list them in order.
  raw.activity.reverse();
  const model = parseConfig(raw);
  assert.deepEqual(
    model.activities.map((activity) => activity.label),
    ['Watch TV', 'Watch Apple TV', 'Listen to Music', 'Play Xbox'],
  );
  const tv = findDevice(model, '38343689');
  assert.equal(tv.label, 'Samsung TV');
  assert.equal(tv.manufacturer, 'Samsung');
  assert.equal(tv.model, 'UN55H6350');
  assert.equal(tv.commands.length, 36);
  assert.deepEqual(tv.commands[0], { name: 'PowerOff', label: 'Power Off', group: 'Power' });
  assert.deepEqual(findDevice(model, '38343692').commands, []);
});

test('a broken configuration gives an empty model, never an exception', () => {
  for (const raw of [null, undefined, {}, { activity: 'x', device: 3 }, { activity: [null, 1] }]) {
    assert.deepEqual(parseConfig(raw), { activities: [], devices: [] });
  }
});

test('duplicate commands of a device are kept once', () => {
  const model = parseConfig({
    device: [
      {
        id: '1',
        label: 'TV',
        controlGroup: [
          {
            name: 'A',
            function: [{ name: 'Select', label: 'OK', action: '{"command":"Select"}' }],
          },
          {
            name: 'B',
            function: [{ name: 'Select', label: 'Select', action: '{"command":"Select"}' }],
          },
          { name: 'C', function: [{ name: 'Menu', label: 'Menu' }] },
        ],
      },
    ],
  });
  assert.deepEqual(
    model.devices[0].commands.map((command) => command.name),
    ['Select', 'Menu'],
  );
});

test('activities and commands are found by id, name or label, any case', () => {
  const model = parseConfig(readFixture('hub-config.json'));
  assert.equal(findActivity(model, '30197732').label, 'Listen to Music');
  assert.equal(findActivity(model, ' listen to MUSIC ').id, '30197732');
  assert.equal(findActivity(model, 'Nope'), null);
  assert.equal(findActivity(model, ''), null);
  const avr = findDevice(model, '38343690');
  assert.equal(findCommand(avr, 'VolumeUp').name, 'VolumeUp');
  assert.equal(findCommand(avr, 'volume up').name, 'VolumeUp');
  assert.equal(findCommand(avr, 'Input Media Player').name, 'InputMediaPlayer');
  assert.equal(findCommand(avr, 'ChannelUp'), null);
  assert.equal(findCommand(avr, ''), null);
});

test('a stored model is read back, and a corrupt one is emptied', () => {
  const model = parseConfig(readFixture('hub-config.json'));
  assert.deepEqual(restoreModel(JSON.parse(JSON.stringify(model))), model);
  assert.deepEqual(restoreModel({ activities: [{ id: 1 }], devices: 'x' }), {
    activities: [],
    devices: [],
  });
});
