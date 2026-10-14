// -----------------------------------------------------------------------------
// Conformity with the Gladys core, on every device discovered from realistic
// fixtures: one hub, two hubs, aioharmony's minimal configuration, in every
// feature-name language.
//
// The table (test/fixtures/gladys-feature-table.json) is extracted from the
// core code: a category/type couple missing there shows as "undefined" or
// without icon in Gladys, a poll frequency outside its list is a 400 on
// discovery, a feature without min/max is a 422 on "Add to Gladys".
// Do not loosen this test to make it pass: fix the integration.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHub, readFixture } from './helpers/fakeHub.js';
import { createWorld } from './helpers/world.js';

const table = JSON.parse(
  await readFile(new URL('./fixtures/gladys-feature-table.json', import.meta.url), 'utf8'),
);

const twoHubs = () => [
  createHub(),
  createHub({ host: '192.0.2.50', remoteId: '87654321', name: 'Bedroom' }),
];

const scenarios = [
  { label: 'one hub, French names', hubs: () => [createHub()], config: {}, minimum: 8 },
  {
    label: 'one hub, English names',
    hubs: () => [createHub()],
    config: { language: 'en' },
    minimum: 8,
  },
  { label: 'two hubs, German names', hubs: twoHubs, config: { language: 'de' }, minimum: 16 },
  { label: 'two hubs, Spanish names', hubs: twoHubs, config: { language: 'es' }, minimum: 16 },
  {
    label: "aioharmony's minimal configuration",
    hubs: () => [createHub({ config: readFixture('aioharmony-config.json') })],
    config: {},
    minimum: 4,
  },
];

for (const scenario of scenarios) {
  test(`every discovered device follows the Gladys rules (${scenario.label})`, async () => {
    const world = await createWorld({ hubs: scenario.hubs(), config: scenario.config });
    try {
      const devices = world.gladys.fake.discoveredDevices;
      assert.ok(
        devices.length >= scenario.minimum,
        `expected the fixture devices, got ${devices.length}`,
      );

      const deviceIds = new Set();
      const deviceNames = new Set();
      for (const device of devices) {
        const where = device.name;
        assert.ok(!deviceIds.has(device.external_id), `${where}: duplicate device external_id`);
        deviceIds.add(device.external_id);
        assert.ok(!deviceNames.has(device.name), `${where}: duplicate device name`);
        deviceNames.add(device.name);

        // should_poll: true if and only if poll_frequency is provided, in ms.
        if (device.poll_frequency === undefined) {
          assert.notEqual(device.should_poll, true, `${where}: should_poll without poll_frequency`);
        } else {
          assert.equal(device.should_poll, true, `${where}: poll_frequency without should_poll`);
          assert.ok(
            table.poll_frequencies_ms.includes(device.poll_frequency),
            `${where}: poll_frequency ${device.poll_frequency} is not one of ${table.poll_frequencies_ms}`,
          );
        }

        assert.ok(device.features.length > 0, `${where}: no feature`);
        const externalIds = new Set();
        const names = new Set();
        for (const feature of device.features) {
          const at = `${where} / ${feature.name}`;
          const pair = table.pairs[`${feature.category}/${feature.type}`];
          assert.ok(
            pair,
            `${at}: ${feature.category}/${feature.type} is not a couple Gladys knows`,
          );
          assert.ok(
            pair.label_en && pair.label_fr && pair.icon,
            `${at}: couple without label or icon`,
          );

          assert.equal(typeof feature.min, 'number', `${at}: min must be a number`);
          assert.equal(typeof feature.max, 'number', `${at}: max must be a number`);
          assert.ok(
            Number.isFinite(feature.min) && Number.isFinite(feature.max),
            `${at}: finite min/max`,
          );
          assert.ok(feature.min <= feature.max, `${at}: min > max`);
          assert.equal(typeof feature.read_only, 'boolean', `${at}: read_only must be a boolean`);
          assert.equal(
            typeof feature.has_feedback,
            'boolean',
            `${at}: has_feedback must be a boolean`,
          );
          if (feature.unit !== undefined) {
            assert.ok(table.units.includes(feature.unit), `${at}: unknown unit ${feature.unit}`);
          }

          assert.ok(!externalIds.has(feature.external_id), `${at}: duplicate external_id`);
          externalIds.add(feature.external_id);
          assert.ok(!names.has(feature.name), `${at}: duplicate feature name on the device`);
          names.add(feature.name);

          if (feature.supported_options !== undefined) {
            // Only a text/select may carry string values (the core refuses
            // them anywhere else), each value once, each with a label.
            assert.equal(`${feature.category}/${feature.type}`, 'text/select', `${at}: options`);
            const values = feature.supported_options.map((option) => String(option.value));
            assert.equal(new Set(values).size, values.length, `${at}: duplicate option value`);
            for (const option of feature.supported_options) {
              assert.ok(String(option.value).trim() !== '', `${at}: empty option value`);
              assert.ok(String(option.label).trim() !== '', `${at}: empty option label`);
            }
          }
        }
      }
    } finally {
      await world.app.stop();
    }
  });
}
