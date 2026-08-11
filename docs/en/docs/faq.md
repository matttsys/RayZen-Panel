# :material-cloud-question-outline:{ .lg .middle } Frequently Asked Questions

??? question "Why don't v2ray configs connect?"
    If you enabled `Routing rules` and the VPN doesn't connect, the only reason is that the Geo assets are not updated. In the v2rayN(G) client menu, go to the `Asset files` section and tap the cloud or download icon to update. Note that it takes a while to update, you have to wait to see `success` for all files. If the update fails, it won't connect. If you tried everything and it still doesn't update, download the two files below from the links and instead of updating, tap the add button and import these two files:
    ```title="GeoIP"
    https://github.com/Loyalsoldier/v2ray-rules-dat/releases/latest/download/geoip.dat
    ```
    ```title="GeoSite"
    https://github.com/Loyalsoldier/v2ray-rules-dat/releases/latest/download/geosite.dat
    ```

??? question "Why don't Raw subscription configs connect or cannot open websites?"  
    To use these configs, disable `Mux` in the settings of whichever app you're using. Also set remote DNS to DOH, DoT or TCP:
    ```title="DoH"
    https://8.8.8.8/dns-query
    ```
    ```title="DoT"
    tls://8.8.8.8  
    ```
    ```title="TCP"
    tcp://8.8.8.8  
    ```

??? question "Why configs connect using v2rayNG and not Streisand for example?"
    Client apps adapt new cores' features at different speeds. RayZen generates standard
    VLESS/Trojan configs, but some clients are slower to support new features or
    optimizations. You should communicate such issues with their own developers.

??? question "Why Fragment configs speed is slow on my ISP?"
    Each ISP has its own preferred Fragment settings. Most are fine with the panel defaults, but these values may work well on yours. You may need to change Fragment profile to `Medium`, `High` or even manually change settings in `Custom` profile to achieve better results. Also MahsaNG is recommended to connect to fragment configs.

??? question "Why some websites or applications like X and ChatGPT are not working well?"  
    RayZen does not ship third-party proxy IPs — a fresh deployment routes direct until
    you add your own proxy IPs or run the endpoint scanner to find clean IPs. If you
    configured one and it is unstable, test others from the scanner or use the
    `Best Ping` config, which picks the best endpoint automatically.

    Also disable IPv6 if your ISP does not provide it.  

??? question "It worked when I set a proxy IP, but now it's not working!"
    If you use a single IP, it may stop working after some time and many sites won't open. You need to redo the steps. Preferably, if you're not doing anything that needs a static IP, use the `Best Ping` config instead of a single proxy IP.

??? question "Why do I get an error when I go to the `panel/` address?"
    The panel lives under a random secret path chosen at installation, so a bare
    `/panel` address is not routable by design. If you lost the address, open the
    Worker in your Cloudflare dashboard and check the `securePath` value in the KV
    pairs, or redeploy with the Installer and save the new address.

??? question "I deployed it but Cloudflare returns error 1101!"
    Your Cloudflare account has likely been flagged. Create a new Cloudflare account with an official email like Gmail, and avoid obvious VPN-related project names.
    It is recommended to use the **RayZen Installer** for installation.  

??? question "Can I use this for trading?"
    If your Cloudflare IP is located in Germany (which it usually is), using a single Germany proxy IP should be fine. But preferably use the Chain Proxy method to stabilize the IP.  

??? question "Why I can't see non-TLS ports in panel?"
    To use non-TLS configs, you must deploy via Workers method and without a custom domain.  

??? question "Why doesn't the Smart Fragment config connect or work properly?"
    Turn off `Prefer IPv6` in settings.  

??? question "Why don't Telegram calls or Clubhouse work?"
    Cloudflare can't properly handle the UDP traffic. There is currently no effective solution. Use Warp configs instead.

??? question "I forgot the panel password. What should I do?"
    You cannot: it is stored as you typed it, but the panel's reset route needs an existing session. Delete the `pwd` key from your Worker's KV namespace in the Cloudflare dashboard instead. The next visit shows the first-run setup page again, and your settings and subscriptions are untouched.

??? question "Why doesn't the panel show the Block Ads checkbox?"
    Extensions like `uBlock`, `AdGuard` or even some browsers with built-in ad-block settings, can hide it. Disable them for the panel.

??? question "Why v2rayN cannot ping test configs?"
    Right now v2rayN is experiencing some issues with custom configs and RayZen panel configs are all custom. No worries, just enable config and use it. You also have a Best Ping config in all subscriptions which connects to the best IP automatically, so you don't need to test all configs every time.

??? question "Why does sing-box throw an error while importing a subscription?"
    RayZen supports sing-box 1.12.0 or higher.
