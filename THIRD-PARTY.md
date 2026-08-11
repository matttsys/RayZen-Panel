# Third-party boundaries

RayZen deliberately keeps third-party engines and fonts outside the source distribution when they are not necessary to build the core Worker/Wizard.

## Vazirmatn
Persian typography is designed around Vazirmatn. The upstream project publishes the font under SIL Open Font License 1.1. RayZen's `scripts/sync-vazirmatn.mjs` documents and automates the optional release-input step; this repository does not vendor font binaries.

## Clean IP scanners
RayZen Scanner is an orchestration and product-experience layer. It does not copy, fork or rewrite the scanning algorithms of `4n0nymou3/Clean-IP-Scanner` or `bia-pain-bache/Cloudflare-Clean-IP-Scanner`. Users supply their own local upstream executable. Their upstream license and distribution terms remain authoritative for those binaries.
