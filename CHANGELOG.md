# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

### Added

- Logitech Harmony Hub over the local network (WebSocket API, port 8088): no
  account, no cloud. Developed without the hardware: feedback welcome.
- The hubs are found through Gladys (SSDP) or at typed addresses, and followed
  when their address changes.
- Hub device: current activity, and a list to start an activity or turn
  everything off.
- One device per activity, with a switch that is on while it runs.
- One device per appliance driven by the hub: the list of its commands, and
  push buttons for the usual remote keys (volume, channels, arrows, playback…).
- Real-time states from the hub's notifications, a read every 30 seconds
  without Gladys' scheduler, and a 6-hour heartbeat.
- Scene triggers "Harmony activity started" and "Harmony turned everything
  off", with a guard against scenes starting each other forever.
- Scene actions "Start a Harmony activity", "Turn everything off (Harmony)" and
  "Send a Harmony command" (repeat and delay).
- Dashboard widget "Harmony remote": current activity, favourite activities,
  Off.
- "Search for hubs" button in the Configuration screen.
- English, French, German and Spanish texts and documentation.

[Unreleased]: https://github.com/guim31/gladys-harmony/commits/main
