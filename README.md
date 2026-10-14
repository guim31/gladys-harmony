# Logitech Harmony Hub for Gladys Assistant

A [Gladys Assistant](https://gladysassistant.com) integration that drives a
**Logitech Harmony Hub** over the local network: start an activity, turn
everything off, send any remote key to the devices the hub controls, and start
scenes when an activity starts.

> **Developed without the hardware: feedback welcome.** The protocol follows
> aioharmony, the library of the Home Assistant integration, and the
> integration is tested end to end against a simulated hub, but it has not run
> against a real one yet. Please open an issue with what works and what does
> not.
>
> This project is not affiliated with Logitech. Harmony is a trademark of
> Logitech.

## What it does

- **Finds the hubs** of the local network through Gladys (SSDP), or at the
  addresses you type; follows a hub that changes address.
- **Hub device**: the current activity, and a list to start one or turn
  everything off.
- **Activity devices**: one switch per activity, on while it runs. Being
  devices, the activities can be picked from lists in scenes and widgets.
- **Appliance devices** (TV, amplifier, media player…): the list of all their
  commands, and push buttons for the usual remote keys they have.
- **Real time**: the hub's WebSocket notifications update Gladys within a
  second, whoever started the activity (remote, app, Gladys); the integration
  also reads the current activity every 30 s, without Gladys' scheduler.
- **Scene triggers**: "Harmony activity started" (with the activity, filterable)
  and "Harmony turned everything off" — dim the lights when the film starts.
- **Scene actions**: start an activity (waits for the hub to finish), turn
  everything off, send a command to an appliance, repeated with a delay.
- **Dashboard widget**: the current activity, buttons for up to three favourite
  activities, and Off.
- Texts in English, French, German and Spanish.

Everything stays local: no Logitech account, no cloud, no credential. The
integration uses the WebSocket API of the hub (port 8088, the one the Harmony
app uses), not the XMPP API that recent firmwares disable by default.

## Requirements

- A Logitech Harmony Hub (or the hub of a Harmony Companion, Elite, Pro or
  Smart Control) set up with the Harmony app, on the same network as Gladys.
- Gladys Assistant **5.1.0** or later.

## Installation

In Gladys: **Integrations → Install from GitHub**, with the URL of this
repository. Then open the integration's **Configuration** tab (the hubs are
searched automatically; type the address of a hub that is not found), and add
the devices you want from the **Discover** tab.

The user documentation is in [English](docs/en.md), [French](docs/fr.md),
[German](docs/de.md) and [Spanish](docs/es.md).

## Limits

- Only the running activity is known: the hub does not know the state of the
  TV or the amplifier themselves (it sends infrared).
- Scene actions offer the usual commands in a list (Gladys cannot list the
  commands of each appliance in a scene form); the others are typed. The full
  list of an appliance is its **Command** feature.
- No long press; Harmony "Sequences", Hue lights and smart home devices paired
  with the hub are not exposed.
- Logitech no longer develops Harmony: a firmware that closes the local API
  would stop the integration.

## Development

```bash
npm install
npm test               # node --test, against simulated hubs and the SDK's fake Gladys
npm run lint
npm run format:check
node scripts/probe.mjs 192.0.2.40   # read-only check against a real hub
node scripts/fake-hub.mjs           # a simulated hub on 127.0.0.1:8088, for the probe
```

`scripts/probe.mjs` reads a real hub without changing anything (no activity
started, no key sent) and prints only what is safe to share: the shape of its
answers, not the Logitech account. The tests never touch the network.

See [CLAUDE.md](CLAUDE.md) for the architecture and the rules of the
repository, [CHANGELOG.md](CHANGELOG.md) for the changes.

## Credits

- [aioharmony](https://github.com/Harmony-Libs/aioharmony) (Apache-2.0), by
  Erik Hendrix, J. Nick Koston and contributors: the WebSocket protocol of the hub (provisioning
  request, message names, the `holdAction` notation, activity start sequence).
  Its test configuration is reused as a fixture.
- The [Home Assistant Harmony integration](https://github.com/home-assistant/core/tree/dev/homeassistant/components/harmony)
  (Apache-2.0): the hub id used as identifier, the SSDP device type, the
  handling of the `PowerOff` activity and of unlabelled activities.
- The official
  [Gladys integration template](https://github.com/GladysAssistant/integration-template-js)
  and SDK.

## License

[Apache-2.0](LICENSE).
