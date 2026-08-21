# Connections

## Supabase

Use for:

- authentication;
- Postgres persistence;
- storage for user media and generated assets;
- realtime only where it materially improves collaboration/session synchronization.

The connected Captivate project currently uses the Supabase project supplied by the project owner. Keep project refs and credentials in environment configuration, not committed source.

Required implementation safeguards:

- RLS on user/membership-scoped data;
- service-role key server-only;
- signed/private object access for non-public assets;
- migrations committed under `supabase/migrations`;
- explicit Preview/Production environment handling before launch.

## Vercel

Use for application hosting, Preview deployments, environment separation, and deployment verification. Preview deployments should be usable for end-to-end presenter/editor testing and must not silently redirect authentication or storage to an unintended production origin.

## AI providers

Keep AI calls behind server-side adapters. The product should support provider/model substitution over time. OpenAI is an expected provider, but domain logic must not depend directly on a model-specific response shape.

## Motion ecosystem

Motion for React is the primary animation library. Agent tooling may be installed for Claude/Codex to search animation patterns and assess motion performance, but generated animation code remains subject to Captivate's accessibility/performance rules.

## Future connections

Potential later integrations include:

- Google Drive / OneDrive / Dropbox for source and asset import;
- LMS/LTI systems;
- YouTube/Vimeo/media providers;
- stock/generative media sources;
- remote presenter devices;
- export/render processing infrastructure if browser-native recording becomes insufficient.

Do not add a dependency merely because an integration may eventually exist. Add adapters when the product workflow is implemented.
