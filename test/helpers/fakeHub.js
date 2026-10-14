// -----------------------------------------------------------------------------
// Simulated Harmony Hubs, built from the fixtures: a `fetch` double for the
// provisioning request (HTTP POST on port 8088) and a WebSocket factory for
// `ws://<host>:8088/?domain=...&hubId=...`, speaking the JSON messages of the
// hub as aioharmony sends and reads them.
//
// Each hub keeps its current activity and answers like the real one: the
// requests by `id` (`code` 200, 100 while an activity starts), and the
// notifications pushed to every open socket (`connect.stateDigest?notify`,
// `harmony.engine?startActivityFinished`), whoever started the activity —
// Gladys, or the physical remote (`pressActivityButton`). Tests never touch
// the network: everything stays in memory.
// -----------------------------------------------------------------------------

import { readFileSync } from 'node:fs';

process.env.LOG_LEVEL ??= 'silent';

export const readFixture = (name) =>
  JSON.parse(readFileSync(new URL(`../fixtures/harmony/${name}`, import.meta.url), 'utf8'));

const ANSWERS = readFixture('answers.json');
const CONFIG = readFixture('hub-config.json');

export const ACTIVITY = {
  WATCH_TV: '30197730',
  APPLE_TV: '30197731',
  MUSIC: '30197732',
  XBOX: '30197733',
  OFF: '-1',
};
export const DEVICE = { TV: '38343689', AVR: '38343690', APPLE_TV: '38343691', PLUG: '38343692' };
export const ACCOUNT_EMAIL = ANSWERS.provisionInfo.data.email;
export const ACCOUNT_TOKEN = ANSWERS.provisionInfo.data.userAuthToken;

const tick = () => new Promise((resolve) => setImmediate(resolve));
const clone = (value) => structuredClone(value);

/**
 * One simulated hub.
 * @param {object} [options]
 * @param {string} [options.host]
 * @param {string} [options.remoteId] the hub id (`activeRemoteId`)
 * @param {string} [options.name] friendlyName
 * @param {string} [options.current] current activity id
 * @param {object} [options.config] raw configuration (default: the fixture)
 */
export function createHub({
  host = '192.0.2.40',
  remoteId = '12345678',
  name = 'Living Room',
  current = ACTIVITY.OFF,
  config = CONFIG,
} = {}) {
  const hub = {
    host,
    remoteId,
    name,
    current,
    config: clone(config),
    configVersion: 120,
    // Seconds the hub is "syncing with the cloud" after a config change.
    online: true,
    // Accepts the WebSocket but never answers (a hung hub).
    silent: false,
    sockets: new Set(),
    requests: [],
    commands: [],
    // cmd → { code, msg }: refuse the next requests of this command.
    refusals: new Map(),

    /** Every request received, by short command name (`config`, `getCurrentActivity`...). */
    received(shortName) {
      return hub.requests.filter((request) => request.hbus.cmd.endsWith(`?${shortName}`));
    },

    send(socket, message) {
      if (hub.sockets.has(socket)) {
        socket.emit('message', { data: JSON.stringify(message) });
      }
    },

    /** Push a notification to every open socket. */
    notify(type, data) {
      for (const socket of hub.sockets) {
        hub.send(socket, { type, data });
      }
    },

    digest(overrides = {}) {
      return {
        ...ANSWERS.stateDigest,
        activityId: hub.current,
        activityStatus: hub.current === ACTIVITY.OFF ? 0 : 2,
        configVersion: hub.configVersion,
        ...overrides,
      };
    },

    /**
     * Run an activity the way the hub reports it: "starting" digest, the
     * request's progress (when it came from a request), "finished", "started"
     * digest. Resolves once everything is sent.
     */
    async run(target, reply = () => {}) {
      if (target !== ACTIVITY.OFF) {
        hub.notify(
          'connect.stateDigest?notify',
          hub.digest({ activityId: target, activityStatus: 1 }),
        );
        await tick();
      }
      reply({
        cmd: 'harmony.engine?startActivity',
        code: 100,
        msg: 'Continue',
        data: { done: 1, total: 2 },
      });
      await tick();
      hub.current = target;
      reply({ cmd: 'harmony.engine?startActivity', code: 200, msg: 'OK' });
      await tick();
      hub.notify('harmony.engine?startActivityFinished', {
        activityId: target,
        errorCode: '200',
        errorString: 'OK',
      });
      await tick();
      hub.notify('connect.stateDigest?notify', hub.digest());
    },

    /** Someone pressed an activity button (or "Off") of the physical remote. */
    pressActivityButton(target) {
      return hub.run(target);
    },

    /** An activity is added in the Harmony app: the configuration version moves. */
    async addActivity(label, id) {
      hub.config.activity.splice(hub.config.activity.length - 2, 0, {
        label,
        id,
        activityOrder: hub.config.activity.length,
        type: 'VirtualGeneric',
        isAVActivity: true,
      });
      hub.configVersion += 1;
      hub.notify('connect.stateDigest?notify', hub.digest({ syncStatus: 1 }));
      await tick();
      hub.notify('connect.stateDigest?notify', hub.digest({ syncStatus: 0 }));
    },

    /** Unplug the hub: the open sockets close, nothing answers anymore. */
    unplug() {
      hub.online = false;
      for (const socket of [...hub.sockets]) {
        hub.sockets.delete(socket);
        socket.emit('close', { code: 1006 });
      }
    },

    plugIn() {
      hub.online = true;
    },

    async handle(socket, payload) {
      hub.requests.push(payload);
      if (hub.silent) {
        return;
      }
      const { cmd, id, params } = payload.hbus ?? {};
      const reply = (message) => hub.send(socket, { id, ...message });
      await tick();
      if (String(payload.hubId) !== hub.remoteId) {
        reply({ cmd, code: 401, msg: 'Unauthorized' });
        return;
      }
      const refusal = hub.refusals.get(cmd);
      if (refusal) {
        hub.refusals.delete(cmd);
        reply({ cmd, ...refusal });
        return;
      }
      switch (cmd) {
        case 'vnd.logitech.harmony/vnd.logitech.harmony.engine?config':
          reply({ cmd, code: 200, msg: 'OK', data: clone(hub.config) });
          return;
        case 'vnd.logitech.harmony/vnd.logitech.harmony.engine?getCurrentActivity':
          reply({ cmd, code: 200, msg: 'OK', data: { result: hub.current } });
          return;
        case 'vnd.logitech.connect/vnd.logitech.statedigest?get':
          reply({ cmd, code: 200, msg: 'OK', data: hub.digest() });
          return;
        case 'connect.discoveryinfo?get':
          reply({
            cmd,
            code: 200,
            msg: 'OK',
            data: { ...ANSWERS.discoveryInfo, friendlyName: hub.name, remoteId: hub.remoteId },
          });
          return;
        case 'harmony.activityengine?runactivity': {
          const target = String(params.activityId);
          const known =
            target === ACTIVITY.OFF || hub.config.activity.some((a) => String(a.id) === target);
          if (!known) {
            reply({ cmd, code: 404, msg: 'Activity not found' });
            return;
          }
          reply({ cmd, code: 200, msg: 'OK' });
          await tick();
          await hub.run(target, reply);
          return;
        }
        case 'vnd.logitech.harmony/vnd.logitech.harmony.engine?holdAction': {
          // The hub's own notation: `::` where JSON has `:`.
          const action = JSON.parse(String(params.action).replaceAll('::', ':'));
          hub.commands.push({
            deviceId: action.deviceId,
            command: action.command,
            type: action.type,
            status: params.status,
          });
          reply({ cmd, code: 200, msg: 'OK' });
          return;
        }
        default:
          reply({ cmd, code: 404, msg: 'Unknown command' });
      }
    },
  };
  return hub;
}

