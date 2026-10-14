// -----------------------------------------------------------------------------
// A complete test world: the SDK's fake Gladys, simulated hubs, a temporary
// /data, and the integration wired on top through registerHandlers.
// -----------------------------------------------------------------------------

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { registerHandlers } from '../../src/app.js';
import { activityIds, applianceIds, hubIds } from '../../src/devices.js';
import { Store } from '../../src/store.js';
import { createHub, createNetwork, settle } from './fakeHub.js';

/**
 * @param {object} [options]
 * @param {Array} [options.hubs] from createHub
 * @param {object} [options.config] raw integration config
 * @param {boolean} [options.ssdp] the core answers the SSDP search (false: 403)
 * @param {Array} [options.gladysDevices] devices already created in Gladys
 * @param {boolean} [options.connect]
 * @param {string} [options.dataDir]
 * @param {boolean} [options.timers] run the manager's own timers
 * @param {object} [options.timings] manager timing overrides
 * @param {object} [options.clientTimings] client timing overrides
 */
export async function createWorld({
  hubs = [createHub()],
  config = {},
  ssdp = true,
  gladysDevices = [],
  connect = true,
  dataDir = mkdtempSync(join(tmpdir(), 'gladys-harmony-')),
  timers = false,
  timings = {},
  clientTimings = {},
  now,
} = {}) {
  const network = createNetwork(hubs);
  const gladys = createFakeGladys({
    config,
    devices: gladysDevices,
    scanResults: { ssdp: network.ssdpResults() },
  });
  if (!ssdp) {
    gladys.scanNetwork = async () => {
      const err = new Error('FORBIDDEN: network discovery not declared');
      err.status = 403;
      throw err;
    };
  }
  const app = registerHandlers(gladys, {
    store: new Store(dataDir),
    fetch: network.fetch,
    createSocket: network.createSocket,
    timers,
    timings,
    clientTimings: { reconnectMinMs: 5, reconnectMaxMs: 20, ...clientTimings },
    now,
  });
  const world = { gladys, network, app, manager: app.manager, dataDir, hubs };
  if (connect) {
    await gladys.connect();
    await app.ready;
    await settle(app.manager);
  }
  return world;
}

/** Create discovered devices in Gladys, as the user would (all of them by default). */
export async function createDevices(world, filter = () => true) {
  for (const device of world.gladys.fake.discoveredDevices.filter(filter)) {
    await world.gladys.fake.deviceCreated(device);
  }
  await settle(world.manager);
}

export const ids = {
  hub: (world, hub) => hubIds(world.gladys, hub.remoteId),
  activity: (world, hub, activityId) => activityIds(world.gladys, hub.remoteId, activityId),
  appliance: (world, hub, deviceId) => applianceIds(world.gladys, hub.remoteId, deviceId),
};

/** The discovered (or created) device with this external id. */
export function deviceOf(world, externalId) {
  return (
    world.gladys.devices.find((device) => device.external_id === externalId) ??
    world.gladys.fake.discoveredDevices.find((device) => device.external_id === externalId)
  );
}

/** A feature of a device, by its key. */
export function featureOf(device, key) {
  return device.features.find((feature) => feature.external_id === `${device.external_id}:${key}`);
}

export { settle };
