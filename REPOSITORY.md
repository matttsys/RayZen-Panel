# Repository boundary

RayZen-Panel owns the Cloudflare Worker runtime, web Panel, deployment Wizard, build pipeline and deployable Worker artifact.

The lightweight edge-measurement feature under `src/features/scanner` is a Panel capability that evaluates candidate endpoints from inside the Worker. It is not the external RayZen Scanner engine product. RayZen-Scanner and RayZen-Companion live in independent repositories and integrate only through documented HTTP/deep-link contracts.
