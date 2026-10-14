// -----------------------------------------------------------------------------
// Scene action handlers (manifest `scene_actions`, Gladys 5.1+).
//
// Activities and appliances are Gladys devices, so the scene editor lists
// them (`source: "devices"`, the only list Gladys fills at run time). The
// commands cannot be listed per appliance in a scene action: the usual ones
// are offered in a fixed list (Logitech's command names), and any other
// command of the appliance can be typed; the "Command" list of the appliance
// device, through the core "Set device value" action, has them all.
//
// The scene triggers are fired by the manager when the hub reports a change
// (src/manager.js), whoever asked for it, with a loop guard.
// -----------------------------------------------------------------------------

import { DEVICE_TYPES, hubName } from './devices.js';
import { POWER_OFF_ID } from './harmony/protocol.js';
import { localizedError } from './messages.js';

// The usual commands of the Logitech database, offered in the "Send a
// command" action. The values are stored in the scenes: permanent.
export const COMMON_COMMANDS = [
  {
    value: 'PowerToggle',
    en: 'Power toggle',
    fr: 'Marche/arrêt',
    de: 'Ein/Aus',
    es: 'Encendido/apagado',
  },
  { value: 'PowerOn', en: 'Power on', fr: 'Allumer', de: 'Einschalten', es: 'Encender' },
  { value: 'PowerOff', en: 'Power off', fr: 'Éteindre', de: 'Ausschalten', es: 'Apagar' },
  {
    value: 'VolumeUp',
    en: 'Volume up',
    fr: 'Augmenter volume',
    de: 'Lautstärke höher',
    es: 'Subir volumen',
  },
  {
    value: 'VolumeDown',
    en: 'Volume down',
    fr: 'Diminuer volume',
    de: 'Lautstärke niedriger',
    es: 'Bajar volumen',
  },
  { value: 'Mute', en: 'Mute', fr: 'Muet', de: 'Stumm', es: 'Silenciar' },
  {
    value: 'ChannelUp',
    en: 'Channel up',
    fr: 'Chaîne suivante',
    de: 'Nächster Kanal',
    es: 'Canal siguiente',
  },
  {
    value: 'ChannelDown',
    en: 'Channel down',
    fr: 'Chaîne précédente',
    de: 'Voriger Kanal',
    es: 'Bajar canal',
  },
  { value: 'DirectionUp', en: 'Up', fr: 'Haut', de: 'Hoch', es: 'Arriba' },
  { value: 'DirectionDown', en: 'Down', fr: 'Bas', de: 'Runter', es: 'Abajo' },
  { value: 'DirectionLeft', en: 'Left', fr: 'Gauche', de: 'Links', es: 'Izquierda' },
  { value: 'DirectionRight', en: 'Right', fr: 'Droite', de: 'Rechts', es: 'Derecha' },
  { value: 'Select', en: 'OK', fr: 'OK', de: 'OK', es: 'Aceptar' },
  { value: 'Menu', en: 'Menu', fr: 'Menu', de: 'Menü', es: 'Menú' },
  { value: 'Home', en: 'Home', fr: 'Accueil', de: 'Startseite', es: 'Inicio' },
  { value: 'Back', en: 'Back', fr: 'Retour', de: 'Zurück', es: 'Volver' },
  { value: 'Exit', en: 'Exit', fr: 'Quitter', de: 'Beenden', es: 'Salir' },
  { value: 'Info', en: 'Info', fr: 'Info', de: 'Info', es: 'Información' },
  { value: 'Guide', en: 'Guide', fr: 'Guide', de: 'Programm', es: 'Guía' },
  { value: 'Play', en: 'Play', fr: 'Lecture', de: 'Abspielen', es: 'Reproducir' },
  { value: 'Pause', en: 'Pause', fr: 'Pause', de: 'Pause', es: 'Pausar' },
  { value: 'Stop', en: 'Stop', fr: 'Stop', de: 'Stopp', es: 'Detener' },
  { value: 'Rewind', en: 'Rewind', fr: 'Retour rapide', de: 'Zurückspulen', es: 'Retroceder' },
  { value: 'FastForward', en: 'Fast forward', fr: 'Avance rapide', de: 'Vorspulen', es: 'Avanzar' },
  { value: 'SkipBack', en: 'Previous', fr: 'Précédent', de: 'Vorheriger Titel', es: 'Anterior' },
  { value: 'SkipForward', en: 'Next', fr: 'Suivant', de: 'Nächster Titel', es: 'Siguiente' },
  { value: 'Record', en: 'Record', fr: 'Enregistrer', de: 'Aufnehmen', es: 'Grabar' },
];

export const REPEAT_BOUNDS = { min: 1, max: 20, default: 1 };
export const DELAY_BOUNDS = { min: 0, max: 5000, default: 400 };

const isGiven = (value) => value !== undefined && value !== null && String(value).trim() !== '';

function bounded(value, { min, max, default: fallback }) {
  const number = Number(value);
  if (!isGiven(value) || !Number.isFinite(number)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, Math.round(number)));
}

function requireKind(manager, externalId, kind, errorKey) {
  const resolved = manager.require(externalId);
  if (resolved.kind !== kind) {
    const name = resolved.activity?.label ?? resolved.appliance?.label ?? hubName(resolved.hub);
    throw localizedError(manager.config.language, errorKey, name);
  }
  return resolved;
}

export const SCENE_ACTIONS = {
  async start_activity(manager, { fields }) {
    const { hub, activity } = requireKind(
      manager,
      fields.activity,
      DEVICE_TYPES.ACTIVITY,
      'notActivity',
    );
    await manager.startActivity(hub, activity.id);
  },

  // Any device of the hub will do: the hub itself, one of its activities or
  // appliances.
  async power_off(manager, { fields }) {
    const { hub } = manager.require(fields.hub);
    await manager.startActivity(hub, POWER_OFF_ID);
  },

  async send_command(manager, { fields }) {
    const { hub, appliance } = requireKind(
      manager,
      fields.device,
      DEVICE_TYPES.DEVICE,
      'notAppliance',
    );
    const reference = isGiven(fields.custom_command) ? fields.custom_command : fields.command;
    if (!isGiven(reference)) {
      throw localizedError(manager.config.language, 'noCommand');
    }
    await manager.sendCommand(hub, appliance, String(reference).trim(), {
      repeat: bounded(fields.repeat, REPEAT_BOUNDS),
      delayMs: bounded(fields.delay_ms, DELAY_BOUNDS),
    });
  },
};
