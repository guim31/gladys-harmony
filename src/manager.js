// -----------------------------------------------------------------------------
// The hub manager: finds the hubs, keeps one live link per hub, publishes
// their devices and states to Gladys, fires the scene triggers and runs the
// commands.
//
// Real time: every hub pushes a notification over its WebSocket when an
// activity starts or everything turns off, whatever made it (the Harmony
// remote, the app, Gladys). On top of that, the manager reads the current
// activity of every connected hub every 30 s: it catches a missed
// notification, keeps the states fresh without Gladys' scheduler (the devices
// are published with should_poll: false, see Gladys#3198) and proves the
// link is alive (no answer: the client reconnects).
//
// Logs: the info level only tells the life of the hubs (found, connected,
// lost, back) and one line per user action. Notifications, reads and
// reconnection attempts are debug lines; a failure that repeats is logged
// once when it starts and once when it is over (src/issues.js).
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import {
  DEVICE_TYPES,
  FEATURE_KEYS,
  REMOTE_KEYS,
  activityIds,
  activityLabel,
  applianceIds,
  buildHubDevices,
  controllableDevices,
  hubIds,
  hubName,
  hubStates,
  remoteKeyCommand,
} from './devices.js';
import { SCAN_TIMEOUT_SECONDS, hubAddresses, mapLimit } from './discovery.js';
import { HarmonyClient, fetchProvisionInfo } from './harmony/client.js';
import {
  findActivity,
  findCommand,
  findDevice,
  parseConfig,
  restoreModel,
} from './harmony/model.js';
import { ACTIVITY_STATUS, NOTIFICATIONS, POWER_OFF_ID } from './harmony/protocol.js';
import { IssueLog } from './issues.js';
import { CONNECTION_TEXT, localizedError } from './messages.js';

const logger = createLogger({ name: 'harmony' });

export const WIDGET_KEY = 'harmony';

export const TRIGGERS = {
  ACTIVITY_STARTED: 'activity_started',
  POWERED_OFF: 'powered_off',
};

export const MANAGER_TIMINGS = {
  // Read of the current activity of every connected hub.
  refreshMs: 30_000,
  // New search (SSDP + typed addresses), to follow DHCP changes and new hubs.
  rediscoveryMs: 15 * 60_000,
  // An unchanged state is sent again this often, so Gladys never shows it as
  // stale ("no recent value" past 48 h).
  heartbeatMs: 6 * 3_600_000,
  // An activity start in progress: the reads disagreeing with it are ignored
  // for this long (the hub may still answer the previous activity).
  startingMs: 60_000,
  // Loop guard: at most this many scene events per hub in the window. Two
  // scenes starting each other's activity would bounce forever otherwise.
  eventWindowMs: 60_000,
  maxEventsPerWindow: 6,
  // A hub not seen for this long, and not typed in the configuration, is
  // forgotten (sold, reset: it got a new hub id).
  forgetAfterMs: 30 * 24 * 3_600_000,
};

const PROBE_CONCURRENCY = 4;
const MAX_STATES_PER_REQUEST = 100;

export class HubManager {
  /**
   * @param {object} options
   * @param {object} options.gladys GladysIntegration (or the SDK's fake Gladys)
   * @param {object} options.store persistence (src/store.js)
   * @param {typeof fetch} [options.fetch] test seam for the HTTP request
   * @param {(url: string) => WebSocket} [options.createSocket] test seam
   * @param {boolean} [options.timers] periodic timers (off in most tests)
   * @param {object} [options.timings] MANAGER_TIMINGS overrides
   * @param {object} [options.clientTimings] CLIENT_TIMINGS overrides
   * @param {() => number} [options.now]
   */
  constructor({ gladys, store, fetch, createSocket, timers = true, timings, clientTimings, now }) {
    this.gladys = gladys;
    this.store = store;
    this.fetch = fetch ?? globalThis.fetch;
    this.createSocket = createSocket;
    this.timersEnabled = timers;
    this.timings = { ...MANAGER_TIMINGS, ...timings };
    this.clientTimings = clientTimings;
    this.now = now ?? (() => Date.now());
    this.config = null;
    /** @type {Map<string, object>} hub records, by hub id */
    this.hubs = new Map();
    this.pending = new Set();
    this.refreshTimer = null;
    this.rediscoveryTimer = null;
    this.lastScan = { ssdp: 'not-run', notHubs: [] };
    this.lastDevices = null;
    this.stopped = false;
    this.issues = new IssueLog(logger);
  }

