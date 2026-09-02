<div align="center" dir="rtl">

<img src="rayzen-logo.png" width="150" alt="RayZen">

# پنل RayZen

کنترل‌پنل شبکه‌ی خودمیزبان برای Cloudflare Workers.

[استقرار با ویزارد RayZen](https://rayzen.bond) · [English](README.md)

[![License: GPL v3](https://img.shields.io/badge/License-GPLv3-276c7c.svg?style=flat-square)](LICENSE)
![Cloudflare Workers](https://img.shields.io/badge/Cloudflare-Workers-f38020?style=flat-square)
![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178c6?style=flat-square)
![Tests](https://img.shields.io/badge/tests-1184-276c7c?style=flat-square)
![Version](https://img.shields.io/badge/version-1.1.0-276c7c?style=flat-square)

</div>

<div dir="rtl">

پنل RayZen شامل Worker، رابط وب، راه‌اندازی نخستین اجرا و ویزارد استقرار است. تنظیمات، اطلاعات ورود، نشست‌ها، اشتراک‌ها و تاریخچه‌ی عملیاتی در حساب Cloudflare مالک باقی می‌مانند.

RayZen Companion از پنل به‌عنوان بک‌اند رسمی استفاده می‌کند. اپ مستقیماً به Worker مالک متصل می‌شود، وضعیت سلامت و عیب‌یابی را می‌خواند و نتیجه‌ی انتخاب‌شده‌ی اسکنر را از مسیر محدود و اعتبارسنجی‌شده اعمال می‌کند. اسکنر بومی داخل Companion قرار دارد و سرویس اسکنر جداگانه‌ای لازم نیست.

## تصاویر

</div>

<table>
<tr>
<td width="50%"><b>داشبورد روشن</b><br><img src="docs/design-review/panel-dashboard-light.png" alt="داشبورد روشن RayZen"></td>
<td width="50%"><b>داشبورد تیره</b><br><img src="docs/design-review/panel-dashboard-dark.png" alt="داشبورد تیره RayZen"></td>
</tr>
<tr>
<td><b>فارسی و راست‌به‌چپ</b><br><img src="docs/design-review/panel-dashboard-fa.png" alt="پنل فارسی RayZen"></td>
<td><b>موبایل</b><br><img src="docs/design-review/panel-dashboard-mobile-390.png" width="260" alt="پنل RayZen روی موبایل"></td>
</tr>
</table>

<div dir="rtl">

## قابلیت‌ها

- تولید اشتراک VLESS، Trojan، WARP و WARP Pro برای کلاینت‌های Xray، sing-box، Clash، WireGuard و Amnezia.
- هفت تم کامل در حالت روشن و تیره: Midnight، Ocean، Aurora، Forest، Tropical، Lavender و Sunset.
- رابط انگلیسی و فارسی با چیدمان کامل راست‌به‌چپ.
- مرکز سلامت، بررسی پیش از استقرار، عیب‌یابی، متریک‌ها و تاریخچه‌ی محدود عملیات.
- اسکن اندپوینت‌های پیکربندی‌شده، امتیازدهی، اطمینان و چرخه‌ی عمر.
- لینک اشتراک مستقل برای هر دریافت‌کننده با انقضا و لغو دسترسی.
- پشتیبان‌گیری، اعتبارسنجی، مقایسه و برنامه‌ی بازیابی با حذف اطلاعات محرمانه.
- Telegram اختیاری، DNS-over-HTTPS و مدیریت دامنه‌ی اختصاصی.
- CSP سخت‌گیرانه، کوکی نشست امن و رابط کاملاً خودمیزبان.

## استقرار

### ویزارد RayZen

[rayzen.bond](https://rayzen.bond) را باز کنید، دسترسی Cloudflare را تأیید کنید و راه‌اندازی نخستین اجرا را کامل کنید. ویزارد یک Worker و فضای KV در حساب انتخاب‌شده می‌سازد و همان فایل Worker قفل‌شده با SHA-256 را مستقر می‌کند.

ویزارد فقط برای استقرار است و پنل، اطلاعات ورود یا داده‌های KV را میزبانی نمی‌کند.

### استقرار از سورس

نیازمندی‌ها: Node.js نسخه‌ی 20.10 یا جدیدتر و حساب Cloudflare.

</div>

```bash
git clone https://github.com/matttsys/RayZen-Panel.git
cd RayZen-Panel
npm ci
npx wrangler kv namespace create rayzen \
  --binding kv --update-config
npm run deploy
```

<div dir="rtl">

Worker در نخستین درخواست هویت خود را در KV می‌سازد و صفحه‌ی یک‌بارمصرف راه‌اندازی را نمایش می‌دهد.

### نصب‌کننده‌ی مستقیم

</div>

```bash
npm ci
npm run build
npm run install:cloudflare
```

<div dir="rtl">

نصب‌کننده اعتبار توکن Cloudflare را بررسی می‌کند، KV را می‌سازد، Worker را بارگذاری می‌کند و آدرس راه‌اندازی را نمایش می‌دهد. توکن ذخیره نمی‌شود.

جزئیات متغیرهای محیطی، دامنه‌ی اختصاصی و بازیابی در [راهنمای استقرار](docs/DEPLOYMENT.md) آمده است.

## API اپ Companion

همه‌ی مسیرها نسبت به `https://<worker>/<securePath>/` هستند.

| کاربرد | متد و مسیر | احراز هویت |
| --- | --- | --- |
| شناسایی محصول | `GET panel/version` | عمومی |
| ورود | `POST login/authenticate` | ایمیل و گذرواژه |
| تنظیمات و پروفایل | `GET panel/settings` | کوکی نشست |
| مصرف Cloudflare | `GET panel/usage` | کوکی نشست |
| سلامت | `GET panel/platform/health` | کوکی نشست |
| عیب‌یابی | `GET panel/platform/advanced/diagnostics` | کوکی نشست |
| تاریخچه‌ی اسکنر | `GET panel/platform/scanner/history` | کوکی نشست |
| اعمال Clean IP | `POST panel/platform/scanner/apply` | کوکی نشست |

مسیر `scanner/apply` فقط `cleanIPs` را تغییر می‌دهد و امکان بازنویسی تنظیمات نامرتبط را ندارد. قرارداد کامل در [قرارداد یکپارچه‌سازی](docs/INTEGRATION-CONTRACTS.md) ثبت شده است.

## مدل امنیتی

- نشست مدیر با JWT امضاشده و کوکی `HttpOnly`، `Secure` و `SameSite=Strict` نگهداری می‌شود.
- گذرواژه به‌صورت verifier نمک‌دار PBKDF2-SHA-256 ذخیره می‌شود.
- شناسه و توکن حساب Cloudflare در متغیرهای محیطی خوانده می‌شوند و در KV یا فایل پشتیبان نوشته نمی‌شوند.
- صفحه‌های وب از هش CSP زمان ساخت استفاده می‌کنند و منبع خارجی رابط کاربری ندارند.
- فایل‌های پشتیبان مسیر پنل و اطلاعات پروتکل را حذف می‌کنند.
- مسیرهای ناشناخته هیچ برندینگ یا هدر مشخص RayZen ندارند.

محدودیت‌ها و روش‌های بازیابی در [راهنمای امنیت](SECURITY.md) آمده‌اند.

## توسعه و بررسی انتشار

</div>

```bash
npm ci
npm run verify:release
npm run verify:tdz-build-matrix
npm run test:deploy-flow
XDG_CONFIG_HOME=/tmp/rayzen-wrangler npm run deploy:check
```

<div dir="rtl">

فایل اصلی انتشار `dist/worker.js` است. نسخه‌ی `wizard/artifacts/worker.js` باید بایت‌به‌بایت با آن یکسان باشد و اطلاعات SHA-256 در manifestها ثبت شود.

## اعتبار و مجوز

پنل RayZen با مجوز [GPL-3.0](LICENSE) منتشر می‌شود.

RayZen در ابتدا فورکی از [BPB Worker Panel](https://github.com/bia-pain-bache/BPB-Worker-Panel) نوشته‌ی bia-pain-bache بود. اعتبار آن پایه حفظ شده و RayZen رابط، سامانه‌ی استقرار، عیب‌یابی، یکپارچه‌سازی اسکنر و فرایند انتشار مستقل خود را نگهداری می‌کند.

RayZen وابسته یا مورد تأیید Cloudflare نیست.

</div>
