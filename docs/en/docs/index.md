# RayZen Panel

A VPN panel that runs entirely on Cloudflare Workers. No VPS, no monthly bill, and no
server other than your own Cloudflare account.

You deploy a Worker with one click, open the panel, configure your protocols, and
generate ready-to-import subscriptions for your clients.

## Start here

- **[Installation](install.md)** — one-click deployment, then a single setup page.
- **[Configuration](configuration/index.md)** — every setting the panel exposes.
- **[Usage](usage/index.md)** — how each subscription variant behaves, per client.
- **[FAQ](faq.md)** — the questions people actually ask.

## What it does

1. **Relays traffic** over VLESS or Trojan on TLS/WebSocket, with WARP and WARP-Pro
   variants, and optional fragment and UDP-noise obfuscation.
2. **Generates subscriptions** for Xray, sing-box, Clash/Mihomo, WireGuard and Amnezia
   clients, in `normal`, `raw`, `fragment`, `warp` and `warp-pro` variants.
3. **Scans for clean IPs** with a Cloudflare-aware scanner that scores endpoints,
   tracks their lifecycle and tells you which to use.
4. **Checks its own health**, with preflight diagnostics that come with fixes attached.
5. **Serves a private DoH resolver** on your own hostname.
6. **Hands out configs over Telegram**, if you enable the bot.

## Where your data lives

In your own Cloudflare KV namespace, and nowhere else. The Worker generates its private
panel path, VLESS UUID and Trojan password on first bootstrap. During first-run setup you
choose the administrator email and password; RayZen stores a salted password verifier,
not the plaintext password. Nothing is sent to RayZen infrastructure, because there is
no hosted RayZen panel.

## About this documentation

RayZen began as a fork of [BPB Worker Panel](https://github.com/bia-pain-bache/BPB-Worker-Panel), so the protocol behaviour, the subscription
formats and the routing semantics are deliberately compatible with it. Where that is
true, this documentation describes the behaviour as it is rather than as it might
ideally be.