  // --- Lifecycle -------------------------------------------------------------

  async start(config) {
    this.config = config;
    await this.restore();
    await this.discover();
    await this.publishDevices({ force: true });
    for (const hub of this.hubs.values()) {
      this.connect(hub);
    }
    await this.publishConnectionStatus();
    if (this.timersEnabled) {
      this.refreshTimer = setInterval(() => this.track(this.refreshAll()), this.timings.refreshMs);
      this.refreshTimer.unref?.();
      this.rediscoveryTimer = setInterval(
        () => this.track(this.rediscover()),
        this.timings.rediscoveryMs,
      );
      this.rediscoveryTimer.unref?.();
    }
  }

  /** Gladys came back (restart, network): it lost the discovered devices and may have lost states. */
  async resync(config) {
    this.config = config;
    this.gladys.forgetPublishedStates?.();
    await this.publishDevices({ force: true });
    for (const hub of this.hubs.values()) {
      await this.publishStates(hub).catch(() => {});
    }
    await this.publishTransports();
    await this.publishConnectionStatus();
    this.requestWidgetRefresh();
  }

  async reconfigure(config) {
    const previous = this.config;
    this.config = config;
    if (!previous || previous.hosts.join(',') !== config.hosts.join(',')) {
      await this.rediscover();
      return;
    }
    // Another language: the "Off" choice of the activity lists is renamed.
    await this.publishDevices();
    await this.publishConnectionStatus();
  }

  async stop() {
    this.stopped = true;
    clearInterval(this.refreshTimer);
    clearInterval(this.rediscoveryTimer);
    for (const hub of this.hubs.values()) {
      hub.client?.stop();
    }
    await this.idle();
    await this.store.flush();
  }

  /** Keep track of background work, so the tests (and stop) can wait for it. */
  track(promise) {
    const tracked = Promise.resolve(promise)
      .catch((err) => {
        // Gladys API failures are already logged (once) by toGladys.
        if (!err?.logged) {
          this.issues.fail(`task:${err?.message}`, `Background task failed: ${err?.message}`);
        }
      })
      .finally(() => this.pending.delete(tracked));
    this.pending.add(tracked);
    return tracked;
  }

  /** Resolves once no background work is left. */
  async idle() {
    while (this.pending.size > 0) {
      await Promise.all([...this.pending]);
    }
  }

  /**
   * Wait (at most `timeoutMs`) for the first answer of the hubs being
   * connected: the search report then says what they are.
   */
  async settle(timeoutMs = 8_000) {
    const end = Date.now() + timeoutMs;
    const waiting = () => [...this.hubs.values()].some((hub) => hub.client && !hub.attempted);
    while (waiting() && Date.now() < end) {
      await sleep(50);
    }
    await this.idle();
  }

  // --- Persistence -----------------------------------------------------------

  createRecord(remoteId, host, domain) {
    return {
      remoteId,
      host,
      domain,
      name: null,
      firmware: null,
      configVersion: null,
      model: { activities: [], devices: [] },
      loaded: false,
      current: null,
      startingUntil: 0,
      client: null,
      reachable: false,
      everConnected: false,
      // A first connection was tried (opened and read, or failed).
      attempted: false,
      lastSeenAt: null,
      lastRefreshAt: 0,
      syncing: null,
      events: [],
    };
  }

  async restore() {
    const data = await this.store.load();
    for (const [remoteId, saved] of Object.entries(data.hubs ?? {})) {
      if (!saved || typeof saved.host !== 'string') {
        continue;
      }
      const hub = this.createRecord(remoteId, saved.host, saved.domain);
      hub.name = typeof saved.name === 'string' ? saved.name : null;
      hub.firmware = typeof saved.firmware === 'string' ? saved.firmware : null;
      hub.configVersion = saved.configVersion ?? null;
      hub.model = restoreModel(saved.model);
      hub.loaded = hub.model.activities.length > 0 || hub.model.devices.length > 0;
      hub.lastSeenAt = Number.isFinite(saved.lastSeenAt) ? saved.lastSeenAt : null;
      this.hubs.set(remoteId, hub);
    }
  }

