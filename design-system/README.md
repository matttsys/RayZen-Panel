# RayZen Panel design tokens

`tokens.json` is the canonical design-token source for the Panel and deployment Wizard in this repository.

Generated web representations are consumed by RayZen Panel surfaces only. RayZen Scanner and RayZen Companion are independent repositories and consume versioned product contracts rather than importing this directory.

When visual language changes materially, update the downstream products intentionally through their own release processes; do not create Git submodule or runtime coupling between repositories.
