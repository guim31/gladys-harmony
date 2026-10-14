// -----------------------------------------------------------------------------
// The local protocol of the Logitech Harmony Hub, as aioharmony speaks it
// (Apache-2.0, the library of the Home Assistant integration): an HTTP POST on
// port 8088 to learn the hub id, then a WebSocket on the same port carrying
// JSON requests and notifications. The old XMPP API (port 5222) is disabled
// by default on recent firmwares: it is not used.
//
// Every string below is a wire value: the quirks are the hub's, kept as is
// (the space in `"id "` of the provisioning request, the `::` separators of
// the holdAction payload).
// -----------------------------------------------------------------------------

export const HUB_PORT = 8088;

// The origin the official web app used: aioharmony sends it with the HTTP
// request, the hub has been seen to refuse requests without it.
export const ORIGIN = 'http://sl.dhg.myharmony.com';

// Domain passed in the WebSocket URL when the hub does not say its own.
export const DEFAULT_DOMAIN = 'svcs.myharmony.com';

// The id of the "PowerOff" activity: starting it turns everything off.
export const POWER_OFF_ID = '-1';

const ENGINE = 'vnd.logitech.harmony/vnd.logitech.harmony.engine';

export const COMMANDS = {
  provisionInfo: 'setup.account?getProvisionInfo',
  config: `${ENGINE}?config`,
  currentActivity: `${ENGINE}?getCurrentActivity`,
  stateDigest: 'vnd.logitech.connect/vnd.logitech.statedigest?get',
  discoveryInfo: 'connect.discoveryinfo?get',
  runActivity: 'harmony.activityengine?runactivity',
  holdAction: `${ENGINE}?holdAction`,
};

// What the hub pushes without being asked.
export const NOTIFICATIONS = {
  stateDigest: 'connect.stateDigest?notify',
  activityFinished: 'harmony.engine?startActivityFinished',
};

// Messages tagged with the id of a `runactivity` request while the hub works.
export const ACTIVITY_PROGRESS = {
  started: 'harmony.engine?startActivity',
  discretes: 'harmony.engine?helpdiscretes',
};

// `activityStatus` of a state digest.
export const ACTIVITY_STATUS = {
  OFF: 0,
  STARTING: 1,
  STARTED: 2,
  TURNING_OFF: 3,
};

// Hub-side timeout, in seconds, sent with every request (aioharmony's value).
const HUB_TIMEOUT_SECONDS = 5;

/** HTTP request that returns the hub id (`activeRemoteId`) and its discovery server. */
export function provisionRequest() {
  return {
    url: (host) => `http://${host}:${HUB_PORT}/`,
    headers: {
      Origin: ORIGIN,
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'Accept-Charset': 'utf-8',
    },
    body: JSON.stringify({ 'id ': 1, cmd: COMMANDS.provisionInfo, params: {} }),
  };
}

export function websocketUrl(host, { domain, remoteId }) {
  const query = new URLSearchParams({ domain: domain || DEFAULT_DOMAIN, hubId: String(remoteId) });
  return `ws://${host}:${HUB_PORT}/?${query}`;
}

/** One request over the WebSocket. */
export function buildRequest(remoteId, cmd, params, id) {
  return {
    hubId: remoteId,
    timeout: HUB_TIMEOUT_SECONDS,
    hbus: { cmd, id, params: params ?? { verb: 'get', format: 'json' } },
  };
}

export function runActivityParams(activityId) {
  return { async: 'true', timestamp: 0, activityId: String(activityId) };
}

/**
 * Parameters of one key press or release. The `action` is not JSON: the hub
 * expects `::` where JSON has `:`, the exact string aioharmony sends.
 * @param {'press'|'release'} status
 */
export function holdActionParams(deviceId, command, status) {
  const action = `{"command":: ${JSON.stringify(String(command))},"type":: "IRCommand","deviceId":: ${JSON.stringify(String(deviceId))}}`;
  return { status, timestamp: '0', verb: 'render', action };
}

/** `code` arrives as a number or a string, depending on the message. */
export function codeOf(message) {
  const code = Number(message?.code);
  return Number.isFinite(code) ? code : null;
}