/** A WebSocket double with the standard client API the integration uses. */
class FakeSocket {
  constructor(network, url) {
    this.listeners = new Map();
    this.url = url;
    this.closed = false;
    const target = new URL(url);
    const hub = network.byHost(target.hostname);
    setImmediate(() => {
      const accepted =
        hub &&
        hub.online &&
        target.port === '8088' &&
        target.searchParams.get('hubId') === hub.remoteId &&
        target.searchParams.get('domain') !== null;
      if (!accepted || this.closed) {
        this.emit('error', { message: 'connect ECONNREFUSED' });
        this.emit('close', { code: 1006 });
        return;
      }
      this.hub = hub;
      hub.sockets.add(this);
      network.sockets.push(this);
      this.emit('open', {});
    });
  }

  addEventListener(type, listener) {
    if (!this.listeners.has(type)) {
      this.listeners.set(type, []);
    }
    this.listeners.get(type).push(listener);
  }

  emit(type, event) {
    for (const listener of this.listeners.get(type) ?? []) {
      listener(event);
    }
  }

  send(text) {
    if (this.closed || !this.hub?.sockets.has(this)) {
      throw new Error('WebSocket is not open');
    }
    this.hub.handle(this, JSON.parse(text));
  }

  close() {
    this.closed = true;
    this.hub?.sockets.delete(this);
  }
}

/**
 * A network of simulated hubs.
 * @param {Array} hubs from createHub
 */