  save() {
    const hubs = {};
    for (const hub of this.hubs.values()) {
      hubs[hub.remoteId] = {
        host: hub.host,
        domain: hub.domain,
        name: hub.name,
        firmware: hub.firmware,
        configVersion: hub.configVersion,
        model: hub.model,
        lastSeenAt: hub.lastSeenAt,
      };
    }
    return this.store.save({ hubs });
  }

  // --- Discovery -------------------------------------------------------------

  /**
   * Search: SSDP through the Gladys core, the typed addresses and the known
   * ones. Resolves with the number of hubs answering.
   */
  async discover() {
    // Priority when a hub answers on several addresses: the typed one, then
    // the one SSDP announces, then the one known from before.
    const hosts = [];
    const add = (host) => {
      if (!hosts.includes(host)) {
        hosts.push(host);
      }
    };
    this.config.hosts.forEach(add);
    (await this.scanSsdp()).forEach(add);
    [...this.hubs.values()].forEach((hub) => add(hub.host));

    const results = await mapLimit(hosts, PROBE_CONCURRENCY, (host) =>
      fetchProvisionInfo(host, {
        fetch: this.fetch,
        timeoutMs: this.clientTimings?.provisionTimeoutMs,
      }),
    );
    const answers = new Map();
    const notHubs = [];
    results.forEach((result, index) => {
      const host = hosts[index];
      if (result.error) {
        logger.debug(`No Harmony Hub at ${host}: ${result.error.message}`);
        if (this.config.hosts.includes(host)) {
          notHubs.push(host);
        }
      } else if (!answers.has(result.value.remoteId)) {
        answers.set(result.value.remoteId, { host, ...result.value });
      }
    });
    for (const answer of answers.values()) {
      this.adopt(answer);
    }
    this.forgetStaleHubs(answers);
    this.lastScan = { ...this.lastScan, notHubs };
    await this.save();
    return answers.size;
  }

  async scanSsdp() {
    try {
      const results = await this.gladys.scanNetwork('ssdp', {
        timeoutSeconds: SCAN_TIMEOUT_SECONDS,
      });
      this.issues.recover('ssdp', 'SSDP search through Gladys works again');
      this.lastScan = { ...this.lastScan, ssdp: 'ok' };
      return hubAddresses(results);
    } catch (err) {
      // 403: an older core, or the capture refused. Typed addresses still work.
      this.issues.fail('ssdp', `SSDP search through Gladys failed: ${err.message}`);
      this.lastScan = { ...this.lastScan, ssdp: 'unavailable' };
      return [];
    }
  }

  /** A probe answer: a new hub is added, a known one found at a new address (DHCP) moves there. */
  adopt({ host, remoteId, domain }) {
    let hub = this.hubs.get(remoteId);
    if (!hub) {
      hub = this.createRecord(remoteId, host, domain);
      this.hubs.set(remoteId, hub);
      logger.info(`Harmony Hub ${remoteId} found at ${host}`);
    } else if (hub.host !== host || hub.domain !== domain) {
      if (hub.host !== host) {
        logger.info(`${hubName(hub)} moved from ${hub.host} to ${host}`);
      }
      hub.client?.stop();
      hub.client = null;
      hub.attempted = false;
      hub.host = host;
      hub.domain = domain;
    }
    hub.lastSeenAt = this.now();
    return hub;
  }

  forgetStaleHubs(answers) {
    for (const hub of [...this.hubs.values()]) {
      const stale =
        !answers.has(hub.remoteId) &&
        !hub.reachable &&
        !this.config.hosts.includes(hub.host) &&
        hub.lastSeenAt !== null &&
        this.now() - hub.lastSeenAt > this.timings.forgetAfterMs;
      if (stale) {
        logger.info(`${hubName(hub)} not seen for 30 days: forgotten`);
        hub.client?.stop();
        this.hubs.delete(hub.remoteId);
      }
    }
  }

