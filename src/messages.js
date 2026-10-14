// -----------------------------------------------------------------------------
// Texts the container produces, in the four languages of the Gladys interface
// (German says "du", Spanish says "usted"). Gladys sends no language to the
// device, scene and configuration handlers: they use the `language` of the
// configuration. test/i18n.test.js checks every table.
// -----------------------------------------------------------------------------

// Shown by Gladys under the integration name when it is not connected.
export const CONNECTION_TEXT = {
  noHub: {
    en: 'No Harmony Hub found. Enter its IP address in the configuration, or run a search.',
    fr: 'Aucun Harmony Hub trouvé. Saisissez son adresse IP dans la configuration, ou lancez une recherche.',
    de: 'Kein Harmony Hub gefunden. Gib seine IP-Adresse in der Konfiguration ein oder starte eine Suche.',
    es: 'No se ha encontrado ningún Harmony Hub. Introduzca su dirección IP en la configuración o inicie una búsqueda.',
  },
  noAnswer: {
    en: 'No Harmony Hub answers.',
    fr: 'Aucun Harmony Hub ne répond.',
    de: 'Kein Harmony Hub antwortet.',
    es: 'Ningún Harmony Hub responde.',
  },
  initFailed: {
    en: 'Initialization failed, check the integration logs.',
    fr: "L'initialisation a échoué, consultez les journaux de l'intégration.",
    de: 'Initialisierung fehlgeschlagen, sieh dir die Protokolle der Integration an.',
    es: 'La inicialización ha fallado, consulte los registros de la integración.',
  },
};

// Errors of the commands, scene actions and widget buttons.
export const ERRORS = {
  en: {
    unknownDevice: 'Unknown Harmony device: run a search in the integration settings.',
    notActivity: (name) => `${name} is not a Harmony activity.`,
    notAppliance: (name) => `${name} is not a device driven by a Harmony Hub.`,
    unreachable: (name) => `${name} does not answer.`,
    unknownActivity: (value) => `Unknown activity: ${value}.`,
    noCommand: 'Choose a command, or type one.',
    unknownCommand: (command, device) => `${device} has no command "${command}".`,
    activityFailed: (name, reason) => `${name} did not start: ${reason}.`,
    powerOffFailed: (reason) => `Turning off failed: ${reason}.`,
    commandFailed: (command, reason) => `${command} failed: ${reason}.`,
  },
  fr: {
    unknownDevice:
      "Appareil Harmony inconnu : lancez une recherche dans les réglages de l'intégration.",
    notActivity: (name) => `${name} n'est pas une activité Harmony.`,
    notAppliance: (name) => `${name} n'est pas un appareil piloté par un Harmony Hub.`,
    unreachable: (name) => `${name} ne répond pas.`,
    unknownActivity: (value) => `Activité inconnue : ${value}.`,
    noCommand: 'Choisissez une commande, ou saisissez-en une.',
    unknownCommand: (command, device) => `${device} n'a pas de commande « ${command} ».`,
    activityFailed: (name, reason) => `${name} n'a pas démarré : ${reason}.`,
    powerOffFailed: (reason) => `L'extinction a échoué : ${reason}.`,
    commandFailed: (command, reason) => `${command} a échoué : ${reason}.`,
  },
  de: {
    unknownDevice:
      'Unbekanntes Harmony-Gerät: Starte eine Suche in den Einstellungen der Integration.',
    notActivity: (name) => `${name} ist keine Harmony-Aktivität.`,
    notAppliance: (name) => `${name} ist kein Gerät, das ein Harmony Hub steuert.`,
    unreachable: (name) => `${name} antwortet nicht.`,
    unknownActivity: (value) => `Unbekannte Aktivität: ${value}.`,
    noCommand: 'Wähle einen Befehl aus oder gib einen ein.',
    unknownCommand: (command, device) => `${device} hat keinen Befehl „${command}“.`,
    activityFailed: (name, reason) => `${name} wurde nicht gestartet: ${reason}.`,
    powerOffFailed: (reason) => `Ausschalten fehlgeschlagen: ${reason}.`,
    commandFailed: (command, reason) => `${command} fehlgeschlagen: ${reason}.`,
  },
  es: {
    unknownDevice:
      'Dispositivo Harmony desconocido: inicie una búsqueda en la configuración de la integración.',
    notActivity: (name) => `${name} no es una actividad Harmony.`,
    notAppliance: (name) => `${name} no es un dispositivo controlado por un Harmony Hub.`,
    unreachable: (name) => `${name} no responde.`,
    unknownActivity: (value) => `Actividad desconocida: ${value}.`,
    noCommand: 'Elija un comando o escriba uno.',
    unknownCommand: (command, device) => `${device} no tiene el comando «${command}».`,
    activityFailed: (name, reason) => `${name} no se ha iniciado: ${reason}.`,
    powerOffFailed: (reason) => `El apagado ha fallado: ${reason}.`,
    commandFailed: (command, reason) => `${command} ha fallado: ${reason}.`,
  },
};

