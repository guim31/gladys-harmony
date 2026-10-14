// -----------------------------------------------------------------------------
// Dashboard widget (manifest `widgets`, Gladys 5.1+): `harmony`.
//
// The hub device already has the activity list. What the widget adds: the
// current activity at a glance, and one-tap buttons for the favourite
// activities (picked in the widget settings among the activity devices,
// else the first ones of the hub) and for "Off".
//
// Budget (8 components, 2 texts, 1 status, 4 buttons): an optional heading or
// caption, one status list, up to three activity buttons and "Off". The
// running activity is marked by its icon (`check-circle`), never by the button
// style: `primary` is invisible in dark mode (#3153). Each button has its own
// action key: the core drops a button whose key is already taken.
// -----------------------------------------------------------------------------

import { WIDGET_COLORS } from '@gladysassistant/integration-sdk';
import { DEVICE_TYPES, activityLabel, hubName } from './devices.js';
import { WIDGET_KEY } from './manager.js';
import { POWER_OFF_ID } from './harmony/protocol.js';

export const MAX_ACTIVITY_BUTTONS = 3;
const ACTIVITY_ACTION_PREFIX = 'activity_';
const POWER_OFF_ACTION = 'power_off';
const ACTIVE_ICON = 'check-circle';
const LABEL_MAX = 24;

export const TEXT = {
  noHub: {
    en: 'No Harmony Hub yet: add its address in the integration settings.',
    fr: "Aucun Harmony Hub pour l'instant : ajoutez son adresse dans les réglages de l'intégration.",
    de: 'Noch kein Harmony Hub: Füge seine Adresse in den Einstellungen der Integration hinzu.',
    es: 'Aún no hay ningún Harmony Hub: añada su dirección en la configuración de la integración.',
  },
  unreachable: {
    en: 'The hub does not answer: the buttons will wait for it.',
    fr: 'Le hub ne répond pas : les boutons attendront son retour.',
    de: 'Der Hub antwortet nicht: Die Tasten warten auf ihn.',
    es: 'El hub no responde: los botones esperarán a que vuelva.',
  },
  activity: { en: 'Activity', fr: 'Activité', de: 'Aktivität', es: 'Actividad' },
  unknown: { en: 'Unknown', fr: 'Inconnue', de: 'Unbekannt', es: 'Desconocida' },
  powerOff: { en: 'Turn off', fr: 'Éteindre', de: 'Ausschalten', es: 'Apagar' },
  starting: {
    en: 'Starting: ',
    fr: 'Démarrage : ',
    de: 'Wird gestartet: ',
    es: 'Iniciando: ',
  },
  turningOff: {
    en: 'Turning everything off',
    fr: 'Extinction de tout',
    de: 'Alles wird ausgeschaltet',
    es: 'Apagando todo',
  },
  alreadyOff: {
    en: 'Everything is already off',
    fr: 'Tout est déjà éteint',
    de: 'Alles ist bereits aus',
    es: 'Todo ya está apagado',
  },
};

const t = (text, language) => text[language] ?? text.en;
const short = (label) => (label.length > LABEL_MAX ? `${label.slice(0, LABEL_MAX - 1)}…` : label);

/** The hub a widget shows: the one picked in its settings, else the first one. */
export function widgetHub(manager, settings = {}) {
  const resolved = manager.resolveDevice(settings.hub);
  if (resolved) {
    return resolved.hub;
  }
  const hubs = [...manager.hubs.values()].sort((a, b) => hubName(a).localeCompare(hubName(b)));
  return hubs[0] ?? null;
}

/** The activities offered as buttons: the favourites of the settings, else the first ones. */
export function favoriteActivities(manager, hub, settings = {}) {
  const picked = [];
  const wanted = Array.isArray(settings.activities) ? settings.activities : [];
  for (const externalId of wanted) {
    const resolved = manager.resolveDevice(externalId);
    if (
      resolved?.kind === DEVICE_TYPES.ACTIVITY &&
      resolved.hub === hub &&
      !picked.includes(resolved.activity)
    ) {
      picked.push(resolved.activity);
    }
  }
  const list = picked.length > 0 ? picked : hub.model.activities;
  return list.slice(0, MAX_ACTIVITY_BUTTONS);
}

/** The widget content, localized. */
export function buildContent(manager, { settings, language }) {
  const hub = widgetHub(manager, settings);
  if (!hub) {
    return {
      ttl_seconds: 300,
      components: [{ type: 'text', variant: 'body', text: t(TEXT.noHub, language) }],
    };
  }
  const components = [];
  if (manager.hubs.size > 1) {
    components.push({ type: 'text', variant: 'heading', text: hubName(hub).slice(0, 40) });
  }
  if (!hub.reachable) {
    components.push({ type: 'text', variant: 'caption', text: t(TEXT.unreachable, language) });
  }
  const running = hub.current !== null && hub.current !== POWER_OFF_ID;
  const current =
    hub.current === null ? t(TEXT.unknown, language) : activityLabel(hub, hub.current, language);
  components.push({
    type: 'status',
    items: [
      {
        label: t(TEXT.activity, language),
        value: current.slice(0, 40),
        icon: running ? 'tv' : 'power',
        color: !hub.reachable
          ? WIDGET_COLORS.WARNING
          : running
            ? WIDGET_COLORS.SUCCESS
            : WIDGET_COLORS.NEUTRAL,
      },
    ],
  });
  favoriteActivities(manager, hub, settings).forEach((activity, index) => {
    components.push({
      type: 'button',
      label: short(activity.label),
      icon: activity.id === hub.current ? ACTIVE_ICON : 'play-circle',
      style: 'secondary',
      action: {
        key: `${ACTIVITY_ACTION_PREFIX}${index + 1}`,
        params: { hub: hub.remoteId, activity: activity.id },
      },
    });
  });
  components.push({
    type: 'button',
    label: t(TEXT.powerOff, language),
    icon: hub.current === POWER_OFF_ID ? ACTIVE_ICON : 'power',
    style: 'secondary',
    action: { key: POWER_OFF_ACTION, params: { hub: hub.remoteId } },
  });
  // The manager nudges the widget on every change: the ttl is a safety net.
  return { ttl_seconds: 300, components };
}

const prefixed = (text, suffix) =>
  Object.fromEntries(
    Object.entries(text).map(([language, start]) => [language, `${start}${suffix}`]),
  );

export const WIDGETS = {
  [WIDGET_KEY]: {
    get(manager, request) {
      return buildContent(manager, request);
    },

    /** A button: start an activity or turn off, answered once the hub accepted it. */
    async action(manager, { actionKey, params = {} }) {
      const hub = manager.hubs.get(String(params.hub));
      if (!hub) {
        throw new Error(`Unknown Harmony Hub ${params.hub}`);
      }
      if (actionKey === POWER_OFF_ACTION) {
        if (hub.current === POWER_OFF_ID) {
          return TEXT.alreadyOff;
        }
        await manager.startActivity(hub, POWER_OFF_ID, { untilAccepted: true });
        return TEXT.turningOff;
      }
      if (actionKey.startsWith(ACTIVITY_ACTION_PREFIX)) {
        const activity = hub.model.activities.find((a) => a.id === String(params.activity));
        if (!activity) {
          throw new Error(`Unknown activity ${params.activity}`);
        }
        await manager.startActivity(hub, activity.id, { untilAccepted: true });
        return prefixed(TEXT.starting, short(activity.label));
      }
      throw new Error(`Unknown widget action ${actionKey}`);
    },
  },
};