  async rediscover() {
    await this.discover();
    for (const hub of this.hubs.values()) {
      this.connect(hub);
    }
    // New hubs, and new addresses for the params of the created devices.
    await this.publishDevices();
    await this.publishTransports();
    await this.publishConnectionStatus();
  }

  // --- Live link -------------------------------------------------------------

  connect(hub) {
    if (this.stopped || hub.client) {
      return;
    }
    const client = new HarmonyClient({
      host: hub.host,
      remoteId: hub.remoteId,
      domain: hub.domain,
      createSocket: this.createSocket,
      timings: this.clientTimings,
      logger,
    });
    hub.client = client;
    client.on('open', () => this.track(this.onOpen(hub, client)));
    client.on('close', () => this.track(this.reachabilityChanged(hub, false)));
    client.on('failure', () => {
      // The first attempt failing is news even though `reachable` was
      // already false: the badges and the status were never sent.
      const first = !hub.attempted;
      hub.attempted = true;
      this.track(this.reachabilityChanged(hub, false, { force: first }));
    });
    client.on('notification', (message) => this.track(this.onNotification(hub, client, message)));
    client.start();
  }

  async onOpen(hub, client) {
    if (hub.client !== client) {
      return;
    }
    hub.lastSeenAt = this.now();
    try {
      await this.sync(hub);
    } finally {
      // Even when a read failed: the link is up, the next reads will tell.
      if (hub.client === client && client.connected) {
        await this.reachabilityChanged(hub, true);
      }
      hub.attempted = true;
    }
  }

  /**
   * Read what the hub is (name, firmware), its configuration when it changed,
   * and its current activity. Run on every (re)connection: a change made
   * while the link was down is published, without firing a scene event.
   */
  async sync(hub) {
    if (hub.syncing) {
      return hub.syncing;
    }
    hub.syncing = (async () => {
      const client = hub.client;
      const [info, digest] = await Promise.all([
        client
          .getDiscoveryInfo()
          .catch((err) => logger.debug(`${hub.host}: no discovery info (${err.message})`)),
        client
          .getStateDigest()
          .catch((err) => logger.debug(`${hub.host}: no state digest (${err.message})`)),
      ]);
      let devicesChanged = false;
      const name = typeof info?.friendlyName === 'string' ? info.friendlyName.trim() : '';
      if (name !== '' && name !== hub.name) {
        hub.name = name;
        devicesChanged = true;
      }
      const firmware = digest?.hubSwVersion ?? info?.current_fw_version;
      if (typeof firmware === 'string') {
        hub.firmware = firmware;
      }
      const version = digest?.configVersion ?? null;
      if (!hub.loaded || version === null || version !== hub.configVersion) {
        try {
          devicesChanged = (await this.loadConfig(hub, version)) || devicesChanged;
          this.issues.recover(`config:${hub.remoteId}`, `${hubName(hub)}: configuration read`);
        } catch (err) {
          // Tried again on the next read of the timer.
          this.issues.fail(
            `config:${hub.remoteId}`,
            `${hubName(hub)}: configuration not read (${err.message})`,
          );
        }
      }
      if (!hub.everConnected) {
        hub.everConnected = true;
        logger.info(
          `Connected to ${hubName(hub)} (${hub.host}): ${hub.model.activities.length} activities, ${controllableDevices(hub).length} devices`,
        );
      }
      if (devicesChanged) {
        await this.publishDevices();
      }
      await this.refresh(hub, { live: false });
      await this.save();
    })();
    try {
      await hub.syncing;
    } finally {
      hub.syncing = null;
    }
  }

  /** Read the configuration. Resolves with true when the activities or devices changed. */
  async loadConfig(hub, version = null) {
    const raw = await hub.client.getConfig();
    const model = parseConfig(raw);
    const changed = JSON.stringify(model) !== JSON.stringify(hub.model);
    hub.model = model;
    hub.loaded = true;
    hub.configVersion = version;
    if (changed) {
      logger.debug(
        `${hubName(hub)}: configuration read (${model.activities.length} activities, ${model.devices.length} devices)`,
      );
    }
    return changed;
  }

