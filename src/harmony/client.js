// -----------------------------------------------------------------------------
// Client of one Harmony Hub: the provisioning request over HTTP, then one
// WebSocket that stays open, carries the requests (answered by `id`) and the
// notifications the hub pushes on every change (`type`).
//
// The link reconnects by itself with a growing delay. A link that went silent
// (hub unplugged without closing it) is found by the requests the hub manager
// sends every 30 s: one left unanswered while nothing at all came back closes
// the socket, and the reconnection starts.
//
// Node.js 22+ ships a standard WebSocket client and fetch: no dependency.
// -----------------------------------------------------------------------------

import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import {
  ACTIVITY_PROGRESS,
  ACTIVITY_STATUS,
  COMMANDS,
  DEFAULT_DOMAIN,
  NOTIFICATIONS,
  POWER_OFF_ID,
  buildRequest,
  codeOf,
  holdActionParams,
  provisionRequest,
  runActivityParams,
  websocketUrl,
} from './protocol.js';

export const CLIENT_TIMINGS = {
  provisionTimeoutMs: 5_000,
  connectTimeoutMs: 10_000,
  requestTimeoutMs: 10_000,
  // Starting an activity powers devices on one after the other: it can take
  // half a minute on a large setup.
  activityTimeoutMs: 60_000,
  // How long a key press waits for the hub to refuse it.
  commandAnswerMs: 1_000,
  reconnectMinMs: 2_000,
  reconnectMaxMs: 60_000,
};

/** An error of the hub or of the link, with a `kind` the caller can act on. */
export class HarmonyError extends Error {
  /**
   * @param {string} message
   * @param {'unreachable'|'not-harmony'|'refused'|'timeout'|'disconnected'} kind
   * @param {number|null} [code] the hub's code, for a refusal
   */
  constructor(message, kind, code = null) {
    super(message);
    this.name = 'HarmonyError';
    this.kind = kind;
    this.code = code;
  }
}

/**
 * Ask an address whether it is a Harmony Hub. Only the hub id and the domain
 * are kept: the answer also holds the Logitech account (e-mail, account id),
 * which never leaves this function.
 * @returns {Promise<{ remoteId: string, domain: string }>}
 */
export async function fetchProvisionInfo(
  host,
  { fetch = globalThis.fetch, timeoutMs = CLIENT_TIMINGS.provisionTimeoutMs } = {},
) {
  const request = provisionRequest();
  // A plain timer rather than AbortSignal.timeout(): its timer would not keep
  // the process waiting for the answer.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response;
  let body;
  try {
    response = await fetch(request.url(host), {
      method: 'POST',
      headers: request.headers,
      body: request.body,
      signal: controller.signal,
    });
    if (response.ok) {
      body = await response.json().catch(() => undefined);
    }
  } catch (err) {
    throw new HarmonyError(
      controller.signal.aborted
        ? `no answer within ${timeoutMs / 1000} s`
        : `cannot connect (${errorText(err)})`,
      'unreachable',
    );
  } finally {
    clearTimeout(timer);
  }
  if (!response.ok) {
    throw new HarmonyError(`HTTP ${response.status}, not a Harmony Hub`, 'not-harmony');
  }
  if (body === undefined) {
    throw new HarmonyError('the answer is not JSON, not a Harmony Hub', 'not-harmony');
  }
  const remoteId = body?.data?.activeRemoteId;
  if (remoteId === undefined || remoteId === null || String(remoteId).trim() === '') {
    throw new HarmonyError('the answer has no hub id, not a Harmony Hub', 'not-harmony');
  }
  return { remoteId: String(remoteId), domain: domainOf(body.data.discoveryServer) };
}

function domainOf(discoveryServer) {
  try {
    return new URL(String(discoveryServer)).host || DEFAULT_DOMAIN;
  } catch {
    return DEFAULT_DOMAIN;
  }
}

/** The useful part of a low-level error (undici wraps it in `cause`). */
function errorText(err) {
  return err?.cause?.code ?? err?.cause?.message ?? err?.message ?? String(err);
}

