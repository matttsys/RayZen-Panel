# :material-server-network:{ .md .middle } Proxy IP Setup

A **Proxy IP** is the fallback Cloudflare IP your Worker dials out through when a
**direct** connection to the target fails. The Worker always tries direct first;
only when that fails (common on filtered networks) does it retry through a proxy
IP. If the proxy-IP list is empty, there is no fallback — the connection dies
with `ws closed: 1011` and the log line
`Retry connection failed: no proxy IP configured`.

!!! warning "Fresh deployments have none"
    A new deployment starts in Proxy IP mode with an **empty** proxy-IP list. On a
    network where direct connections fail, that means every connection dies at the
    fallback step. This is the single most common reason a fresh install "doesn't
    work". If you see the error above, this page is the fix.

## Check what you have

Open the Panel and go to the **Proxy IP** page (or visit `/proxy-ip` on your Worker
address in a browser). It lists proxy IPs by region and ISP and can test TCP latency
from the Worker to each IP, so you can pick ones that are actually fast from your
side of the internet.

The RayZen Companion app checks this for you: before dialing, it asks the Panel
whether any proxy IP is configured. If the list is empty it stops *before* the tunnel
fails and offers a button straight to the Panel's Proxy IP page.

## Add proxy IPs (two ways)

### Option A — Cloudflare dashboard (recommended)

Set the `RAYZEN_PROXY_IPS` environment variable on your Worker, one IP per line:

```
RAYZEN_PROXY_IPS=203.0.113.10
203.0.113.11
```

When this variable is non-empty it **overrides** the proxy-IP list saved in the
Panel/KV at runtime. This is the recommended way because changing the Proxy IP via
the Panel requires updating the subscription afterwards — and users without an
active subscription cannot update theirs, which breaks donated configs. The
environment variable avoids all of that. Redeploy (or wait for the variable to
take effect) after changing it.

### Option B — Panel settings

Edit the **Proxy IPs / Domains** field in the Panel settings, one entry per line,
then update your subscription. Use this only for personal setups where you control
every client.

## Picking good IPs

- Prefer IPs in your region and on your ISP — the `/proxy-ip` page's latency test
  tells you which ones answer fastest from the Worker.
- Use **more than one**. A single proxy IP can stop working without warning; with
  several, the Worker rotates and one dying does not take you offline.
- If you need the *same* IP for every destination (not just Cloudflare addresses),
  use **Chain Proxy** instead — it fixes your exit IP for all targets. See the
  [VLESS / Trojan](vless-trojan.md) page.

## Proxy IP vs NAT64

Since 3.4.2 the Panel lets you choose between **Proxy IP** and **NAT64 Prefix**
modes for Cloudflare CDN addresses. Proxy IP is the default and what most people
want. NAT64 prefixes are region- and ISP-specific — only switch if you know the
right prefix for your network.

## Symptoms checklist

| You see | It means | Fix |
|---|---|---|
| `ws closed: 1011` in the client log | The Worker errored while dialling out | Add a proxy IP (this page) |
| `no proxy IP configured` | Direct failed and the proxy-IP fallback list is empty | Add a proxy IP (this page) |
| Worked yesterday, dead today | Direct started failing and your single proxy IP is dead too | Add several IPs, or switch to `Best Ping` |
| Some sites work, some don't | Direct works for some targets; one bad IP in the fallback list | Test IPs on `/proxy-ip`, replace the dead ones |