  async reachabilityChanged(hub, reachable, { force = false } = {}) {
    if (hub.reachable === reachable && !force) {
      return;
    }
    hub.reachable = reachable;
    if (reachable) {
      this.issues.recover(`hub:${hub.remoteId}`, `${hubName(hub)} (${hub.host}) answers again`);
    } else {
      this.issues.fail(
        `hub:${hub.remoteId}`,
        `${hubName(hub)} (${hub.host}) unreachable, retrying in the background`,
      );
    }
    await this.publishTransports([hub]);
    await this.publishConnectionStatus();
    this.requestWidgetRefresh();
  }

  async onNotification(hub, client, message) {
    if (hub.client !== client) {
      return;
    }
    hub.lastSeenAt = this.now();
    const data = message.data && typeof message.data === 'object' ? message.data : {};
    logger.debug(`${hubName(hub)}: ${message.type} ${JSON.stringify(pick(data))}`);
    if (message.type === NOTIFICATIONS.activityFinished) {
      if (data.activityId !== undefined) {
        hub.startingUntil = 0;
        await this.applyActivity(hub, String(data.activityId), { live: true });
      }
      return;
    }
    if (message.type !== NOTIFICATIONS.stateDigest) {
      return;
    }
    // The configuration changed in the app (an activity added...): read it
    // again, once the hub is done syncing with the cloud.
    const version = data.configVersion;
    if (
      version !== undefined &&
      hub.configVersion !== null &&
      version !== hub.configVersion &&
      Number(data.syncStatus) !== 1
    ) {
      if (await this.loadConfig(hub, version)) {
        await this.publishDevices();
        this.requestWidgetRefresh();
      }
    }
    const status = Number(data.activityStatus);
    const activityId = data.activityId === undefined ? null : String(data.activityId);
    if (status === ACTIVITY_STATUS.STARTING && activityId !== null && activityId !== POWER_OFF_ID) {
      hub.startingUntil = this.now() + this.timings.startingMs;
      await this.applyActivity(hub, activityId, { live: true });
    } else if (status === ACTIVITY_STATUS.STARTED && activityId !== null) {
      hub.startingUntil = 0;
      await this.applyActivity(hub, activityId, { live: true });
    } else if (status === ACTIVITY_STATUS.OFF) {
      hub.startingUntil = 0;
      await this.applyActivity(hub, POWER_OFF_ID, { live: true });
    }
  }

  /**
   * Read the current activity (timer, Gladys poll, after a command).
   * @param {object} hub
   * @param {{ live?: boolean }} [options] live: a change fires the scene triggers
   */
  async refresh(hub, { live = true } = {}) {
    const client = hub.client;
    if (!client?.connected) {
      return;
    }
    hub.lastRefreshAt = this.now();
    let activityId;
    try {
      activityId = await client.getCurrentActivity();
    } catch (err) {
      // A dead link is closed by the client and reported by 'close'.
      logger.debug(`${hubName(hub)}: current activity not read (${err.message})`);
      return;
    }
    hub.lastSeenAt = this.now();
    if (hub.startingUntil > this.now() && activityId !== hub.current) {
      // A start in progress: the hub may still answer the previous activity.
      return;
    }
    await this.applyActivity(hub, activityId, { live });
    // Published even when nothing changed: the heartbeat of unchanged values.
    await this.publishStates(hub).catch(() => {});
  }

  async refreshAll() {
    for (const hub of this.hubs.values()) {
      if (hub.client?.connected && !hub.loaded) {
        await this.sync(hub).catch(() => {});
      } else {
        await this.refresh(hub);
      }
    }
  }

  /** Gladys' poll (not scheduled: should_poll is false), skipped when the timer just read. */
  async poll(device) {
    const resolved = this.resolveDevice(device?.external_id);
    if (!resolved) {
      return;
    }
    if (this.now() - resolved.hub.lastRefreshAt < this.timings.refreshMs / 2) {
      return;
    }
    await this.refresh(resolved.hub);
  }

