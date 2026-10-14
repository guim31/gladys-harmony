// -----------------------------------------------------------------------------
// Consistency checks between `gladys-assistant-integration.json` and the code.
// The manifest is validated by the store indexer, but nothing there can know
// which handlers the code actually registers — these tests keep both in sync.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { registerHandlers } from '../src/app.js';
import { DEFAULT_CONFIG } from '../src/config.js';
import { SSDP_SEARCH_TARGET } from '../src/discovery.js';
import { TRIGGERS, WIDGET_KEY } from '../src/manager.js';
import { COMMON_COMMANDS, DELAY_BOUNDS, REPEAT_BOUNDS, SCENE_ACTIONS } from '../src/scenes.js';
import { WIDGETS } from '../src/widgets.js';

const manifest = JSON.parse(
  await readFile(new URL('../gladys-assistant-integration.json', import.meta.url), 'utf8'),
);
const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));

// Every list of form fields the manifest can declare (same field grammar).
const allFields = [
  ...(manifest.config_schema ?? []),
  ...[
    ...(manifest.actions ?? []),
    ...(manifest.scene_triggers ?? []),
    ...(manifest.scene_actions ?? []),
  ].flatMap((item) => item.fields ?? []),
  ...(manifest.widgets ?? []).flatMap((widget) => widget.settings ?? []),
];

const CAPABILITY_FIELDS = ['scene_triggers', 'scene_actions', 'widgets'];
const CAPABILITY_MIN_GLADYS_VERSION = [5, 1, 0];
const CATEGORIES_MIN_GLADYS_VERSION = [4, 86, 0];

const keysOf = (list) => (list ?? []).map((entry) => entry.key);

// Minimum version of the manifest `gladys_version` range, e.g. [5, 1, 0].
function minGladysVersion() {
  const match = manifest.gladys_version.match(/>=\s*(\d+)\.(\d+)\.(\d+)/);
  assert.ok(match, 'gladys_version must declare a minimum version');
  return match.slice(1).map(Number);
}

function isAtLeast(version, required) {
  for (let i = 0; i < required.length; i += 1) {
    if (version[i] !== required[i]) {
      return version[i] > required[i];
    }
  }
  return true;
}

test('the identity of the integration: name, image, category, local transport', () => {
  assert.equal(manifest.name, 'Logitech Harmony Hub');
  assert.equal(manifest.type, 'device');
  assert.deepEqual(manifest.categories, ['multimedia']);
  assert.deepEqual(manifest.transports, ['local']);
  assert.equal(manifest.docker_image, `ghcr.io/guim31/gladys-harmony:${manifest.version}`);
  assert.equal(
    manifest.cover_image,
    'https://raw.githubusercontent.com/guim31/gladys-harmony/main/cover.png',
  );
});

test('every manifest action, scene action and widget has a handler, and vice versa', () => {
  const gladys = createFakeGladys();
  const registered = { actions: [], scenes: [], widgets: [] };
  gladys.onAction = (key) => registered.actions.push(key);
  gladys.onSceneAction = (key) => registered.scenes.push(key);
  gladys.onWidgetGet = (key) => registered.widgets.push(key);
  registerHandlers(gladys, { timers: false });
  assert.deepEqual(registered.actions.sort(), keysOf(manifest.actions).sort());
  assert.deepEqual(registered.scenes.sort(), keysOf(manifest.scene_actions).sort());
  assert.deepEqual(Object.keys(SCENE_ACTIONS).sort(), keysOf(manifest.scene_actions).sort());
  assert.deepEqual(registered.widgets, keysOf(manifest.widgets));
  assert.deepEqual(Object.keys(WIDGETS), [WIDGET_KEY]);
});

test('every scene trigger the code fires is declared, with its filters and variables', () => {
  assert.deepEqual(keysOf(manifest.scene_triggers).sort(), Object.values(TRIGGERS).sort());
  const started = manifest.scene_triggers.find((t) => t.key === TRIGGERS.ACTIVITY_STARTED);
  assert.deepEqual(keysOf(started.fields), ['activity', 'hub']);
  assert.deepEqual(keysOf(started.variables), [
    'activity_name',
    'previous_activity_name',
    'hub_name',
  ]);
  const off = manifest.scene_triggers.find((t) => t.key === TRIGGERS.POWERED_OFF);
  assert.deepEqual(keysOf(off.fields), ['hub']);
  assert.deepEqual(keysOf(off.variables), ['previous_activity_name', 'hub_name']);
  // A filter key is never a variable key: the event value is an external id
  // for the filter, a name for the scene.
  for (const trigger of manifest.scene_triggers) {
    const variables = keysOf(trigger.variables);
    for (const field of trigger.fields) {
      assert.ok(!variables.includes(field.key), `${trigger.key}.${field.key} is both`);
    }
  }
});

