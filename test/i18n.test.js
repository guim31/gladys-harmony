// -----------------------------------------------------------------------------
// Every text Gladys shows exists in the four languages of its interface
// (English, French, German, Spanish): the manifest, the texts of the code and
// the documentation, whose four versions have the same sections. German says
// "du", never the polite "Sie"; Spanish says "usted".
// -----------------------------------------------------------------------------

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { LANGUAGES } from '../src/config.js';
import { NAMES } from '../src/devices.js';
import { CONNECTION_TEXT, ERRORS, SEARCH_TEXT, searchMessage } from '../src/messages.js';
import { COMMON_COMMANDS } from '../src/scenes.js';
import { TEXT } from '../src/widgets.js';

const manifest = JSON.parse(
  await readFile(new URL('../gladys-assistant-integration.json', import.meta.url), 'utf8'),
);
const docs = Object.fromEntries(
  await Promise.all(
    ['en', 'fr', 'de', 'es'].map(async (lang) => [
      lang,
      await readFile(new URL(`../docs/${lang}.md`, import.meta.url), 'utf8'),
    ]),
  ),
);

const LANGS = ['en', 'fr', 'de', 'es'];
const POLITE_GERMAN = /(?<!\p{L})(Sie|Ihr|Ihre|Ihren|Ihrem|Ihrer|Ihres|Ihnen)(?!\p{L})/u;

// Upper bounds, in characters: what the Gladys interface shows without cutting.
const MAX = {
  catalog: 100,
  widgetLabel: 30,
  label: 60,
  placeholder: 60,
  description: 400,
  message: 200,
  short: 40,
  featureName: 40,
};

const sorted = (keys) => [...keys].sort();

/** Checks one multi-language object; returns its problems. */
function problems(value, path, max) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return [`${path} must be a multi-language object`];
  }
  const found = [];
  if (JSON.stringify(sorted(Object.keys(value))) !== JSON.stringify(sorted(LANGS))) {
    found.push(`${path} has [${Object.keys(value)}], expected exactly [${LANGS}]`);
  }
  for (const [lang, text] of Object.entries(value)) {
    found.push(...textProblems(text, `${path}.${lang}`, lang, max));
  }
  return found;
}

function textProblems(text, path, lang, max) {
  if (typeof text !== 'string' || text.trim() === '') {
    return [`${path} is empty`];
  }
  const found = [];
  if (text.length > max) {
    found.push(`${path} has ${text.length} characters (${max} at most)`);
  }
  if (lang === 'de' && POLITE_GERMAN.test(text)) {
    found.push(`${path} uses the polite form: "${text}"`);
  }
  return found;
}

/** Every multi-language object of the manifest, with its length limit. */
function manifestTexts(root) {
  const texts = [];
  const walk = (value, path, key) => {
    if (Array.isArray(value)) {
      value.forEach((item, index) => walk(item, `${path}[${index}]`, key));
      return;
    }
    if (!value || typeof value !== 'object') {
      return;
    }
    const isText =
      ['label', 'description', 'placeholder'].includes(key) ||
      Object.keys(value).some((child) => LANGS.includes(child));
    if (isText) {
      // The store schema caps the catalog and widget descriptions, and widget labels.
      const max =
        path === 'manifest.description' || /^manifest\.widgets\[\d+\]\.description$/.test(path)
          ? MAX.catalog
          : /^manifest\.widgets\[\d+\]\.label$/.test(path)
            ? MAX.widgetLabel
            : /^manifest\.config_schema\[\d+\]\.description$/.test(path)
              ? 1000
              : (MAX[key] ?? MAX.label);
      texts.push({ path, value, max });
      return;
    }
    for (const [child, item] of Object.entries(value)) {
      walk(item, `${path}.${child}`, child);
    }
  };
  walk(root, 'manifest', null);
  return texts;
}

test('the configuration offers the four languages', () => {
  assert.deepEqual(LANGUAGES, LANGS);
  assert.deepEqual(
    manifest.config_schema.find((field) => field.key === 'language').options.map((o) => o.value),
    LANGS,
  );
  assert.deepEqual(Object.keys(NAMES), LANGS);
});

test('every text of the manifest is in English, French, German and Spanish', () => {
  const texts = manifestTexts(manifest);
  assert.ok(texts.length >= 80, `only ${texts.length} texts found in the manifest`);
  const found = texts.flatMap(({ path, value, max }) => problems(value, path, max));
  assert.deepEqual(found, []);
});

test('the catalog name is the same everywhere, the description 10 to 100 characters', () => {
  assert.equal(manifest.name, 'Logitech Harmony Hub');
  for (const lang of LANGS) {
    const length = manifest.description[lang].length;
    assert.ok(length >= 10 && length <= 100, `description.${lang}: ${length} characters`);
  }
});

test('every message table of the code has the four languages', () => {
  const found = [
    ...Object.entries(CONNECTION_TEXT).flatMap(([key, value]) =>
      problems(value, `CONNECTION_TEXT.${key}`, MAX.message),
    ),
    ...Object.entries(TEXT).flatMap(([key, value]) =>
      problems(
        value,
        `TEXT.${key}`,
        key === 'noHub' || key === 'unreachable' ? MAX.message : MAX.short,
      ),
    ),
    ...COMMON_COMMANDS.flatMap(({ value, ...labels }) =>
      problems(labels, `COMMON_COMMANDS.${value}`, MAX.short),
    ),
  ];
  assert.deepEqual(found, []);
});