export class HarmonyClient extends EventEmitter {
  /**
   * @param {object} options
   * @param {string} options.host
   * @param {string} options.remoteId the hub id (fetchProvisionInfo)
   * @param {string} [options.domain]
   * @param {(url: string) => WebSocket} [options.createSocket] test seam
   * @param {object} [options.timings] CLIENT_TIMINGS overrides
   * @param {object} [options.logger]
   */
  constructor({ host, remoteId, domain, createSocket, timings, logger }) {
    super();
    this.host = host;
    this.remoteId = remoteId;
    this.domain = domain ?? DEFAULT_DOMAIN;
    this.createSocket = createSocket ?? ((url) => new WebSocket(url));
    this.timings = { ...CLIENT_TIMINGS, ...timings };
    this.logger = logger;
    this.socket = null;
    this.connected = false;
    this.stopped = true;
    this.delay = this.timings.reconnectMinMs;
    this.reconnectTimer = null;
    this.connectTimer = null;
    /** @type {Map<string, (message: object) => void>} answers awaited, by request id */
    this.pending = new Map();
    /** Called with every notification (activity starts in progress). */
    this.watchers = new Set();
    this.lastMessageAt = 0;
  }

  get url() {
    return websocketUrl(this.host, { domain: this.domain, remoteId: this.remoteId });
  }

  start() {
    if (!this.stopped) {
      return;
    }
    this.stopped = false;
    this.connect();
  }

  stop() {
    this.stopped = true;
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.teardown(new HarmonyError('the connection was closed', 'disconnected'));
  }

  // --- Connection --------------------------------------------------------------

  connect() {
    let socket;
    try {
      socket = this.createSocket(this.url);
    } catch (err) {
      this.failed(err);
      return;
    }
    this.socket = socket;
    this.connectTimer = setTimeout(() => {
      if (this.socket === socket && !this.connected) {
        this.teardown(new HarmonyError('connection timed out', 'unreachable'));
        this.failed(new Error(`no answer within ${this.timings.connectTimeoutMs / 1000} s`));
      }
    }, this.timings.connectTimeoutMs);

    socket.addEventListener('open', () => {
      if (this.socket !== socket) {
        return;
      }
      clearTimeout(this.connectTimer);
      this.connectTimer = null;
      this.connected = true;
      this.delay = this.timings.reconnectMinMs;
      this.lastMessageAt = Date.now();
      this.logger?.debug(`${this.host}: WebSocket open`);
      this.emit('open');
    });
    socket.addEventListener('message', (event) => {
      if (this.socket === socket) {
        this.receive(event.data);
      }
    });
    const closed = (event) => {
      if (this.socket !== socket) {
        return;
      }
      const wasConnected = this.connected;
      this.teardown(new HarmonyError('the connection was lost', 'disconnected'));
      if (wasConnected) {
        this.logger?.debug(`${this.host}: WebSocket closed`);
        this.emit('close');
        this.scheduleReconnect();
      } else {
        this.failed(event?.error ?? new Error(event?.message || 'connection refused'));
      }
    };
    socket.addEventListener('close', closed);
    socket.addEventListener('error', closed);
  }

  /** A connection attempt failed before opening. */
  failed(err) {
    this.logger?.debug(`${this.host}: WebSocket attempt failed (${errorText(err)})`);
    this.emit('failure', new HarmonyError(errorText(err), 'unreachable'));
    this.scheduleReconnect();
  }

