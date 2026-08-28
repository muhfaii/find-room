# Same repo, parallel structure for the Kuala Lumpur deployment

Kuala Lumpur's config, ingest worker, and chat worker live in this same repo as new parallel files/directories (`src/config/klMudah.ts`, `workers/ingest-kl/`, `workers/chat-kl/`), rather than a new repo. The `src/crawlers/*` discovery/detail-refresh logic and `src/config/politeness.ts` are source-agnostic and are shared as-is by both deployments.

A separate repo was considered and rejected: it would require duplicating that shared crawler/politeness code, and the two copies would drift out of sync over time with no mechanism to keep them aligned.