test('the command list of "Send a command" is the list of the code, the bounds too', () => {
  const action = manifest.scene_actions.find((a) => a.key === 'send_command');
  const field = (key) => action.fields.find((f) => f.key === key);
  assert.deepEqual(
    field('command').options.map((option) => [
      option.value,
      option.label.en,
      option.label.fr,
      option.label.de,
      option.label.es,
    ]),
    COMMON_COMMANDS.map((c) => [c.value, c.en, c.fr, c.de, c.es]),
  );
  for (const [key, bounds] of [
    ['repeat', REPEAT_BOUNDS],
    ['delay_ms', DELAY_BOUNDS],
  ]) {
    assert.deepEqual(
      { min: field(key).min, max: field(key).max, default: field(key).default },
      bounds,
    );
    // Rendered without `step`: integers only.
    assert.ok(Object.values(bounds).every(Number.isInteger));
  }
  // A required field added later without a default would break the scenes.
  assert.deepEqual(
    action.fields.filter((f) => f.required).map((f) => f.key),
    ['device'],
  );
});

test('the SSDP capture is the search target of the code', () => {
  assert.deepEqual(manifest.network_discovery, [{ type: 'ssdp', st: SSDP_SEARCH_TARGET }]);
});

test('declaring catalog categories requires Gladys >= 4.86.0', () => {
  assert.ok(manifest.categories.length >= 1 && manifest.categories.length <= 3);
  assert.ok(isAtLeast(minGladysVersion(), CATEGORIES_MIN_GLADYS_VERSION));
});

test('declaring scene triggers, scene actions or widgets requires Gladys >= 5.1.0', () => {
  const declared = CAPABILITY_FIELDS.filter((field) => manifest[field] !== undefined);
  assert.deepEqual(declared, CAPABILITY_FIELDS);
  assert.ok(
    isAtLeast(minGladysVersion(), CAPABILITY_MIN_GLADYS_VERSION),
    `${declared.join(', ')} requires gladys_version >= 5.1.0, got "${manifest.gladys_version}"`,
  );
  // No widget button opens a form (#3168, Gladys 5.2.0): 5.1.0 is enough.
  assert.equal(manifest.gladys_version, '>=5.1.0');
});

test('config_schema defaults stay consistent with DEFAULT_CONFIG, and nothing is secret', () => {
  const keys = manifest.config_schema.filter((f) => f.type !== 'section').map((f) => f.key);
  assert.deepEqual(keys.sort(), Object.keys(DEFAULT_CONFIG).sort());
  for (const field of manifest.config_schema) {
    if (field.default !== undefined) {
      assert.equal(DEFAULT_CONFIG[field.key], field.default, `DEFAULT_CONFIG.${field.key}`);
    }
  }
  // The hub answers without credentials: no secret field anywhere.
  assert.ok(allFields.every((f) => f.type !== 'secret'));
});

test('section fields are purely presentational', () => {
  const sections = manifest.config_schema.filter((f) => f.type === 'section');
  assert.ok(sections.length > 0);
  for (const section of sections) {
    assert.equal(section.required, undefined);
    assert.equal(section.default, undefined);
    assert.equal(section.placeholder, undefined);
    for (const link of section.links ?? []) {
      assert.match(link.url, /^https:\/\//, 'section links must be https');
    }
  }
});

test('dynamic selects declare the devices source and no static options', () => {
  const dynamicSelects = allFields.filter((f) => f.source !== undefined);
  assert.equal(dynamicSelects.length, 8);
  for (const field of dynamicSelects) {
    assert.equal(field.source, 'devices', `field "${field.key}"`);
    assert.equal(field.options, undefined, `field "${field.key}": source and options together`);
  }
});

test('the manifest version is the package version, and the image is tagged with it', () => {
  assert.equal(manifest.version, pkg.version, 'manifest version must match package.json');
  assert.ok(manifest.docker_image.endsWith(`:${manifest.version}`));
});

test('field placeholders are multi-language objects', () => {
  const withPlaceholder = allFields.filter((f) => f.placeholder !== undefined);
  assert.ok(withPlaceholder.length > 0);
  for (const field of withPlaceholder) {
    assert.equal(typeof field.placeholder, 'object', `field "${field.key}": placeholder`);
    assert.ok(field.placeholder.en, `field "${field.key}": placeholder needs an English text`);
  }
});

test('number fields have integer bounds and defaults (rendered without step)', () => {
  for (const field of allFields.filter((f) => f.type === 'number')) {
    for (const key of ['min', 'max', 'default']) {
      if (field[key] !== undefined) {
        assert.ok(Number.isInteger(field[key]), `field "${field.key}".${key}`);
      }
    }
  }
});
