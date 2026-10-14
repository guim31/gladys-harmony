import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HarmonyClient, HarmonyError, fetchProvisionInfo } from '../src/harmony/client.js';
import { holdActionParams, websocketUrl } from '../src/harmony/protocol.js';
import { ACTIVITY, DEVICE, createHub, createNetwork } from './helpers/fakeHub.js';

async function waitFor(check, what) {
  for (let round = 0; round < 500; round += 1) {
    if (check()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
  assert.fail(`timed out waiting for ${what}`);
}

/** A client connected to one simulated hub. */
async function connected(hub = createHub(), timings = {}) {
  const network = createNetwork([hub]);
  const client = new HarmonyClient({
    host: hub.host,
    remoteId: hub.remoteId,
    createSocket: network.createSocket,
    timings: { reconnectMinMs: 5, reconnectMaxMs: 10, ...timings },
  });
  client.start();
  await waitFor(() => client.connected, 'the WebSocket');
  return { client, hub, network };
}

test('the provisioning request: the POST of aioharmony, only the hub id and domain kept', async () => {
  const hub = createHub();
  const network = createNetwork([hub]);
  const info = await fetchProvisionInfo(hub.host, { fetch: network.fetch });
  // The account e-mail of the answer never leaves the function.
  assert.deepEqual(info, { remoteId: '12345678', domain: 'svcs.myharmony.com' });
  const [request] = network.httpRequests;
  assert.equal(request.url, 'http://192.0.2.40:8088/');
  assert.equal(request.init.method, 'POST');
  assert.equal(request.init.headers.Origin, 'http://sl.dhg.myharmony.com');
  assert.deepEqual(JSON.parse(request.init.body), {
    'id ': 1,
    cmd: 'setup.account?getProvisionInfo',
    params: {},
  });
});

test('an address that is not a hub, or that does not answer, is told apart', async () => {
  const network = createNetwork([createHub()]);
  await assert.rejects(fetchProvisionInfo('192.0.2.99', { fetch: network.fetch }), {
    kind: 'unreachable',
  });
  const notJson = async () => new Response('<html>router</html>', { status: 200 });
  await assert.rejects(fetchProvisionInfo('192.0.2.1', { fetch: notJson }), {
    kind: 'not-harmony',
  });
  const noId = async () => Response.json({ code: 200, data: {} });
  await assert.rejects(fetchProvisionInfo('192.0.2.1', { fetch: noId }), { kind: 'not-harmony' });
  const missing = async () => new Response('', { status: 404 });
  await assert.rejects(fetchProvisionInfo('192.0.2.1', { fetch: missing }), {
    kind: 'not-harmony',
  });
  const hung = (url, { signal }) =>
    new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason)));
  await assert.rejects(fetchProvisionInfo('192.0.2.1', { fetch: hung, timeoutMs: 10 }), {
    kind: 'unreachable',
    message: /no answer within/,
  });
});

test('the WebSocket URL carries the domain and the hub id, like aioharmony', () => {
  assert.equal(
    websocketUrl('192.0.2.40', { domain: 'svcs.myharmony.com', remoteId: '12345678' }),
    'ws://192.0.2.40:8088/?domain=svcs.myharmony.com&hubId=12345678',
  );
});

test('requests are answered by id: configuration, current activity, digest, discovery info', async () => {
  const { client, hub } = await connected(createHub({ current: ACTIVITY.WATCH_TV }));
  const [config, current, digest, info] = await Promise.all([
    client.getConfig(),
    client.getCurrentActivity(),
    client.getStateDigest(),
    client.getDiscoveryInfo(),
  ]);
  assert.equal(config.activity.length, 6);
  assert.equal(current, ACTIVITY.WATCH_TV);
  assert.equal(digest.configVersion, 120);
  assert.equal(info.friendlyName, 'Living Room');
  const [request] = hub.received('config');
  assert.equal(request.hubId, '12345678');
  assert.deepEqual(request.hbus.params, { verb: 'get', format: 'json' });
  client.stop();
});

test('a key press is a press then a release, in the hub notation with `::`', async () => {
  assert.equal(
    holdActionParams('38343690', 'VolumeUp', 'press').action,
    '{"command":: "VolumeUp","type":: "IRCommand","deviceId":: "38343690"}',
  );
  const { client, hub } = await connected();
  await client.sendCommand(DEVICE.AVR, 'VolumeUp');
  assert.deepEqual(hub.commands, [
    { deviceId: DEVICE.AVR, command: 'VolumeUp', type: 'IRCommand', status: 'press' },
    { deviceId: DEVICE.AVR, command: 'VolumeUp', type: 'IRCommand', status: 'release' },
  ]);
  const [press] = hub.received('holdAction');
  assert.deepEqual(Object.keys(press.hbus.params), ['status', 'timestamp', 'verb', 'action']);
  assert.equal(press.hbus.params.verb, 'render');
  client.stop();
});

