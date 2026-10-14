# Harmony Hub fixtures

No hub was at hand to capture these answers: they were assembled from the
shapes the reference implementations read, and anonymized.

- `aioharmony-config.json`: the configuration of aioharmony's tests
  (`tests/test_harmonyapi.py`, Apache-2.0), unchanged: `id`s as strings, an
  `action` holding JSON in a string, a function whose action is `"null"`.
- `hub-config.json`: a configuration in the shape `get_config` returns, as
  aioharmony (`harmonyclient.py`, `harmonyapi.py`) and Home Assistant
  (`tests/components/harmony/conftest.py`: the `PowerOff` activity of id `-1`,
  an activity without a label) read it: activities with `activityOrder`,
  devices with their `controlGroup` of functions. Device and activity ids,
  models and dates are made up. The command names follow the Logitech
  database naming (`VolumeUp`, `DirectionUp`, `Select`, `SkipBack`...).
- `answers.json`: the HTTP provisioning answer (`setup.account?getProvisionInfo`:
  `activeRemoteId`, `discoveryServer`, and the account e-mail the integration
  must never log), the discovery info (`connect.discoveryinfo?get`:
  `friendlyName`, firmware) and a state digest
  (`vnd.logitech.connect/vnd.logitech.statedigest?get`: `activityId`,
  `activityStatus`, `configVersion`). The account values are fake.
- `ssdp-results.json`: raw SSDP answers as the Gladys core relays them, the hub
  answering with its device type `urn:myharmony-com:device:harmony:1` (the type
  Home Assistant matches in its `manifest.json`), plus a Sonos speaker.

Addresses are in 192.0.2.0/24 (documentation range), MAC addresses and UUIDs
are made up. `scripts/probe.mjs` reads a real hub without changing anything:
its output is what to compare these files with.
