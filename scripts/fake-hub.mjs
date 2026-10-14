// -----------------------------------------------------------------------------
// A simulated hub on 127.0.0.1:8088 (real HTTP and WebSocket), for a manual
// check of the real client: run `node scripts/fake-hub.mjs`, then
// `node scripts/probe.mjs 127.0.0.1 --listen 20` in another terminal. Every
// 5 s the hub "remote" starts another activity, so the notifications can be
// seen. Not a test (and kept out of test/, which node --test runs whole): the
// tests do not touch the network.
// -----------------------------------------------------------------------------

import { ACTIVITY, createHub, serve } from '../test/helpers/fakeHub.js';

const hub = createHub();
await serve(hub);
console.log('Simulated Harmony Hub on http://127.0.0.1:8088 (Ctrl+C to stop)');
const cycle = [ACTIVITY.WATCH_TV, ACTIVITY.MUSIC, ACTIVITY.OFF];
let step = 0;
setInterval(() => {
  hub.pressActivityButton(cycle[step % cycle.length]);
  step += 1;
}, 5_000);
