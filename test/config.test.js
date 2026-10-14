import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CONFIG, cleanHost, normalizeConfig } from '../src/config.js';

test('an empty configuration gets the defaults: no address, French names', () => {
  assert.deepEqual(normalizeConfig(), { hosts: [], invalidHosts: [], language: 'fr' });
  assert.deepEqual(normalizeConfig({ hosts: DEFAULT_CONFIG.hosts }).hosts, []);
});

test('typed addresses are cleaned, deduplicated, and the typos set aside', () => {
  const config = normalizeConfig({
    hosts:
      ' 192.0.2.40, http://192.0.2.41:8088/ ;harmony.home.arpa 192.0.2.40, 300.1.1.1, bad_host!',
  });
  assert.deepEqual(config.hosts, ['192.0.2.40', '192.0.2.41', 'harmony.home.arpa']);
  assert.deepEqual(config.invalidHosts, ['300.1.1.1', 'bad_host!']);
});

test('cleanHost keeps IPv4 addresses and DNS names only', () => {
  assert.equal(cleanHost('192.0.2.7'), '192.0.2.7');
  assert.equal(cleanHost('Hub.Local'), 'hub.local');
  assert.equal(cleanHost('192.0.2'), null);
  assert.equal(cleanHost(''), null);
  assert.equal(cleanHost('192.0.2.7:9000'), null);
});

test('an unknown language falls back to French', () => {
  assert.equal(normalizeConfig({ language: 'it' }).language, 'fr');
  assert.equal(normalizeConfig({ language: 'de' }).language, 'de');
});
