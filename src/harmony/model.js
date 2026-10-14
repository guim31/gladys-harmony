// -----------------------------------------------------------------------------
// Reading the configuration of a hub (`get_config`): its activities, the
// devices it drives and their commands. The raw configuration is large (every
// device carries its whole remote layout); what is kept here is the part the
// integration uses, small enough to be stored under /data.
//
// Shape of the raw configuration (as aioharmony and Home Assistant read it):
//   activity: [{ id: "30197730", label: "Watch TV", activityOrder: 0, ... },
//              { id: "-1", label: "PowerOff", ... }]
//   device:   [{ id: "38343689", label: "Samsung TV", manufacturer, model, type,
//                controlGroup: [{ name: "Volume", function: [{ name, label,
//                action: "{\"command\":\"VolumeUp\",\"type\":\"IRCommand\",
//                          \"deviceId\":\"38343689\"}" }] }] }]
// -----------------------------------------------------------------------------

import { POWER_OFF_ID } from './protocol.js';

// Bounds of what is kept, so a broken or huge configuration cannot fill /data.
const MAX_ACTIVITIES = 100;
const MAX_DEVICES = 100;
const MAX_COMMANDS = 400;
const MAX_TEXT = 100;

const text = (value) => {
  if (value === undefined || value === null) {
    return null;
  }
  const trimmed = String(value).trim();
  return trimmed === '' ? null : trimmed.slice(0, MAX_TEXT);
};

/**
 * The parts of a hub configuration the integration uses.
 * @returns {{ activities: Array<{ id: string, label: string, order: number }>,
 *   devices: Array<{ id: string, label: string, manufacturer: string|null,
 *   model: string|null, type: string|null,
 *   commands: Array<{ name: string, label: string, group: string|null }> }> }}
 */
export function parseConfig(raw) {
  const activities = [];
  const seenActivities = new Set();
  for (const [index, activity] of asList(raw?.activity).entries()) {
    const id = text(activity?.id);
    const label = text(activity?.label);
    // "PowerOff" is the hub's way to say "all off": not an activity to offer.
    // Entries without a label exist (seen by Home Assistant): unusable.
    if (id === null || label === null || id === POWER_OFF_ID || seenActivities.has(id)) {
      continue;
    }
    seenActivities.add(id);
    const order = Number(activity.activityOrder);
    activities.push({ id, label, order: Number.isFinite(order) ? order : 1000 + index });
  }
  activities.sort((a, b) => a.order - b.order || a.label.localeCompare(b.label));

  const devices = [];
  const seenDevices = new Set();
  for (const device of asList(raw?.device)) {
    const id = text(device?.id);
    const label = text(device?.label);
    if (id === null || label === null || seenDevices.has(id)) {
      continue;
    }
    seenDevices.add(id);
    devices.push({
      id,
      label,
      manufacturer: text(device.manufacturer),
      model: text(device.model),
      type: text(device.type),
      commands: parseCommands(device),
    });
  }

  return {
    activities: activities.slice(0, MAX_ACTIVITIES),
    devices: devices.slice(0, MAX_DEVICES),
  };
}

function parseCommands(device) {
  const commands = [];
  const seen = new Set();
  for (const group of asList(device.controlGroup)) {
    for (const fn of asList(group?.function)) {
      // The command the hub expects is the one of the `action`; the function
      // name is the same on every configuration seen, and the fallback.
      const name = text(parseAction(fn?.action)?.command) ?? text(fn?.name);
      if (name === null || seen.has(name.toLowerCase())) {
        continue;
      }
      seen.add(name.toLowerCase());
      commands.push({ name, label: text(fn.label) ?? name, group: text(group.name) });
      if (commands.length >= MAX_COMMANDS) {
        return commands;
      }
    }
  }
  return commands;
}

function parseAction(action) {
  if (action && typeof action === 'object') {
    return action;
  }
  try {
    return JSON.parse(String(action));
  } catch {
    return null;
  }
}

function asList(value) {
  return Array.isArray(value) ? value : [];
}

/** A configuration as stored, back to the parsed shape (a corrupt file gives an empty one). */
export function restoreModel(saved) {
  const activities = asList(saved?.activities).filter(
    (a) => typeof a?.id === 'string' && typeof a?.label === 'string',
  );
  const devices = asList(saved?.devices)
    .filter((d) => typeof d?.id === 'string' && typeof d?.label === 'string')
    .map((d) => ({
      ...d,
      commands: asList(d.commands).filter(
        (c) => typeof c?.name === 'string' && typeof c?.label === 'string',
      ),
    }));
  return { activities, devices };
}

/** An activity by id, or by name (any case). */
export function findActivity(model, reference) {
  const wanted = text(reference);
  if (wanted === null) {
    return null;
  }
  const activities = model?.activities ?? [];
  return (
    activities.find((activity) => activity.id === wanted) ??
    activities.find((activity) => activity.label.toLowerCase() === wanted.toLowerCase()) ??
    null
  );
}

export function findDevice(model, deviceId) {
  return (model?.devices ?? []).find((device) => device.id === String(deviceId)) ?? null;
}

/**
 * A command of a device by its name or its label, any case and ignoring
 * spaces, so "Volume Up", "volumeup" and "VolumeUp" all find `VolumeUp`.
 */
export function findCommand(device, reference) {
  const wanted = squash(reference);
  if (wanted === '') {
    return null;
  }
  const commands = device?.commands ?? [];
  return (
    commands.find((command) => squash(command.name) === wanted) ??
    commands.find((command) => squash(command.label) === wanted) ??
    null
  );
}

function squash(value) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[\s_-]+/g, '');
}
