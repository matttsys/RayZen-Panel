# :material-qrcode-scan:{ .md .middle } Quick Add

**Quick Add** is the fastest way to get the RayZen Companion app talking to your
Panel: the Panel mints a one-time QR code, you scan it with the app, and the app
configures itself — no URL pasting, no typing passwords on a phone keyboard.

## How it works

1. In the Panel (signed in as admin), mint a **Quick-add** code. The Panel shows a
   QR code encoding a `rayzen://v1/…` link.
2. In the Companion app, choose Quick-add and scan the code.
3. The app redeems the code with the Panel, receives a session, and wipes the
   code's credentials from memory afterwards. Done.

## Expiry and single use

Quick-add codes are deliberately short-lived:

- **Lifetime:** 10 minutes by default, configurable from 1 minute up to 1 hour
  when minting.
- **Single-use:** each code can be redeemed exactly once. Scanning it a second
  time fails.
- **Countdown:** the app shows a live "expires in ~X min" countdown parsed from
  the code, and refuses already-expired codes before even contacting the Panel.
- **Server enforcement:** expiry is also enforced on the Panel side at redeem
  time, so a tampered code cannot buy extra minutes.

If a code expired before you scanned it, just mint a fresh one — it takes
seconds.

## Revoking a code

Minted a code you no longer want used (wrong person saw the screen, sent it to
the wrong chat)? The Panel can **revoke** it: a revoked code fails at redeem time
even if it has not expired yet.

## Security notes

- Minting requires an admin session — visitors cannot generate codes.
- The code grants access to *your* Panel. Treat it like a password: don't post
  screenshots of it, and prefer the shortest lifetime you need.
- After a successful redeem the app discards the code material; the ongoing
  session uses its own credentials.
