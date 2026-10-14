# Security policy

## Reporting a vulnerability

Please do **not** report a security problem in a public issue, pull request or
forum post.

Report it privately through GitHub instead: open the **Security** tab of this
repository, then **Report a vulnerability**.

No such button? Private reporting is not enabled yet: open an issue that only
asks the maintainers for a private contact, without any detail of the problem,
and send the report there.

Include, when you can:

- the version of the integration and of Gladys;
- what an attacker can do, and the steps to reproduce it;
- the log lines that help (remove tokens, passwords and addresses first).

The fix ships as a new version of the integration, and the advisory is
published once users can update.

## Supported versions

Only the latest release receives security fixes: update the integration from
Gladys before reporting a problem.

## Scope

In scope: the code of this repository and the Docker image it publishes.

What the integration handles:

- **No credential.** The hub answers on the local network without a password or
  a token; the integration asks for none and stores none. The hub's
  provisioning answer also carries the Logitech account (e-mail, account id):
  only the hub id is kept from it, and nothing of the account is stored or
  logged (a test checks the logs at the debug level).
- **`/data/harmony-state.json`**: the hubs seen (hub id, address, name,
  firmware) and the useful part of their configuration (activities, devices,
  command names), so their devices stay listed while a hub is off.
- **Network**: plain HTTP and WebSocket to port 8088 of the hubs, on the local
  network only — the hub offers no encryption. SSDP searches go through the
  Gladys core (mediated discovery). No Internet access is needed or used.
- Anyone on the local network can drive the hub the same way: that is the
  hub's design, not something the integration can change.

Out of scope: Gladys Assistant itself (see its
[security policy](https://github.com/GladysAssistant/Gladys/security/policy)),
the Harmony Hub, its firmware and the Logitech services.