  scheduleReconnect() {
    if (this.stopped || this.reconnectTimer) {
      return;
    }
    const delay = this.delay;
    this.delay = Math.min(this.delay * 2, this.timings.reconnectMaxMs);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (!this.stopped && !this.socket) {
        this.connect();
      }
    }, delay);
    this.reconnectTimer.unref?.();
  }

  /** Close the socket (if any) and fail every pending request with `reason`. */
  teardown(reason) {
    clearTimeout(this.connectTimer);
    this.connectTimer = null;
    const socket = this.socket;
    this.socket = null;
    this.connected = false;
    if (socket) {
      try {
        socket.close();
      } catch {
        // already closed
      }
    }
    const pending = [...this.pending.values()];
    this.pending.clear();
    for (const handler of pending) {
      handler({ failure: reason });
    }
    for (const watcher of [...this.watchers]) {
      watcher({ failure: reason });
    }
  }

  /** Drop a link that stopped answering, then reconnect. */
  drop(reason) {
    if (!this.connected) {
      return;
    }
    this.logger?.debug(`${this.host}: ${reason}, reconnecting`);
    this.teardown(new HarmonyError(reason, 'disconnected'));
    this.emit('close');
    this.scheduleReconnect();
  }

  // --- Messages ----------------------------------------------------------------

  receive(raw) {
    if (typeof raw !== 'string') {
      return;
    }
    let message;
    try {
      message = JSON.parse(raw);
    } catch {
      this.logger?.debug(`${this.host}: invalid JSON ignored`);
      return;
    }
    if (!message || typeof message !== 'object') {
      return;
    }
    this.lastMessageAt = Date.now();
    const id = message.id === undefined || message.id === null ? null : String(message.id);
    if (id !== null && this.pending.has(id)) {
      this.pending.get(id)(message);
    }
    if (typeof message.type === 'string') {
      for (const watcher of [...this.watchers]) {
        watcher(message);
      }
      this.emit('notification', message);
    }
  }

  send(cmd, params, id = randomUUID()) {
    if (!this.connected || !this.socket) {
      throw new HarmonyError('the hub is not connected', 'disconnected');
    }
    this.socket.send(JSON.stringify(buildRequest(this.remoteId, cmd, params, id)));
    return id;
  }

  /**
   * One request, resolved with the hub's answer (`code` 200).
   * @returns {Promise<object>} the whole answer; `data` holds the payload
   */
  request(cmd, params, { timeoutMs = this.timings.requestTimeoutMs } = {}) {
    return new Promise((resolve, reject) => {
      const id = randomUUID();
      const sentAt = Date.now();
      const finish = (err, message) => {
        clearTimeout(timer);
        this.pending.delete(id);
        if (err) {
          reject(err);
        } else {
          resolve(message);
        }
      };
      const timer = setTimeout(() => {
        finish(new HarmonyError(`no answer to ${shortName(cmd)}`, 'timeout'));
        // Nothing at all came back since the request: the link is dead.
        if (this.lastMessageAt < sentAt) {
          this.drop(`no answer to ${shortName(cmd)}`);
        }
      }, timeoutMs);
      this.pending.set(id, (message) => {
        if (message.failure) {
          finish(message.failure);
          return;
        }
        const code = codeOf(message);
        if (code === 100) {
          return;
        }
        if (code !== null && code !== 200) {
          finish(
            new HarmonyError(`${shortName(cmd)} refused (${refusal(message)})`, 'refused', code),
          );
          return;
        }
        finish(null, message);
      });
      try {
        this.send(cmd, params, id);
      } catch (err) {
        finish(err);
      }
    });
  }

  async getConfig() {
    const answer = await this.request(COMMANDS.config, undefined, {
      timeoutMs: this.timings.requestTimeoutMs * 3,
    });
    return answer.data ?? {};
  }

  /** @returns {Promise<string>} the id of the current activity, '-1' when off */
  async getCurrentActivity() {
    const answer = await this.request(COMMANDS.currentActivity);
    const result = answer.data?.result;
    if (result === undefined || result === null || String(result).trim() === '') {
      throw new HarmonyError('the current activity is missing from the answer', 'refused');
    }
    return String(result);
  }

  async getStateDigest() {
    return (await this.request(COMMANDS.stateDigest)).data ?? {};
  }

  async getDiscoveryInfo() {
    return (await this.request(COMMANDS.discoveryInfo)).data ?? {};
  }

  /**
   * Start an activity ('-1' turns everything off). Resolves once the hub says
   * it is done (the request's own progress messages, or the notifications),
   * or as soon as it accepted the request with `untilAccepted`.
   */
  startActivity(
    activityId,
    { timeoutMs = this.timings.activityTimeoutMs, untilAccepted = false } = {},
  ) {
    const target = String(activityId);
    return new Promise((resolve, reject) => {
      const id = randomUUID();
      let settled = false;
      const finish = (err) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        this.pending.delete(id);
        this.watchers.delete(watcher);
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      };
      const timer = setTimeout(
        () => finish(new HarmonyError('the hub did not finish the activity in time', 'timeout')),
        timeoutMs,
      );
      this.pending.set(id, (message) => {
        if (message.failure) {
          finish(message.failure);
          return;
        }
        const code = codeOf(message);
        if (code === null) {
          return;
        }
        if (code !== 100 && code !== 200) {
          finish(
            new HarmonyError(`the hub refused the activity (${refusal(message)})`, 'refused', code),
          );
          return;
        }
        const progress =
          message.cmd === ACTIVITY_PROGRESS.started || message.cmd === ACTIVITY_PROGRESS.discretes;
        if (untilAccepted || (progress && code === 200)) {
          finish(null);
        }
      });
      const watcher = (message) => {
        if (message.failure) {
          finish(message.failure);
        } else if (activityReached(message, target)) {
          finish(null);
        }
      };
      this.watchers.add(watcher);
      try {
        this.send(COMMANDS.runActivity, runActivityParams(target), id);
      } catch (err) {
        finish(err);
      }
    });
  }

  /**
   * Press then release one key of a device (`holdMs` between the two).
   * Resolves once the hub answered both, or after a short wait: the hub only
   * answers to refuse on some firmwares.
   */
  async sendCommand(deviceId, command, { holdMs = 0 } = {}) {
    const refusals = [];
    const ids = [randomUUID(), randomUUID()];
    let answered = 0;
    let wake = () => {};
    for (const id of ids) {
      this.pending.set(id, (message) => {
        this.pending.delete(id);
        answered += 1;
        if (message.failure) {
          refusals.push(message.failure);
        } else {
          const code = codeOf(message);
          if (code !== null && code !== 200) {
            refusals.push(
              new HarmonyError(`${command} refused (${refusal(message)})`, 'refused', code),
            );
          }
        }
        wake();
      });
    }
    try {
      this.send(COMMANDS.holdAction, holdActionParams(deviceId, command, 'press'), ids[0]);
      if (holdMs > 0) {
        await sleep(holdMs);
      }
      this.send(COMMANDS.holdAction, holdActionParams(deviceId, command, 'release'), ids[1]);
      if (answered < ids.length && refusals.length === 0) {
        await new Promise((resolve) => {
          const timer = setTimeout(resolve, this.timings.commandAnswerMs);
          wake = () => {
            if (answered >= ids.length || refusals.length > 0) {
              clearTimeout(timer);
              resolve();
            }
          };
        });
      }
    } finally {
      for (const id of ids) {
        this.pending.delete(id);
      }
    }
    if (refusals.length > 0) {
      throw refusals[0];
    }
  }
}

/** A notification telling that `target` is now the activity (or that all is off). */
export function activityReached(message, target) {
  const data = message?.data;
  if (!data || typeof data !== 'object') {
    return false;
  }
  if (message.type === NOTIFICATIONS.activityFinished) {
    return String(data.activityId) === target;
  }
  if (message.type === NOTIFICATIONS.stateDigest) {
    const status = Number(data.activityStatus);
    if (target === POWER_OFF_ID) {
      return status === ACTIVITY_STATUS.OFF;
    }
    return status === ACTIVITY_STATUS.STARTED && String(data.activityId) === target;
  }
  return false;
}

function shortName(cmd) {
  return String(cmd).slice(String(cmd).lastIndexOf('?') + 1);
}

function refusal(message) {
  const code = codeOf(message);
  const text = typeof message.msg === 'string' && message.msg.trim() !== '' ? message.msg : null;
  return [code, text].filter((part) => part !== null).join(' ');
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