export function createNetwork(hubs = [createHub()]) {
  const network = {
    hubs,
    sockets: [],
    httpRequests: [],

    byHost(host) {
      return network.hubs.find((hub) => hub.host === host) ?? null;
    },

    /** The provisioning request (HTTP POST on port 8088). */
    async fetch(url, init = {}) {
      const target = new URL(url);
      network.httpRequests.push({ url, init });
      const hub = network.byHost(target.hostname);
      await tick();
      if (!hub || !hub.online || target.port !== '8088') {
        throw new TypeError('fetch failed', { cause: { code: 'ECONNREFUSED' } });
      }
      const body = JSON.parse(init.body);
      if (init.method !== 'POST' || body.cmd !== 'setup.account?getProvisionInfo') {
        return new Response('Not found', { status: 404 });
      }
      const answer = structuredClone(ANSWERS.provisionInfo);
      answer.data.activeRemoteId = Number(hub.remoteId);
      answer.data.remoteId = hub.remoteId;
      return new Response(JSON.stringify(answer), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    },

    createSocket(url) {
      return new FakeSocket(network, url);
    },

    /** What the Gladys core relays for an SSDP search: every hub online answers. */
    ssdpResults() {
      return network.hubs
        .filter((hub) => hub.online)
        .map((hub) => ({
          source_ip: hub.host,
          source_port: 1900,
          headers: `HTTP/1.1 200 OK\r\nLOCATION: http://${hub.host}:8088/description.xml\r\nST: urn:myharmony-com:device:harmony:1\r\nUSN: uuid:hub-${hub.remoteId}::urn:myharmony-com:device:harmony:1\r\n\r\n`,
        }));
    },
  };
  network.fetch = network.fetch.bind(network);
  network.createSocket = network.createSocket.bind(network);
  return network;
}

/** Let every pending message, notification and background task run. */
export async function settle(manager, rounds = 40) {
  for (let round = 0; round < rounds; round += 1) {
    await tick();
    await manager.idle();
  }
}

/**
 * Serve one simulated hub over real HTTP and WebSocket (port 8088 by
 * default), for a manual check of the real client: `node
 * scripts/fake-hub.mjs`, then `node scripts/probe.mjs 127.0.0.1`. Never
 * used by the tests, which do not touch the network. A minimal RFC 6455
 * server: unfragmented text frames, close and ping.
 * @returns {Promise<import('node:http').Server>}
 */
export async function serve(hub, { port = 8088, address = '127.0.0.1' } = {}) {
  const { createServer } = await import('node:http');
  const { createHash } = await import('node:crypto');
  const network = createNetwork([hub]);
  hub.host = address;
  const server = createServer(async (request, response) => {
    let body = '';
    for await (const chunk of request) {
      body += chunk;
    }
    const answer = await network.fetch(`http://${address}:8088${request.url}`, {
      method: request.method,
      headers: request.headers,
      body: body || '{}',
    });
    response.writeHead(answer.status, { 'Content-Type': 'application/json' });
    response.end(await answer.text());
  });
  server.on('upgrade', (request, socket) => {
    const url = new URL(request.url, `http://${address}`);
    if (url.searchParams.get('hubId') !== hub.remoteId) {
      socket.end('HTTP/1.1 403 Forbidden\r\n\r\n');
      return;
    }
    const accept = createHash('sha1')
      .update(`${request.headers['sec-websocket-key']}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
      .digest('base64');
    socket.write(
      `HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`,
    );
    const frame = (opcode, payload) => {
      const length = payload.length;
      const header =
        length < 126
          ? Buffer.from([0x80 | opcode, length])
          : length < 65536
            ? Buffer.from([0x80 | opcode, 126, length >> 8, length & 0xff])
            : Buffer.concat([Buffer.from([0x80 | opcode, 127]), bigLength(length)]);
      socket.write(Buffer.concat([header, payload]));
    };
    const peer = {
      emit(type, event) {
        if (type === 'message') {
          frame(0x1, Buffer.from(event.data));
        } else if (type === 'close') {
          frame(0x8, Buffer.alloc(0));
          socket.end();
        }
      },
    };
    hub.sockets.add(peer);
    let buffer = Buffer.alloc(0);
    socket.on('data', (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      for (;;) {
        if (buffer.length < 2) {
          return;
        }
        const opcode = buffer[0] & 0x0f;
        let length = buffer[1] & 0x7f;
        let offset = 2;
        if (length === 126) {
          length = buffer.readUInt16BE(2);
          offset = 4;
        } else if (length === 127) {
          length = Number(buffer.readBigUInt64BE(2));
          offset = 10;
        }
        const masked = (buffer[1] & 0x80) !== 0;
        const mask = masked ? buffer.subarray(offset, offset + 4) : null;
        offset += masked ? 4 : 0;
        if (buffer.length < offset + length) {
          return;
        }
        const payload = Buffer.from(buffer.subarray(offset, offset + length));
        if (mask) {
          for (let i = 0; i < payload.length; i += 1) {
            payload[i] ^= mask[i % 4];
          }
        }
        buffer = buffer.subarray(offset + length);
        if (opcode === 0x1) {
          hub.handle(peer, JSON.parse(payload.toString('utf8')));
        } else if (opcode === 0x8) {
          hub.sockets.delete(peer);
          frame(0x8, Buffer.alloc(0));
          socket.end();
        } else if (opcode === 0x9) {
          frame(0xa, payload);
        }
      }
    });
    socket.on('close', () => hub.sockets.delete(peer));
    socket.on('error', () => hub.sockets.delete(peer));
  });
  await new Promise((resolve) => server.listen(port, address, resolve));
  return server;
}

function bigLength(length) {
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64BE(BigInt(length));
  return buffer;
}
