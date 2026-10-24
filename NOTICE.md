# Notice

The source code in this repository is released under the MIT License (see `LICENSE`).

The MIT grant covers this repository's code only. It does not cover:

- **The Sigmora name, logo and brand.** "Sigmora" and "Tastemaker by Sigmora" are trademarks of their owner. You may not use them to name or promote a derived product.
- **The Sigmora platform.** The publishing engine behind "Schedule with Sigmora" is a separate, proprietary service. This repository talks to it only through a narrow HTTPS `/v1` interface with a bearer token from the environment. No Sigmora platform code is included here, and the public demo uses a labeled sandbox publisher.
- **Qloo data.** Responses from the Qloo API (including any recorded in `fixtures/qloo/`) are subject to Qloo's terms. The offline simulator in `src/lib/qloo/sim/` contains hand-set placeholder numbers, not Qloo data.

Entity names in the simulator catalog and presets are real public artists, brands, shows, venues and places, used only to make the offline demo readable. No affiliation or endorsement is implied.