/** An Error whose message is in the configured language. */
export function localizedError(language, key, ...args) {
  const table = ERRORS[language] ?? ERRORS.en;
  const text = table[key];
  return new Error(typeof text === 'function' ? text(...args) : text);
}

// The pieces of the report shown under the "Search for hubs" button.
export const SEARCH_TEXT = {
  en: {
    none: 'No Harmony Hub found.',
    count: (total, reachable) => `${total} hub(s), ${reachable} answering:`,
    details: (activities, devices) => `${activities} activities, ${devices} devices`,
    connected: 'connected',
    unreachable: 'unreachable',
    noSsdp:
      'The network search through Gladys is unavailable: enter the IP address of the hub in the configuration.',
    notHub: (list) => `No hub answers at: ${list}.`,
    ignored: (list) => `Ignored addresses: ${list}.`,
  },
  fr: {
    none: 'Aucun Harmony Hub trouvé.',
    count: (total, reachable) => `${total} hub(s), ${reachable} répondent :`,
    details: (activities, devices) => `${activities} activités, ${devices} appareils`,
    connected: 'connecté',
    unreachable: 'injoignable',
    noSsdp:
      "La recherche réseau par Gladys est indisponible : saisissez l'adresse IP du hub dans la configuration.",
    notHub: (list) => `Aucun hub ne répond à : ${list}.`,
    ignored: (list) => `Adresses ignorées : ${list}.`,
  },
  de: {
    none: 'Kein Harmony Hub gefunden.',
    count: (total, reachable) => `${total} Hub(s), davon ${reachable} erreichbar:`,
    details: (activities, devices) => `${activities} Aktivitäten, ${devices} Geräte`,
    connected: 'verbunden',
    unreachable: 'nicht erreichbar',
    noSsdp:
      'Die Netzwerksuche über Gladys ist nicht verfügbar: Gib die IP-Adresse des Hubs in der Konfiguration ein.',
    notHub: (list) => `Kein Hub antwortet unter: ${list}.`,
    ignored: (list) => `Ignorierte Adressen: ${list}.`,
  },
  es: {
    none: 'No se ha encontrado ningún Harmony Hub.',
    count: (total, reachable) => `${total} hub(s), ${reachable} responden:`,
    details: (activities, devices) => `${activities} actividades, ${devices} dispositivos`,
    connected: 'conectado',
    unreachable: 'inaccesible',
    noSsdp:
      'La búsqueda en la red a través de Gladys no está disponible: introduzca la dirección IP del hub en la configuración.',
    notHub: (list) => `Ningún hub responde en: ${list}.`,
    ignored: (list) => `Direcciones ignoradas: ${list}.`,
  },
};

/** The report shown under the "Search for hubs" button, in every language. */
export function searchMessage(summary) {
  return Object.fromEntries(
    Object.entries(SEARCH_TEXT).map(([language, text]) => [language, searchReport(summary, text)]),
  );
}

function searchReport({ hubs, ssdp, notHubs, invalidHosts }, text) {
  const lines = [];
  if (hubs.length === 0) {
    lines.push(text.none);
  } else {
    const reachable = hubs.filter((hub) => hub.reachable).length;
    lines.push(text.count(hubs.length, reachable));
    const list = hubs.map(
      (hub) =>
        `${hub.name} (${hub.host}, ${text.details(hub.activities, hub.devices)}, ${hub.reachable ? text.connected : text.unreachable})`,
    );
    lines.push(`${list.join(', ')}.`);
  }
  if (ssdp === 'unavailable') {
    lines.push(text.noSsdp);
  }
  if (notHubs.length > 0) {
    lines.push(text.notHub(notHubs.slice(0, 3).join(', ')));
  }
  if (invalidHosts.length > 0) {
    lines.push(text.ignored(invalidHosts.slice(0, 3).join(', ')));
  }
  return lines.join(' ');
}
