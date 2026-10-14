// -----------------------------------------------------------------------------
// Integration configuration: defaults (they mirror the `default` values of the
// manifest `config_schema`, test/manifest.test.js checks it) and normalization
// of what Gladys sends, so the rest of the code never deals with `undefined`
// or with a half-typed address.
// -----------------------------------------------------------------------------

import { isIPv4 } from 'node:net';

export const LANGUAGES = ['en', 'fr', 'de', 'es'];

export const DEFAULT_CONFIG = {
  // Addresses of the hubs, typed by the user, separated by commas. Optional:
  // the SSDP search through Gladys finds the hubs of the local network.
  hosts: '',
  // Language of the feature names, of the "Off" activity and of the texts the
  // container produces (scene action errors, the Configuration screen report).
  language: 'fr',
};

// A DNS name: labels of letters, digits and hyphens. No scheme, no port, no
// path: the hub always listens on port 8088.
const HOSTNAME =
  /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$/i;

/**
 * One typed address, cleaned of what users commonly paste with it
 * (`http://`, a trailing slash, the `:8088` port).
 * @returns {string|null} the host, or null when it is not an address
 */
export function cleanHost(raw) {
  let host = String(raw ?? '').trim();
  host = host.replace(/^[a-z]+:\/\//i, '').replace(/\/.*$/, '');
  host = host.replace(/:8088$/, '');
  if (host === '') {
    return null;
  }
  if (isIPv4(host)) {
    return host;
  }
  // A dotted quad that is not a valid IPv4 address is a typo, not a name.
  if (/^[\d.]+$/.test(host)) {
    return null;
  }
  return HOSTNAME.test(host) ? host.toLowerCase() : null;
}

/**
 * Merge the user config with the defaults.
 * @param {Record<string, unknown>} raw config returned by the SDK
 * @returns {{ hosts: string[], invalidHosts: string[], language: string }}
 */
export function normalizeConfig(raw = {}) {
  const hosts = [];
  const invalidHosts = [];
  for (const part of String(raw.hosts ?? DEFAULT_CONFIG.hosts).split(/[,;\s]+/)) {
    if (part.trim() === '') {
      continue;
    }
    const host = cleanHost(part);
    if (host === null) {
      invalidHosts.push(part.trim());
    } else if (!hosts.includes(host)) {
      hosts.push(host);
    }
  }
  const language = LANGUAGES.includes(raw.language) ? raw.language : DEFAULT_CONFIG.language;
  return { hosts, invalidHosts, language };
}
