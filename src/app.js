// -----------------------------------------------------------------------------
// Registers every SDK handler on a GladysIntegration (or the SDK's fake
// Gladys) and returns the manager, so index.js stays a few lines and the tests
// drive the very same wiring.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { normalizeConfig } from './config.js';
import { HubManager } from './manager.js';
import { CONNECTION_TEXT, searchMessage } from './messages.js';
import { SCENE_ACTIONS } from './scenes.js';
import { Store } from './store.js';
import { WIDGETS } from './widgets.js';

const logger = createLogger({ name: 'harmony-app' });

/**
 * @param {object} gladys GladysIntegration instance
 * @param {object} [options] test seams: store, fetch, createSocket, timers, timings, clientTimings, now
 */
export function registerHandlers(gladys, options = {}) {
  const manager = new HubManager({
    gladys,
    store: options.store ?? new Store(),
    fetch: options.fetch,
    createSocket: options.createSocket,
    timers: options.timers ?? true,
    timings: options.timings,
    clientTimings: options.clientTimings,
    now: options.now,
  });

  // Resolved once the manager has started; every handler waits for it, so a
  // command arriving during the first search is not lost.
  let resolveReady;
  const ready = new Promise((resolve) => {
    resolveReady = resolve;
  });
  let started = false;
  const whenReady =
    (fn) =>
    async (...args) => {
      await ready;
      return fn(...args);
    };

  gladys.on('connected', async () => {
    try {
      const config = normalizeConfig(await gladys.getConfig());
      if (started) {
        // A reconnection (Gladys restarted): re-send what Gladys may have lost.
        await manager.resync(config);
        return;
      }
      started = true;
      await manager.start(config);
    } catch (err) {
      logger.error('Initialization failed', err);
      await gladys.setConnectionStatus(false, CONNECTION_TEXT.initFailed).catch(() => {});
    } finally {
      resolveReady();
    }
  });

  gladys.onScanRequest(whenReady(() => manager.rediscover()));

  gladys.onSetValue(
    whenReady((device, feature, value) => manager.setValue(device, feature, value)),
  );

  // The devices are published with should_poll: false (pushed over the hub's
  // WebSocket, refreshed by the manager's timer); this only serves a Gladys
  // that would poll anyway.
  gladys.onPoll(whenReady((device) => manager.poll(device)));

  gladys.onDeviceCreated(whenReady((device) => manager.onDeviceCreated(device)));

  gladys.onConfigUpdated(
    whenReady(async (newConfig) => {
      await manager.reconfigure(normalizeConfig(newConfig));
    }),
  );

  gladys.onAction(
    'search',
    whenReady(async () => {
      await manager.rediscover();
      // The hubs found just now: give their WebSocket a moment to say who they are.
      await manager.settle?.();
      return searchMessage(manager.summary());
    }),
  );

  for (const [key, handler] of Object.entries(SCENE_ACTIONS)) {
    gladys.onSceneAction(
      key,
      whenReady((fields) => handler(manager, { fields })),
    );
  }

  for (const [key, widget] of Object.entries(WIDGETS)) {
    gladys.onWidgetGet(
      key,
      whenReady((request) => widget.get(manager, request)),
    );
    gladys.onWidgetAction(
      key,
      whenReady((actionKey, params, context = {}) =>
        widget.action(manager, { actionKey, params, ...context }),
      ),
    );
  }

  return {
    manager,
    ready,
    stop: () => manager.stop(),
  };
}
