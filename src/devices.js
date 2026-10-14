// -----------------------------------------------------------------------------
// From a hub to Gladys devices. One hub gives three kinds of devices, each
// added on its own from the Discover tab:
//
//   - the hub: the current activity (text) and the activity choice (a list
//     holding the activities and "Off");
//   - one device per activity ("Watch TV"...): a switch that is on while the
//     activity runs. Turning it on starts the activity, turning it off turns
//     everything off. Being a device, an activity can be picked from a list
//     in the scene editor, the widget settings and the scene triggers, the
//     only lists Gladys fills at run time (`source: "devices"`);
//   - one device per appliance the hub drives (TV, amplifier...): the list of
//     its commands, and push buttons for the usual remote keys it has.
//
// External ids are forever: the hub is keyed by its hub id (`activeRemoteId`),
// activities and appliances by the hub id and the id the hub gives them.
// Feature names are given at creation, in the language of the configuration.
// -----------------------------------------------------------------------------

import { DEVICE_FEATURE_CATEGORIES, DEVICE_FEATURE_TYPES } from '@gladysassistant/integration-sdk';
import { POWER_OFF_ID } from './harmony/protocol.js';

export const DEVICE_TYPES = {
  HUB: 'hub',
  ACTIVITY: 'activity',
  DEVICE: 'device',
};

export const FEATURE_KEYS = {
  ACTIVITY: 'activity',
  CURRENT_ACTIVITY: 'current_activity',
  RUNNING: 'running',
  COMMAND: 'command',
};

// Remote keys shown as push buttons, matched on the command names of the
// Logitech database (any case). The first command the device has is sent.
// The feature key is the Gladys type: permanent once published.
export const REMOTE_KEYS = [
  { type: 'volume-up', commands: ['VolumeUp'] },
  { type: 'volume-down', commands: ['VolumeDown'] },
  { type: 'volume-mute', commands: ['Mute', 'MuteToggle'] },
  { type: 'channel-up', commands: ['ChannelUp'] },
  { type: 'channel-down', commands: ['ChannelDown'] },
  { type: 'channel-previous', commands: ['ChannelPrev', 'PrevChannel', 'Last', 'Recall'] },
  { type: 'up', commands: ['DirectionUp'] },
  { type: 'down', commands: ['DirectionDown'] },
  { type: 'left', commands: ['DirectionLeft'] },
  { type: 'right', commands: ['DirectionRight'] },
  { type: 'enter', commands: ['Select', 'OK', 'Enter'] },
  { type: 'menu', commands: ['Menu'] },
  { type: 'guide', commands: ['Guide'] },
  { type: 'info', commands: ['Info'] },
  { type: 'return', commands: ['Back', 'Return'] },
  { type: 'exit', commands: ['Exit'] },
  { type: 'play', commands: ['Play'] },
  { type: 'pause', commands: ['Pause'] },
  { type: 'stop', commands: ['Stop'] },
  { type: 'rewind', commands: ['Rewind'] },
  { type: 'forward', commands: ['FastForward'] },
  { type: 'previous', commands: ['SkipBack', 'SkipBackward', 'Previous'] },
  { type: 'next', commands: ['SkipForward', 'Next'] },
  { type: 'record', commands: ['Record'] },
];