  /** The hub says (or a read shows) that `activityId` is now running. */
  async applyActivity(hub, activityId, { live }) {
    const previous = hub.current;
    if (previous === activityId) {
      return;
    }
    hub.current = activityId;
    logger.debug(`${hubName(hub)}: activity ${activityLabel(hub, activityId, 'en')}`);
    if (activityId !== POWER_OFF_ID && hub.loaded && !findActivity(hub.model, activityId)) {
      // Created in the app since the configuration was read.
      this.track(
        this.loadConfig(hub).then((changed) => (changed ? this.publishDevices() : undefined)),
      );
    }
    await this.publishStates(hub).catch(() => {});
    this.requestWidgetRefresh();
    if (live && previous !== null) {
      this.fireTransition(hub, previous, activityId);
    }
  }

  // --- Scene events ----------------------------------------------------------

  fireTransition(hub, previous, current) {
    const now = this.now();
    hub.events = hub.events.filter((at) => now - at < this.timings.eventWindowMs);
    if (hub.events.length >= this.timings.maxEventsPerWindow) {
      this.issues.fail(
        `loop:${hub.remoteId}`,
        `${hubName(hub)}: too many activity changes in a minute, scene events paused (do two scenes start each other's activity?)`,
      );
      return;
    }
    this.issues.recover(`loop:${hub.remoteId}`, `${hubName(hub)}: scene events resumed`);
    hub.events.push(now);
    const language = this.config.language;
    const base = {
      hub: hubIds(this.gladys, hub.remoteId).device,
      hub_name: hubName(hub),
      previous_activity_name: activityLabel(hub, previous, language),
    };
    if (current === POWER_OFF_ID) {
      this.track(this.toGladys('publishSceneEvent', TRIGGERS.POWERED_OFF, base));
      return;
    }
    this.track(
      this.toGladys('publishSceneEvent', TRIGGERS.ACTIVITY_STARTED, {
        ...base,
        activity: activityIds(this.gladys, hub.remoteId, current).device,
        activity_name: activityLabel(hub, current, language),
      }),
    );
  }

  // --- Devices and states ----------------------------------------------------

  buildAllDevices() {
    const devices = [];
    for (const hub of this.hubs.values()) {
      devices.push(...buildHubDevices(this.gladys, hub, this.config.language));
    }
    return devices;
  }

  async publishDevices({ force = false } = {}) {
    const devices = this.buildAllDevices();
    const serialized = JSON.stringify(devices);
    if (!force && serialized === this.lastDevices) {
      return;
    }
    await this.toGladys('publishDiscoveredDevices', devices);
    this.lastDevices = serialized;
  }

  /** External ids of the devices the user created in Gladys. */
  createdDeviceIds() {
    return new Set((this.gladys.devices ?? []).map((device) => device.external_id));
  }

  /**
   * Publish the states of the created devices of one hub. The SDK only sends
   * what changed (Gladys caps states at 300 a minute and re-evaluates the
   * scenes on each one), plus the unchanged ones past the heartbeat.
   */
  async publishStates(hub) {
    const created = this.createdDeviceIds();
    const states = hubStates(this.gladys, hub, this.config.language)
      .filter(({ id }) => created.has(id.slice(0, id.lastIndexOf(':'))))
      .map(({ id, value }) =>
        typeof value === 'object'
          ? { device_feature_external_id: id, text: value.text }
          : { device_feature_external_id: id, state: value },
      );
    if (states.length === 0) {
      return;
    }
    await this.toGladys('publishChangedStates', states, { heartbeat: this.timings.heartbeatMs });
  }

  /** The user added a device: Gladys dropped the states sent before. */
  async onDeviceCreated(device) {
    const resolved = this.resolveDevice(device?.external_id);
    if (!resolved) {
      return;
    }
    this.gladys.forgetPublishedStates?.(device.external_id);
    await this.publishStates(resolved.hub);
    await this.publishTransports([resolved.hub]);
    this.requestWidgetRefresh();
  }

  /** The cloud/local badge of the created devices: local, or unreachable. */
  async publishTransports(hubs = [...this.hubs.values()]) {
    const created = this.createdDeviceIds();
    const entries = [];
    for (const hub of hubs) {
      const transport = hub.reachable ? 'local' : 'unreachable';
      for (const externalId of this.deviceIdsOf(hub)) {
        if (created.has(externalId)) {
          entries.push({ external_id: externalId, transport });
        }
      }
    }
    for (let at = 0; at < entries.length; at += MAX_STATES_PER_REQUEST) {
      await this.toGladys('publishTransports', entries.slice(at, at + MAX_STATES_PER_REQUEST));
    }
  }

