# One public domain, split into independently-deployed workers via Worker Routes

The Jakarta and Kuala Lumpur chat workers are both reachable under one public domain (e.g. `findrooms.app/jakarta/*` and `findrooms.app/kl/*`), using Cloudflare Worker Routes to dispatch by path — not a single shared worker that branches internally by country.

This was chosen over a single shared worker because the two countries were already decided (see [ADR-0001](0001-separate-deployment-per-country.md)) to have independent D1 databases, deploy cycles, and normalize rules; a single worker branching on country would recouple those for no benefit beyond having "one worker," while a route split keeps the single-URL experience users see without recoupling the backends. A future reader should not assume the one-domain appearance implies one shared runtime.
