// -----------------------------------------------------------------------------
// Finding the hubs of the local network. The integration container sits on a
// bridge network and never sees SSDP: the core sends the M-SEARCH and relays
// the raw answers (mediated discovery, manifest `network_discovery`). The hub
// announces itself as `urn:myharmony-com:device:harmony:1` (the type Home
// Assistant matches); every answering address is then asked whether it is a
// hub over HTTP (unicast crosses the bridge), which also gives its hub id.
// -----------------------------------------------------------------------------

import { isIPv4 } from 'node:net';

export const SSDP_SEARCH_TARGET = 'urn:myharmony-com:device:harmony:1';
export const SCAN_TIMEOUT_SECONDS = 5;
// A home network has a handful of hubs at most: more answers are noise.
export const MAX_CANDIDATES = 16;

/** Headers of one raw SSDP answer, keys lower-cased. */
export function parseSsdpHeaders(text) {
  const headers = {};
  for (const line of String(text ?? '').split(/\r?\n/)) {
    const at = line.indexOf(':');
    if (at > 0) {
      const key = line.slice(0, at).trim().toLowerCase();
      if (!(key in headers)) {
        headers[key] = line.slice(at + 1).trim();
      }
    }
  }
  return headers;
}

/**
 * The addresses that answered as a Harmony Hub, from `scanNetwork('ssdp')`.
 * The search target is the hub's own type, but a device may answer any
 * search: only the answers naming the hub are kept.
 * @param {Array<{ source_ip: string, headers: string }>} results
 * @returns {string[]}
 */
export function hubAddresses(results) {
  const addresses = [];
  for (const result of Array.isArray(results) ? results : []) {
    const address = result?.source_ip;
    if (typeof address !== 'string' || !isIPv4(address) || addresses.includes(address)) {
      continue;
    }
    const headers = parseSsdpHeaders(result.headers);
    const names = [headers.st, headers.nt, headers.usn].filter(Boolean).join(' ');
    if (!/myharmony-com:device:harmony/i.test(names)) {
      continue;
    }
    addresses.push(address);
    if (addresses.length >= MAX_CANDIDATES) {
      break;
    }
  }
  return addresses;
}

/**
 * Run `fn` on every item, at most `limit` at a time.
 * @returns {Promise<Array<{ value?: any, error?: Error }>>} in the order of `items`
 */
export async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      try {
        results[index] = { value: await fn(items[index]) };
      } catch (error) {
        results[index] = { error };
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}
