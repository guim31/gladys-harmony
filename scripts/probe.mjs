#!/usr/bin/env node
// -----------------------------------------------------------------------------
// Read-only check of the integration's Harmony client against a real hub, from
// a machine on the same network:
//
//   node scripts/probe.mjs 192.168.1.40              # the hub at this address
//   node scripts/probe.mjs 192.168.1.40 --listen 60  # + 60 s of notifications:
//                                                     #   press activity buttons
//   node scripts/probe.mjs --ssdp                    # does the hub answer the
//                                                     #   SSDP search the
//                                                     #   integration declares?
//
// Nothing is changed on the hub: no activity is started, no key is sent. The
// output is meant to be pasted in an issue: it shows the shape of the answers
// (keys, types, counts) and what the integration makes of them, never the
// Logitech account, the names given in the app, or a full hub id.
// -----------------------------------------------------------------------------

import dgram from 'node:dgram';
import { HarmonyClient, fetchProvisionInfo } from '../src/harmony/client.js';
import { parseConfig } from '../src/harmony/model.js';
import { REMOTE_KEYS, remoteKeyCommand } from '../src/devices.js';
import { SSDP_SEARCH_TARGET, hubAddresses } from '../src/discovery.js';

const args = process.argv.slice(2);
const host = args.find((arg) => !arg.startsWith('--') && !/^\d+$/.test(arg));
const listenIndex = args.indexOf('--listen');
const listenSeconds = listenIndex >= 0 ? Number(args[listenIndex + 1] ?? 30) : 0;

const mask = (value) => {
  const text = String(value);
  return text.length <= 3 ? '***' : `${text.slice(0, 2)}${'*'.repeat(text.length - 2)}`;
};
const typeOf = (value) => (Array.isArray(value) ? 'array' : value === null ? 'null' : typeof value);
const shape = (object) =>
  Object.fromEntries(
    Object.keys(object ?? {})
      .sort()
      .map((key) => [key, typeOf(object[key])]),
  );
const say = (title, value) =>
  console.log(
    `\n== ${title}\n${typeof value === 'string' ? value : JSON.stringify(value, null, 2)}`,
  );

async function ssdp() {
  const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
  const answers = [];
  socket.on('message', (message, remote) =>
    answers.push({ source_ip: remote.address, headers: message.toString('utf8') }),
  );
  await new Promise((resolve) => socket.bind(0, resolve));
  const search = [
    'M-SEARCH * HTTP/1.1',
    'HOST: 239.255.255.250:1900',
    'MAN: "ssdp:discover"',
    'MX: 2',
    `ST: ${SSDP_SEARCH_TARGET}`,
    '',
    '',
  ].join('\r\n');
  socket.send(search, 1900, '239.255.255.250');
  await new Promise((resolve) => setTimeout(resolve, 4000));
  socket.close();
  say(`SSDP search for ${SSDP_SEARCH_TARGET}`, {
    answers: answers.length,
    kept_as_hubs: hubAddresses(answers).length,
    headers: answers.map(({ headers }) =>
      headers
        .split(/\r?\n/)
        .filter((line) => /^(st|nt|usn|server|location):/i.test(line))
        .map((line) =>
          line.replace(/\d+\.\d+\.\d+\.\d+/g, 'x.x.x.x').replace(/uuid:[^:]+/i, 'uuid:…'),
        ),
    ),
  });
}

async function hub() {
  let provision;
  try {
    provision = await fetchProvisionInfo(host);
  } catch (err) {
    say('Provisioning request (POST :8088)', `FAILED (${err.kind}): ${err.message}`);
    process.exitCode = 1;
    return;
  }
  say('Provisioning request (POST :8088)', {
    hub_id: mask(provision.remoteId),
    domain: provision.domain,
  });

  const client = new HarmonyClient({
    host,
    remoteId: provision.remoteId,
    domain: provision.domain,
  });
  const notifications = [];
  const typesSeen = new Set();
  client.on('notification', (message) => {
    const data = message.data ?? {};
    notifications.push({
      at: new Date().toISOString().slice(11, 19),
      type: message.type,
      activityStatus: data.activityStatus,
      activityId: data.activityId === undefined ? undefined : mask(data.activityId),
      syncStatus: data.syncStatus,
      // The keys of each type once: enough to compare with the fixtures.
      keys: typesSeen.has(message.type) ? undefined : Object.keys(data).sort(),
    });
    typesSeen.add(message.type);
  });
  client.start();
  const opened = await new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), 10_000);
    client.once('open', () => {
      clearTimeout(timer);
      resolve(true);
    });
    client.once('failure', (err) => {
      clearTimeout(timer);
      say('WebSocket', `FAILED: ${err.message}`);
      resolve(false);
    });
  });
  if (!opened) {
    client.stop();
    process.exitCode = 1;
    return;
  }
  say('WebSocket', `open (${client.url.replace(provision.remoteId, mask(provision.remoteId))})`);

  const read = async (title, fn) => {
    try {
      return await fn();
    } catch (err) {
      say(title, `FAILED (${err.kind}): ${err.message}`);
      return null;
    }
  };

  const info = await read('Discovery info', () => client.getDiscoveryInfo());
  if (info) {
    say('Discovery info', {
      firmware: info.current_fw_version,
      has_friendlyName: typeof info.friendlyName === 'string',
      keys: shape(info),
    });
  }
  const digest = await read('State digest', () => client.getStateDigest());
  if (digest) {
    say('State digest', {
      activityStatus: digest.activityStatus,
      configVersion: digest.configVersion,
      hubSwVersion: digest.hubSwVersion,
      keys: shape(digest),
    });
  }
  const current = await read('Current activity', () => client.getCurrentActivity());
  const raw = await read('Configuration', () => client.getConfig());
  if (raw) {
    const model = parseConfig(raw);
    const firstFunction = raw.device?.[0]?.controlGroup?.[0]?.function?.[0];
    say('Configuration', {
      raw_keys: Object.keys(raw).sort(),
      raw_activities: raw.activity?.length,
      activity_id_type: typeOf(raw.activity?.[0]?.id),
      has_power_off: raw.activity?.some((a) => String(a.id) === '-1'),
      activities_kept: model.activities.length,
      activities_with_order: raw.activity?.filter((a) => a.activityOrder !== undefined).length,
      current_activity_is_known:
        current === '-1' || model.activities.some((activity) => activity.id === current),
      function_shape: firstFunction ? shape(firstFunction) : null,
      action_example: firstFunction?.action
        ? String(firstFunction.action).replace(/\d{4,}/g, (d) => mask(d))
        : null,
      devices: model.devices.map((device) => ({
        type: device.type,
        manufacturer: device.manufacturer,
        model: device.model,
        commands: device.commands.length,
        command_groups: [...new Set(device.commands.map((command) => command.group))],
        remote_keys: REMOTE_KEYS.filter((key) => remoteKeyCommand(device, key)).map(
          (key) => key.type,
        ),
        sample_commands: device.commands.slice(0, 12).map((command) => command.name),
      })),
    });
  }

  if (listenSeconds > 0) {
    console.log(`\nListening ${listenSeconds} s: use the remote (activities, Off) now...`);
    await new Promise((resolve) => setTimeout(resolve, listenSeconds * 1000));
    say('Notifications', notifications);
  }
  client.stop();
}

if (args.includes('--ssdp')) {
  await ssdp();
}
if (host) {
  await hub();
} else if (!args.includes('--ssdp')) {
  console.log('Usage: node scripts/probe.mjs <hub address> [--listen <seconds>] [--ssdp]');
  process.exitCode = 2;
}