  deviceIdsOf(hub) {
    return [
      hubIds(this.gladys, hub.remoteId).device,
      ...hub.model.activities.map((a) => activityIds(this.gladys, hub.remoteId, a.id).device),
      ...hub.model.devices.map((d) => applianceIds(this.gladys, hub.remoteId, d.id).device),
    ];
  }

  async publishConnectionStatus() {
    const hubs = [...this.hubs.values()];
    if (hubs.length === 0) {
      await this.toGladys('setConnectionStatus', false, CONNECTION_TEXT.noHub);
      return;
    }
    if (!hubs.some((hub) => hub.reachable)) {
      await this.toGladys('setConnectionStatus', false, CONNECTION_TEXT.noAnswer);
      return;
    }
    await this.toGladys('setConnectionStatus', true);
  }

  /**
   * A call to the Gladys host API. While Gladys restarts every call fails:
   * one warning when it starts, one info line when Gladys accepts them again.
   * The error is marked `logged` and thrown on.
   */
  async toGladys(method, ...args) {
    try {
      const result = await this.gladys[method](...args);
      this.issues.recover('gladys', 'Gladys accepts the updates again');
      return result;
    } catch (err) {
      this.issues.fail('gladys', `Gladys refused an update (${method}): ${err.message}`);
      if (err && typeof err === 'object') {
        err.logged = true;
      }
      throw err;
    }
  }

  requestWidgetRefresh() {
    try {
      this.gladys.requestWidgetRefresh(WIDGET_KEY);
    } catch (err) {
      logger.debug(`Widget refresh not sent: ${err.message}`);
    }
  }

  // --- Commands --------------------------------------------------------------

  /**
   * The hub, activity or appliance behind a Gladys device external id.
   * @returns {{ kind: string, hub: object, activity?: object, appliance?: object } | null}
   */
  resolveDevice(externalId) {
    if (typeof externalId !== 'string') {
      return null;
    }
    const hubPrefix = hubIds(this.gladys, '').device;
    if (externalId.startsWith(hubPrefix)) {
      const hub = this.hubs.get(externalId.slice(hubPrefix.length));
      return hub ? { kind: DEVICE_TYPES.HUB, hub } : null;
    }
    for (const kind of [DEVICE_TYPES.ACTIVITY, DEVICE_TYPES.DEVICE]) {
      const prefix = this.gladys.externalIds(kind, '').device;
      if (!externalId.startsWith(prefix)) {
        continue;
      }
      const rest = externalId.slice(prefix.length);
      for (const hub of this.hubs.values()) {
        if (!rest.startsWith(`${hub.remoteId}-`)) {
          continue;
        }
        const id = rest.slice(hub.remoteId.length + 1);
        if (kind === DEVICE_TYPES.ACTIVITY) {
          const activity = hub.model.activities.find((a) => a.id === id);
          return activity ? { kind, hub, activity } : null;
        }
        const appliance = findDevice(hub.model, id);
        return appliance ? { kind, hub, appliance } : null;
      }
    }
    return null;
  }

  /** Same as resolveDevice, or a localized error. */
  require(externalId) {
    const resolved = this.resolveDevice(externalId);
    if (!resolved) {
      throw localizedError(this.config.language, 'unknownDevice');
    }
    return resolved;
  }

  connectedClient(hub) {
    if (!hub.client?.connected) {
      throw localizedError(this.config.language, 'unreachable', hubName(hub));
    }
    return hub.client;
  }