// Feature names, one table per language (the words of the Gladys interface).
export const NAMES = {
  en: {
    activity: 'Activity',
    current_activity: 'Current activity',
    running: 'Running',
    command: 'Command',
    off: 'Off',
    'volume-up': 'Volume up',
    'volume-down': 'Volume down',
    'volume-mute': 'Mute',
    'channel-up': 'Channel up',
    'channel-down': 'Channel down',
    'channel-previous': 'Previous channel',
    up: 'Up',
    down: 'Down',
    left: 'Left',
    right: 'Right',
    enter: 'OK',
    menu: 'Menu',
    guide: 'Guide',
    info: 'Info',
    return: 'Back',
    exit: 'Exit',
    play: 'Play',
    pause: 'Pause',
    stop: 'Stop',
    rewind: 'Rewind',
    forward: 'Fast forward',
    previous: 'Previous',
    next: 'Next',
    record: 'Record',
  },
  fr: {
    activity: 'Activité',
    current_activity: 'Activité en cours',
    running: 'En cours',
    command: 'Commande',
    off: 'Éteint',
    'volume-up': 'Augmenter volume',
    'volume-down': 'Diminuer volume',
    'volume-mute': 'Muet',
    'channel-up': 'Chaîne suivante',
    'channel-down': 'Chaîne précédente',
    'channel-previous': 'Dernière chaîne',
    up: 'Haut',
    down: 'Bas',
    left: 'Gauche',
    right: 'Droite',
    enter: 'OK',
    menu: 'Menu',
    guide: 'Guide',
    info: 'Info',
    return: 'Retour',
    exit: 'Quitter',
    play: 'Lecture',
    pause: 'Pause',
    stop: 'Stop',
    rewind: 'Retour rapide',
    forward: 'Avance rapide',
    previous: 'Précédent',
    next: 'Suivant',
    record: 'Enregistrer',
  },
  de: {
    activity: 'Aktivität',
    current_activity: 'Aktuelle Aktivität',
    running: 'Läuft',
    command: 'Befehl',
    off: 'Aus',
    'volume-up': 'Lautstärke höher',
    'volume-down': 'Lautstärke niedriger',
    'volume-mute': 'Stumm',
    'channel-up': 'Nächster Kanal',
    'channel-down': 'Voriger Kanal',
    'channel-previous': 'Letzter Kanal',
    up: 'Hoch',
    down: 'Runter',
    left: 'Links',
    right: 'Rechts',
    enter: 'OK',
    menu: 'Menü',
    guide: 'Programm',
    info: 'Info',
    return: 'Zurück',
    exit: 'Beenden',
    play: 'Abspielen',
    pause: 'Pause',
    stop: 'Stopp',
    rewind: 'Zurückspulen',
    forward: 'Vorspulen',
    previous: 'Vorheriger Titel',
    next: 'Nächster Titel',
    record: 'Aufnehmen',
  },
  es: {
    activity: 'Actividad',
    current_activity: 'Actividad actual',
    running: 'En curso',
    command: 'Comando',
    off: 'Apagado',
    'volume-up': 'Subir volumen',
    'volume-down': 'Bajar volumen',
    'volume-mute': 'Silenciar',
    'channel-up': 'Canal siguiente',
    'channel-down': 'Bajar canal',
    'channel-previous': 'Canal anterior',
    up: 'Arriba',
    down: 'Abajo',
    left: 'Izquierda',
    right: 'Derecha',
    enter: 'Aceptar',
    menu: 'Menú',
    guide: 'Guía',
    info: 'Información',
    return: 'Volver',
    exit: 'Salir',
    play: 'Reproducir',
    pause: 'Pausar',
    stop: 'Detener',
    rewind: 'Retroceder',
    forward: 'Avanzar',
    previous: 'Anterior',
    next: 'Siguiente',
    record: 'Grabar',
  },
};

export const nameOf = (key, language) => (NAMES[language] ?? NAMES.en)[key] ?? NAMES.en[key];

// What a hub is called before it said its name.
const DEFAULT_HUB_NAME = 'Harmony Hub';

/**
 * The name of a hub in Gladys: its name in the Harmony app, with "Harmony"
 * in front when it is a room name ("Living Room" would read as a room).
 */
export function hubName(hub) {
  const name = typeof hub.name === 'string' ? hub.name.trim() : '';
  if (name === '') {
    return DEFAULT_HUB_NAME;
  }
  return /harmony/i.test(name) ? name : `Harmony ${name}`;
}

/** The appliances of a hub that get a Gladys device: those with commands. */
export function controllableDevices(hub) {
  return hub.model.devices.filter((device) => device.commands.length > 0);
}

export const hubIds = (gladys, remoteId) => gladys.externalIds(DEVICE_TYPES.HUB, remoteId);

export const activityIds = (gladys, remoteId, activityId) =>
  gladys.externalIds(DEVICE_TYPES.ACTIVITY, `${remoteId}-${activityId}`);

export const applianceIds = (gladys, remoteId, deviceId) =>
  gladys.externalIds(DEVICE_TYPES.DEVICE, `${remoteId}-${deviceId}`);

/** The command a remote key sends on this appliance, null when it has none. */
export function remoteKeyCommand(appliance, key) {
  for (const wanted of key.commands) {
    const found = appliance.commands.find(
      (command) => command.name.toLowerCase() === wanted.toLowerCase(),
    );
    if (found) {
      return found;
    }
  }
  return null;
}

const textFeature = (ids, key, type, name, extra = {}) => ({
  name,
  external_id: ids.feature(key),
  category: DEVICE_FEATURE_CATEGORIES.TEXT,
  type,
  // NOT NULL in the core, text features included: without them "Add to
  // Gladys" fails with a 422.
  min: 0,
  max: 0,
  keep_history: false,
  ...extra,
});

/** The activity choices of a hub: its activities, then "Off". */
export function activityOptions(hub, language) {
  return [
    ...hub.model.activities.map((activity) => ({ value: activity.id, label: activity.label })),
    { value: POWER_OFF_ID, label: nameOf('off', language) },
  ];
}