// Tables written one language at a time: same keys everywhere, no empty text.
function tableProblems(table, name, max, render = (value) => value) {
  const found = [];
  if (JSON.stringify(sorted(Object.keys(table))) !== JSON.stringify(sorted(LANGS))) {
    found.push(`${name} has [${Object.keys(table)}], expected exactly [${LANGS}]`);
  }
  for (const lang of LANGS) {
    const entries = table[lang] ?? {};
    if (
      JSON.stringify(sorted(Object.keys(entries))) !== JSON.stringify(sorted(Object.keys(table.en)))
    ) {
      found.push(`${name}.${lang} does not have the keys of ${name}.en`);
    }
    for (const [key, value] of Object.entries(entries)) {
      found.push(...textProblems(render(value), `${name}.${lang}.${key}`, lang, max));
    }
  }
  return found;
}

const renderAll = (value) =>
  typeof value === 'function' ? value('Samsung TV', 'VolumeUp', 3) : value;

test('the feature names, errors and search report exist in every language', () => {
  assert.deepEqual(tableProblems(NAMES, 'NAMES', MAX.featureName), []);
  assert.deepEqual(tableProblems(ERRORS, 'ERRORS', MAX.message, renderAll), []);
  assert.deepEqual(tableProblems(SEARCH_TEXT, 'SEARCH_TEXT', MAX.message, renderAll), []);
  const report = searchMessage({
    hubs: [
      {
        name: 'Harmony Living Room',
        host: '192.0.2.40',
        reachable: true,
        activities: 4,
        devices: 3,
      },
      { name: 'Harmony Bedroom', host: '192.0.2.50', reachable: false, activities: 2, devices: 1 },
    ],
    ssdp: 'unavailable',
    notHubs: ['192.0.2.77'],
    invalidHosts: ['300.1.1.1'],
  });
  assert.deepEqual(problems(report, 'searchMessage', 600), []);
  assert.match(report.de, /^2 Hub\(s\), davon 1 erreichbar: .*Gib die IP-Adresse/);
  assert.match(report.es, /introduzca la dirección IP/);
});

test('the four documentations have the same sections', () => {
  const outline = (text) =>
    text
      .split('\n')
      .filter((line) => /^#{1,3} /.test(line))
      .map((line) => line.match(/^#+/)[0].length);
  const reference = outline(docs.en);
  assert.ok(reference.filter((level) => level === 2).length >= 9, 'too few sections');
  for (const lang of ['fr', 'de', 'es']) {
    assert.deepEqual(outline(docs[lang]), reference, `docs/${lang}.md has another outline`);
  }
});

test('the documentations say what they cover, in their language', () => {
  const expected = {
    en: [
      '## What you need',
      '## Configuration',
      '## Troubleshooting',
      '## Limits',
      'Developed without the hardware',
      'not affiliated with Logitech',
    ],
    fr: [
      '## Prérequis',
      '## Configuration',
      '## Dépannage',
      '## Limites',
      'Développée sans le matériel',
      'aucun lien avec Logitech',
    ],
    de: [
      '## Voraussetzungen',
      '## Konfiguration',
      '## Fehlerbehebung',
      '## Grenzen',
      'Ohne die Hardware entwickelt',
      'nicht mit Logitech verbunden',
    ],
    es: [
      '## Requisitos',
      '## Configuración',
      '## Solución de problemas',
      '## Límites',
      'Desarrollada sin el hardware',
      'ninguna relación con Logitech',
    ],
  };
  for (const [lang, fragments] of Object.entries(expected)) {
    for (const fragment of fragments) {
      assert.ok(docs[lang].includes(fragment), `docs/${lang}.md misses "${fragment}"`);
    }
  }
  assert.doesNotMatch(docs.de, POLITE_GERMAN, 'docs/de.md uses the polite form');
});

test('the guard catches a missing language, an empty text and the polite German form', () => {
  assert.equal(problems({ en: 'Hub', fr: 'Hub', de: 'Hub' }, 'x', 60).length, 1);
  assert.equal(problems({ en: 'Hub', fr: 'Hub', de: '', es: 'Hub' }, 'x', 60).length, 1);
  assert.equal(problems({ en: 'a', fr: 'a', de: 'a', es: 'a', it: 'a' }, 'x', 60).length, 1);
  assert.equal(problems({ en: 'a', fr: 'a', de: 'a'.repeat(61), es: 'a' }, 'x', 60).length, 1);
  for (const polite of ['Wählen Sie', 'Ihr Hub', 'Ihre IP', 'mit Ihrem', 'Ihren', 'Ihnen']) {
    assert.equal(problems({ en: 'a', fr: 'a', de: polite, es: 'a' }, 'x', 60).length, 1, polite);
  }
  assert.deepEqual(
    problems({ en: 'a', fr: 'a', de: 'Siebenschläfer, ihre', es: 'a' }, 'x', 60),
    [],
  );
  // A manifest text forgotten in German is found.
  const forgotten = structuredClone(manifest);
  delete forgotten.scene_actions[2].fields[2].placeholder.de;
  const found = manifestTexts(forgotten).flatMap(({ path, value, max }) =>
    problems(value, path, max),
  );
  assert.deepEqual(found, [
    'manifest.scene_actions[2].fields[2].placeholder has [en,fr,es], expected exactly [en,fr,de,es]',
  ]);
});
