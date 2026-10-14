import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateWidgetContent } from '@gladysassistant/integration-sdk';
import { ACTIVITY, createHub } from './helpers/fakeHub.js';
import { createDevices, createWorld, ids, settle } from './helpers/world.js';

const buttons = (content) => content.components.filter((c) => c.type === 'button');

async function content(world, options = {}) {
  const ack = await world.gladys.fake.widgetGet('harmony', options);
  assert.equal(ack.success, true, ack.error);
  // Rendered exactly as sent: within the vocabulary and the budget.
  assert.deepEqual(validateWidgetContent(ack.data.content), []);
  return ack.data.content;
}

test('the widget shows the current activity, three activities and Off', async () => {
  const world = await createWorld({ hubs: [createHub({ current: ACTIVITY.MUSIC })] });
  const widget = await content(world, { language: 'fr' });
  const status = widget.components.find((c) => c.type === 'status');
  assert.deepEqual(status.items, [
    { label: 'Activité', value: 'Listen to Music', icon: 'tv', color: 'success' },
  ]);
  assert.deepEqual(
    buttons(widget).map((b) => [b.label, b.icon, b.action.key]),
    [
      ['Watch TV', 'play-circle', 'activity_1'],
      ['Watch Apple TV', 'play-circle', 'activity_2'],
      ['Listen to Music', 'check-circle', 'activity_3'],
      ['Éteindre', 'power', 'power_off'],
    ],
  );
  // Never the primary style: invisible in dark mode.
  assert.ok(buttons(widget).every((b) => b.style !== 'primary'));
  await world.app.stop();
});

test('the favourite activities of the settings are the buttons, in their order', async () => {
  const world = await createWorld();
  await createDevices(world);
  const [hub] = world.hubs;
  const settings = {
    hub: ids.hub(world, hub).device,
    activities: [
      ids.activity(world, hub, ACTIVITY.XBOX).device,
      ids.hub(world, hub).device, // not an activity: ignored
      ids.activity(world, hub, ACTIVITY.WATCH_TV).device,
    ],
  };
  const widget = await content(world, { settings, language: 'en' });
  assert.deepEqual(
    buttons(widget).map((b) => b.label),
    ['Play Xbox', 'Watch TV', 'Turn off'],
  );
  const off = buttons(widget).at(-1);
  // Everything is off: the Off button carries the "current" mark.
  assert.equal(off.icon, 'check-circle');
  await world.app.stop();
});

test('a button starts the activity and answers as soon as the hub accepted it', async () => {
  const world = await createWorld();
  const [hub] = world.hubs;
  const widget = await content(world);
  const xbox = buttons(widget).find((b) => b.label === 'Watch Apple TV');
  const ack = await world.gladys.fake.widgetAction('harmony', xbox.action.key, xbox.action.params);
  assert.deepEqual(ack, {
    success: true,
    data: {
      message: {
        en: 'Starting: Watch Apple TV',
        fr: 'Démarrage : Watch Apple TV',
        de: 'Wird gestartet: Watch Apple TV',
        es: 'Iniciando: Watch Apple TV',
      },
    },
  });
  await settle(world.manager);
  assert.equal(hub.current, ACTIVITY.APPLE_TV);
  const off = buttons(await content(world)).at(-1);
  const turnedOff = await world.gladys.fake.widgetAction(
    'harmony',
    off.action.key,
    off.action.params,
  );
  assert.equal(turnedOff.data.message.fr, 'Extinction de tout');
  await settle(world.manager);
  assert.equal(hub.current, ACTIVITY.OFF);
  const again = await world.gladys.fake.widgetAction('harmony', off.action.key, off.action.params);
  assert.equal(again.data.message.en, 'Everything is already off');
  await world.app.stop();
});

test('an unreachable hub is said, and two hubs get a heading', async () => {
  const bedroom = createHub({ host: '192.0.2.50', remoteId: '777', name: 'Bedroom' });
  const world = await createWorld({ hubs: [createHub(), bedroom] });
  bedroom.unplug();
  await settle(world.manager);
  const widget = await content(world, {
    settings: { hub: ids.hub(world, bedroom).device },
    language: 'de',
  });
  const texts = widget.components.filter((c) => c.type === 'text').map((c) => c.text);
  assert.deepEqual(texts, [
    'Harmony Bedroom',
    'Der Hub antwortet nicht: Die Tasten warten auf ihn.',
  ]);
  assert.equal(widget.components.find((c) => c.type === 'status').items[0].color, 'warning');
  await world.app.stop();
});

test('no hub yet: the widget says what to do', async () => {
  const world = await createWorld({ hubs: [] });
  const widget = await content(world, { language: 'es' });
  assert.deepEqual(widget.components, [
    {
      type: 'text',
      variant: 'body',
      text: 'Aún no hay ningún Harmony Hub: añada su dirección en la configuración de la integración.',
    },
  ]);
  await world.app.stop();
});

test('a long activity name fits the button', async () => {
  const hub = createHub();
  hub.config.activity[0].label = 'Watch the big match on the projector';
  const world = await createWorld({ hubs: [hub] });
  const [first] = buttons(await content(world));
  assert.equal(first.label.length, 24);
  assert.ok(first.label.endsWith('…'));
  await world.app.stop();
});