/**
 * Every Gladys device of one hub.
 * @param {object} gladys GladysIntegration (externalIds)
 * @param {{ remoteId: string, name: string|null, host: string, model: object }} hub
 * @param {string} language
 */
export function buildHubDevices(gladys, hub, language) {
  const ids = hubIds(gladys, hub.remoteId);
  const prefix = hubName(hub);
  const devices = [
    {
      name: prefix,
      external_id: ids.device,
      // Pushed over the hub's WebSocket and refreshed by the container's own
      // timer: the core's scheduler is not needed (and not reliable, #3198).
      should_poll: false,
      params: [{ name: 'HOST', value: hub.host }],
      features: [
        textFeature(
          ids,
          FEATURE_KEYS.CURRENT_ACTIVITY,
          DEVICE_FEATURE_TYPES.TEXT.TEXT,
          nameOf(FEATURE_KEYS.CURRENT_ACTIVITY, language),
          {
            read_only: true,
            has_feedback: true,
            keep_history: true,
          },
        ),
        textFeature(
          ids,
          FEATURE_KEYS.ACTIVITY,
          DEVICE_FEATURE_TYPES.TEXT.SELECT,
          nameOf(FEATURE_KEYS.ACTIVITY, language),
          {
            read_only: false,
            has_feedback: true,
            supported_options: activityOptions(hub, language),
          },
        ),
      ],
    },
  ];

  for (const activity of hub.model.activities) {
    const activityId = activityIds(gladys, hub.remoteId, activity.id);
    devices.push({
      name: `${prefix} · ${activity.label}`,
      external_id: activityId.device,
      should_poll: false,
      features: [
        {
          name: nameOf(FEATURE_KEYS.RUNNING, language),
          external_id: activityId.feature(FEATURE_KEYS.RUNNING),
          category: DEVICE_FEATURE_CATEGORIES.SWITCH,
          type: DEVICE_FEATURE_TYPES.SWITCH.BINARY,
          min: 0,
          max: 1,
          read_only: false,
          has_feedback: true,
          keep_history: true,
        },
      ],
    });
  }

  for (const appliance of controllableDevices(hub)) {
    const applianceId = applianceIds(gladys, hub.remoteId, appliance.id);
    const features = [
      textFeature(
        applianceId,
        FEATURE_KEYS.COMMAND,
        DEVICE_FEATURE_TYPES.TEXT.SELECT,
        nameOf(FEATURE_KEYS.COMMAND, language),
        {
          read_only: false,
          has_feedback: false,
          supported_options: appliance.commands.map((command) => ({
            value: command.name,
            label: command.label,
          })),
        },
      ),
    ];
    for (const key of REMOTE_KEYS) {
      if (remoteKeyCommand(appliance, key)) {
        features.push({
          name: nameOf(key.type, language),
          external_id: applianceId.feature(key.type),
          category: DEVICE_FEATURE_CATEGORIES.TELEVISION,
          type: key.type,
          min: 0,
          max: 1,
          read_only: false,
          has_feedback: false,
          keep_history: false,
        });
      }
    }
    devices.push({
      name: `${prefix} · ${appliance.label}`,
      external_id: applianceId.device,
      should_poll: false,
      features,
    });
  }
  return devices;
}

/**
 * The states of one hub, `[{ id, value }]` (value: a number, or `{ text }`).
 * Nothing while the current activity is unknown (never read yet).
 */
export function hubStates(gladys, hub, language) {
  if (hub.current === null || hub.current === undefined) {
    return [];
  }
  const ids = hubIds(gladys, hub.remoteId);
  const states = [
    {
      id: ids.feature(FEATURE_KEYS.CURRENT_ACTIVITY),
      value: { text: activityLabel(hub, hub.current, language) },
    },
    { id: ids.feature(FEATURE_KEYS.ACTIVITY), value: { text: hub.current } },
  ];
  for (const activity of hub.model.activities) {
    states.push({
      id: activityIds(gladys, hub.remoteId, activity.id).feature(FEATURE_KEYS.RUNNING),
      value: activity.id === hub.current ? 1 : 0,
    });
  }
  return states;
}

/** The name of an activity of a hub, "Off" for the PowerOff id. */
export function activityLabel(hub, activityId, language) {
  if (activityId === POWER_OFF_ID) {
    return nameOf('off', language);
  }
  const activity = hub.model.activities.find((candidate) => candidate.id === activityId);
  // An activity the configuration does not know yet (created in the app since
  // the last read): its id, until the configuration is read again.
  return activity?.label ?? `#${activityId}`;
}