  /** A Gladys command on a feature of one of the devices. */
  async setValue(device, feature, value) {
    const resolved = this.require(device?.external_id);
    const prefix = `${device.external_id}:`;
    const key = feature?.external_id?.startsWith(prefix)
      ? feature.external_id.slice(prefix.length)
      : null;
    const { kind, hub } = resolved;

    if (kind === DEVICE_TYPES.HUB && key === FEATURE_KEYS.ACTIVITY) {
      const wanted = String(value);
      if (wanted !== POWER_OFF_ID && !findActivity(hub.model, wanted)) {
        throw localizedError(this.config.language, 'unknownActivity', wanted);
      }
      await this.startActivity(hub, wanted);
      return;
    }
    if (kind === DEVICE_TYPES.ACTIVITY && key === FEATURE_KEYS.RUNNING) {
      if (Number(value) === 1) {
        await this.startActivity(hub, resolved.activity.id);
      } else if (hub.current === resolved.activity.id) {
        await this.startActivity(hub, POWER_OFF_ID);
      } else {
        // Already not running: show the real state back.
        this.gladys.forgetPublishedStates?.(feature.external_id);
        await this.publishStates(hub);
      }
      return;
    }
    if (kind === DEVICE_TYPES.DEVICE && key === FEATURE_KEYS.COMMAND) {
      await this.sendCommand(hub, resolved.appliance, String(value));
      return;
    }
    const remoteKey = REMOTE_KEYS.find((candidate) => candidate.type === key);
    if (kind === DEVICE_TYPES.DEVICE && remoteKey) {
      const command = remoteKeyCommand(resolved.appliance, remoteKey);
      if (command) {
        await this.sendCommand(hub, resolved.appliance, command.name);
        return;
      }
    }
    throw new Error(`No command for ${feature?.external_id}`);
  }

  /**
   * Start an activity ('-1' turns everything off) and wait for the hub to be
   * done, or only for the hub to accept it (`untilAccepted`: a widget button
   * answers at once, the notifications follow). Nothing is sent when it
   * already runs.
   */
  async startActivity(hub, activityId, { untilAccepted = false } = {}) {
    const language = this.config.language;
    const label = activityLabel(hub, activityId, language);
    if (hub.current === activityId) {
      return;
    }
    const client = this.connectedClient(hub);
    logger.info(
      activityId === POWER_OFF_ID
        ? `Turning off everything on ${hubName(hub)}`
        : `Starting ${label} on ${hubName(hub)}`,
    );
    hub.startingUntil = this.now() + this.timings.startingMs;
    try {
      await client.startActivity(activityId, { untilAccepted });
    } catch (err) {
      hub.startingUntil = 0;
      throw activityId === POWER_OFF_ID
        ? localizedError(language, 'powerOffFailed', err.message)
        : localizedError(language, 'activityFailed', label, err.message);
    }
    if (untilAccepted) {
      return;
    }
    hub.startingUntil = 0;
    // The notifications usually came first; this read confirms and publishes.
    await this.refresh(hub);
  }

  /**
   * Send one command of an appliance, `repeat` times with `delayMs` between
   * two (volume steps...).
   */
  async sendCommand(hub, appliance, reference, { repeat = 1, delayMs = 0 } = {}) {
    const language = this.config.language;
    const command = findCommand(appliance, reference);
    if (!command) {
      throw localizedError(language, 'unknownCommand', reference, appliance.label);
    }
    const client = this.connectedClient(hub);
    logger.info(
      `Sending ${command.name} to ${appliance.label}${repeat > 1 ? ` (${repeat} times)` : ''}`,
    );
    for (let index = 0; index < repeat; index += 1) {
      if (index > 0 && delayMs > 0) {
        await sleep(delayMs);
      }
      try {
        await client.sendCommand(appliance.id, command.name);
      } catch (err) {
        throw localizedError(language, 'commandFailed', command.label, err.message);
      }
    }
    return command;
  }

  /** What the Configuration screen's "Search" action reports. */
  summary() {
    return {
      ssdp: this.lastScan.ssdp,
      notHubs: this.lastScan.notHubs,
      invalidHosts: this.config.invalidHosts,
      hubs: [...this.hubs.values()].map((hub) => ({
        name: hubName(hub),
        host: hub.host,
        reachable: hub.reachable,
        activities: hub.model.activities.length,
        devices: controllableDevices(hub).length,
      })),
    };
  }
}

/** The few fields of a notification worth a debug line. */
function pick(data) {
  const { activityId, activityStatus, configVersion, syncStatus } = data;
  return { activityId, activityStatus, configVersion, syncStatus };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