test('a refused key press rejects with the hub code', async () => {
  const { client, hub } = await connected();
  hub.refusals.set('vnd.logitech.harmony/vnd.logitech.harmony.engine?holdAction', {
    code: 401,
    msg: 'Device not found',
  });
  await assert.rejects(client.sendCommand('1', 'VolumeUp'), {
    kind: 'refused',
    code: 401,
    message: /Device not found/,
  });
  client.stop();
});

test('starting an activity resolves once the hub is done, and the notifications follow', async () => {
  const { client, hub } = await connected();
  const notifications = [];
  client.on('notification', (message) => notifications.push(message));
  await client.startActivity(ACTIVITY.MUSIC);
  assert.equal(hub.current, ACTIVITY.MUSIC);
  const [request] = hub.received('runactivity');
  assert.deepEqual(request.hbus.params, {
    async: 'true',
    timestamp: 0,
    activityId: ACTIVITY.MUSIC,
  });
  await waitFor(() => notifications.length === 3, 'the notifications');
  assert.deepEqual(
    notifications.map((message) => [message.type, message.data.activityStatus ?? null]),
    [
      ['connect.stateDigest?notify', 1],
      ['harmony.engine?startActivityFinished', null],
      ['connect.stateDigest?notify', 2],
    ],
  );
  client.stop();
});

test('an activity start can resolve as soon as the hub accepted it', async () => {
  const { client, hub } = await connected();
  await client.startActivity(ACTIVITY.XBOX, { untilAccepted: true });
  // Accepted, not done yet.
  assert.equal(hub.current, ACTIVITY.OFF);
  await waitFor(() => hub.current === ACTIVITY.XBOX, 'the end of the start');
  client.stop();
});

test('an activity the hub refuses, or never finishes, rejects', async () => {
  const { client, hub } = await connected(createHub(), { activityTimeoutMs: 30 });
  await assert.rejects(client.startActivity('424242'), { kind: 'refused', code: 404 });
  hub.silent = true;
  await assert.rejects(client.startActivity(ACTIVITY.MUSIC), { kind: 'timeout' });
  client.stop();
});

test('a lost link reconnects by itself, and the pending requests fail at once', async () => {
  const { client, hub } = await connected();
  const events = [];
  client.on('close', () => events.push('close'));
  client.on('open', () => events.push('open'));
  hub.silent = true;
  const pending = client.getCurrentActivity();
  hub.unplug();
  await assert.rejects(
    pending,
    (err) => err instanceof HarmonyError && err.kind === 'disconnected',
  );
  await assert.rejects(client.getCurrentActivity(), { kind: 'disconnected' });
  hub.silent = false;
  hub.plugIn();
  await waitFor(() => client.connected, 'the reconnection');
  assert.deepEqual(events, ['close', 'open']);
  assert.equal(await client.getCurrentActivity(), ACTIVITY.OFF);
  client.stop();
});

test('a link that stopped answering is dropped and opened again', async () => {
  const { client, hub, network } = await connected(createHub(), { requestTimeoutMs: 20 });
  hub.silent = true;
  await assert.rejects(client.getCurrentActivity(), { kind: 'timeout' });
  hub.silent = false;
  await waitFor(() => network.sockets.length === 2 && client.connected, 'a new socket');
  assert.equal(await client.getCurrentActivity(), ACTIVITY.OFF);
  client.stop();
});

test('a hub that cannot be reached reports each failed attempt', async () => {
  const hub = createHub();
  hub.online = false;
  const network = createNetwork([hub]);
  const client = new HarmonyClient({
    host: hub.host,
    remoteId: hub.remoteId,
    createSocket: network.createSocket,
    timings: { reconnectMinMs: 5, reconnectMaxMs: 5 },
  });
  const failures = [];
  client.on('failure', (err) => failures.push(err.kind));
  client.start();
  await waitFor(() => failures.length >= 2, 'two attempts');
  assert.ok(failures.every((kind) => kind === 'unreachable'));
  client.stop();
});

test('a connection attempt that hangs is given up after the timeout', async () => {
  const sockets = [];
  const client = new HarmonyClient({
    host: '192.0.2.40',
    remoteId: '1',
    // A socket that never opens nor fails.
    createSocket: () => {
      const socket = { addEventListener() {}, close: () => (socket.closed = true) };
      sockets.push(socket);
      return socket;
    },
    timings: { connectTimeoutMs: 10, reconnectMinMs: 5, reconnectMaxMs: 5 },
  });
  const failures = [];
  client.on('failure', (err) => failures.push(err.message));
  client.start();
  await waitFor(() => failures.length >= 1, 'the timeout');
  assert.equal(sockets[0].closed, true);
  assert.match(failures[0], /no answer within/);
  client.stop();
});
