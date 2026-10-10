![StreamGram logo](https://i.ibb.co/4Lcx07n/logo-banner-dark-out.png)

<p align="center">
  <img src="https://img.shields.io/badge/Node.js-20+-339933?logo=node.js&logoColor=white" alt="Node.js 20+">
  <img src="https://img.shields.io/badge/pnpm-10.11.0-F69220?logo=pnpm&logoColor=white" alt="pnpm 10.11.0">
  <img src="https://img.shields.io/badge/NestJS-10-E0234E?logo=nestjs&logoColor=white" alt="NestJS 10">
  <img src="https://img.shields.io/badge/License-GPLv3-blue" alt="GPLv3 License">
  <img src="https://img.shields.io/badge/Stremio-Addon-8A05BE?logo=stremio&logoColor=white" alt="Stremio Addon">
  <a href="https://t.me/AddonStreamGram"><img src="https://img.shields.io/badge/Telegram-Community-2CA5E0?logo=telegram&logoColor=white" alt="Telegram Community"></a>
</p>

<p align="center">
  <a href="https://app.instapods.com/dashboard/pods/create?repo=https://github.com/ohadhaviv92/streamgram&branch=main&ref=streamgram">
    <img src="https://instapods.com/deploy-button.svg" alt="Deploy StreamGram on InstaPods">
  </a>
</p>

<p align="center">
  <strong>StreamGram is an advanced, self-hosted addon for Stremio-like apps that serves as a direct bridge between your personal Telegram account and your streaming environment. Operating via a dedicated proxy server, it seamlessly searches your Telegram account in real-time, returning direct playback links for smooth, stable streaming—without requiring full file downloads. Open any movie or episode in your Stremio-like app, or map your specific Telegram folders and channels into a dynamic native catalog to browse your collection just like a personal VOD library.</strong>
</p>

---

## Table of Contents

- [Features](#features)
- [Deploy on InstaPods](#deploy-on-instapods)
- [Local Installation](#local-installation)
- [Docker](#docker)
- [Server Configuration & Setup](#server-configuration--setup)
- [Tag Any Video to a Catalog Item](#tag-any-video-to-a-catalog-item)
- [Environment Variables](#environment-variables)
- [Disclaimer](#disclaimer)

---

## Features

- 🔍 **Global search** — open any movie or episode in Stremio and StreamGram searches across your entire connected Telegram account automatically.
- 📺 **Stream provider** — returns direct stream links for any title Stremio resolves, no source setup required.
- 📂 **Catalog addon** — optionally select specific Telegram folders or channels to appear as browsable catalogs inside Stremio, so you can explore and play your library directly.
- 🔗 Install the bridge using a private `/:userToken/manifest.json` addon URL.
- 🎬 Use TMDB metadata and localized search terms for movies and series.
- 🏷️ Tag any accessible Telegram video to the catalog item of your choice using an IMDB or TMDB ID.
- 🧙 Use the browser setup wizard for configuration, Telegram authentication, and source selection.
- 🌐 Support English, Hebrew, Russian, and Arabic search configuration.

---

## How the Addon Works

StreamGram connects your Telegram account to Stremio as **two addon types in one**. Here's how each mode works:

### Stream Provider — On-Demand Global Search

When you open a movie or episode in Stremio, StreamGram searches _globally_ across your **entire connected Telegram account** — no source configuration required. It looks for video files whose filenames or captions match the title, using TMDB metadata and multi-language terms to maximize results. Matching files are returned as stream links and played directly from Telegram.

**This means:** if the media doesn't exist anywhere in your Telegram account, there will be no results.

### Catalog — Browse Your Library

Optionally, you can select specific Telegram folders and channels to appear as **native browsable catalogs** inside Stremio. Instead of searching, you navigate them like a library tab — scroll through all the videos in a folder or channel and play any one directly. This feature requires at least one source to be selected in the setup wizard.

### Pinned Tagging — Precise Matching

You can "pin" any Telegram video to a specific IMDB or TMDB catalog item using the `/tag` command (reply to the video in Telegram). Tagged videos are always matched correctly and appear first — even if the filename doesn't match the title.

| Mode                | How it's triggered                                                                              | Requires                              |
| ------------------- | ----------------------------------------------------------------------------------------------- | ------------------------------------- |
| **Stream Provider** | You open a movie or episode in Stremio → StreamGram searches your whole Telegram account        | Just a connected Telegram account     |
| **Catalog**         | You browse a catalog tab in Stremio → StreamGram lists videos from selected folders/channels    | At least one source selected in setup |
| **Tagged Video**    | You reply `/tag <id>` to a video in Telegram → it's pinned to that catalog item by IMDB/TMDB ID | Accessible Telegram video             |

> [!NOTE]
> **Stream Provider works immediately** after connecting your Telegram account — no source selection needed. Selecting sources is only required if you want to browse catalogs inside Stremio.

---

## Deploy on InstaPods

<p align="center">
  <a href="https://app.instapods.com/dashboard/pods/create?repo=https://github.com/ohadhaviv92/streamgram&branch=main&ref=streamgram">
    <img src="https://instapods.com/deploy-button.svg" alt="Deploy StreamGram on InstaPods">
  </a>
</p>

InstaPods is the easiest way to self-host StreamGram — no server setup, no terminal, just click and deploy.

**Why InstaPods?**

- 🎁 **\$10 free credit** when you add a credit card — no charge until you use it up.
- 💡 StreamGram is lightweight. A **\$3/month pod** handles a single user perfectly — meaning your free credit covers **3+ months** at no cost.
- ⏸️ **Pay as you go** — stop the pod at any time and billing stops immediately. No hidden fees, cancel whenever you want.
- 🔒 **HTTPS included** — no domain or TLS setup needed. InstaPods gives you a public HTTPS URL automatically, which is required for Stremio streaming.
- 🚀 **No bandwidth limit** — stream as much as you want without worrying about data caps.

**Installation Guide:**

1. Click on the **Deploy on InstaPods** button above.
2. Login or create an account if you aren't logged in.
3. Wait about 30 seconds while it analyzes the repository.
4. Click on the **Continue** button (no need to fill the environment variables now).
5. Select the closest region (EU/US).
6. Choose a plan (the **Launch plan - \$3/month** is enough for a single user).
7. If you haven't set up a payment method yet, click **Continue to Payment**. Once added, you will receive a \$10 free credit!
8. Press the **Deploy Now** button.
9. Wait about 1 minute for the build to finish and for the deploy to be marked as successful.
10. Switch to the **Overview** tab and press **Visit Site**. This will open the server admin panel.
11. Configure the server and connect your Telegram account.
12. Enjoy!

---

## Local Installation

Stremio needs a publicly reachable **domain with HTTPS** for addon and stream URLs. Local HTTP access is useful for setup, but use a public HTTPS URL when installing the addon in Stremio. We recommend [your own domain with Caddy](#recommended-domain--https-with-caddy) for automatic HTTPS. You can also use InstaPods' included HTTPS URL, or [Tailscale Funnel](#alternative-tailscale-funnel) for a provided domain and certificate.

```bash
git clone https://github.com/ohadhaviv92/streamgram.git
cd streamgram
npm install
npm run start
```

---

## Docker

```bash
git clone https://github.com/ohadhaviv92/streamgram.git
cd streamgram
docker build -t streamgram .
docker run -d --name streamgram --restart unless-stopped \
  -p 3000:3000 \
  -v ./data:/app/data \
  streamgram
docker logs -f streamgram
```

Open `http://<server-ip>:3000/` to use the setup wizard. If the bridge is behind a reverse proxy, open the wizard through the public HTTPS domain instead.

Add `--env-file .env` to `docker run` when supplying environment variables instead of using the setup wizard.

---

## Public Domain & HTTPS

The Stremio addon needs a publicly reachable **domain and HTTPS** for addon and stream URLs. We recommend a domain or subdomain with Caddy for regular streaming. Tailscale Funnel is an alternative that supplies both a domain and HTTPS, but its bandwidth limits can reduce streaming speed. InstaPods already includes a public HTTPS URL.

### Recommended: Domain + HTTPS with Caddy

1. **Point a domain at your server.** Use a domain you own (for example, `streamgram.example.com`) or a free [DuckDNS subdomain](https://www.duckdns.org/why.jsp). Set its DNS A record to your server's public IPv4 address; only add an AAAA record if IPv6 reaches that server. With DuckDNS, keep the IP updated using its updater. DNS alone does not enable HTTPS.
2. **Make ports reachable.** Allow inbound TCP ports **80 and 443** in the server/cloud firewall. On a home network, forward both ports to the host running Caddy. This setup requires a reachable public IP; behind CGNAT, use Funnel or a server with a public IP.
3. **Install Caddy on the StreamGram host** (Debian/Ubuntu):

   ```bash
   sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https curl gnupg
   curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
   curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
   sudo chmod o+r /usr/share/keyrings/caddy-stable-archive-keyring.gpg
   sudo chmod o+r /etc/apt/sources.list.d/caddy-stable.list
   sudo apt update
   sudo apt install -y caddy
   ```

   The package runs Caddy as a system service. For other systems, see the [official installation guide](https://caddyserver.com/docs/install).

4. **Configure the proxy.** With StreamGram running on port `3000`, edit `sudo nano /etc/caddy/Caddyfile` and add the following site block (replace the default example site on a fresh install; preserve any other sites):

   ```caddyfile
   streamgram.example.com {
       reverse_proxy 127.0.0.1:3000
   }
   ```

   Replace the domain with yours and `3000` with the actual host port. For Docker, Caddy runs on the host and connects to the published port. You can bind it to localhost using `-p 127.0.0.1:3000:3000` instead of `-p 3000:3000` in the Docker command above; keep port `3000` closed to public access.

   Validate and reload:

   ```bash
   sudo caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
   sudo systemctl reload caddy
   ```

   Caddy automatically obtains and renews a trusted TLS certificate and redirects HTTP to HTTPS. See [Caddy's HTTPS guide](https://caddyserver.com/docs/quick-starts/https).

5. **Set StreamGram's public URL.** Open `https://streamgram.example.com` and enter it in the setup wizard, or update **Settings** for an existing instance. Before first-run setup, you can also use `.env`:

   ```dotenv
   PUBLIC_URL=https://streamgram.example.com
   ```

   Saved Settings take precedence over environment defaults. Keep admin protection enabled and install the addon using the HTTPS link shown in the dashboard.

### Alternative: Tailscale Funnel

[Tailscale Funnel](https://tailscale.com/docs/features/tailscale-funnel) provides a public domain and automatic HTTPS without buying a domain or configuring port forwarding. Its bandwidth limits can affect video streaming speed, so prefer the Caddy setup above when your server is directly reachable.

With StreamGram running, install Tailscale on the **Linux host** and forward the app's port:

```bash
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up
# Sign in using the printed URL, then enable Funnel:
sudo tailscale funnel --bg 3000
sudo tailscale funnel status
```

Follow any Funnel approval link and replace `3000` if you use a different host port. For Docker, use the published host port. `--bg` keeps Funnel running after the terminal closes.

Copy the HTTPS URL printed by Funnel into the setup wizard's public URL field (or **Settings** for an existing instance). Alternatively, set it in `.env` before first-run setup:

```dotenv
PUBLIC_URL=https://streamgram.example-tailnet.ts.net
```

Open that URL to finish setup and install the addon. Keep admin protection enabled, since Funnel makes the app public. See the [Linux installation guide](https://tailscale.com/docs/install/linux) and [Funnel CLI reference](https://tailscale.com/docs/reference/tailscale-cli/funnel) for details.

---

## Server Configuration & Setup

1. **Protect management.** New setups enable admin protection by default. Set a password of at least eight characters. Disabling protection makes management accessible to anyone who can reach the instance.
2. **Configure the instance.** Enter the public HTTPS URL, Telegram API ID/hash from [my.telegram.org](https://my.telegram.org), and TMDB v4 Read Access Token from [TMDB settings](https://www.themoviedb.org/settings/api). Environment values prefill the wizard; blank secrets preserve saved values.
3. **Connect Telegram.** Authenticate using QR or phone code, including Telegram two-step verification when required.
4. **Install in Stremio.** Use the prominent install button or copy `https://your-domain/{user_token}/manifest.json`. Folder/channel catalogs are optional; you can install before selecting any.

After initialization, `/` opens the admin dashboard with Overview, Accounts, Invitations, Settings, and Tutorials. Admins can connect accounts directly or create seven-day, single-use invitations. Copy an invitation when it is created; its secret is not shown again.

Each account has a personal page at `/{user_token}/configure` (the existing `/?action=settings&token=…` link also works). It manages only that account's display name, search language, optional catalogs, reconnection, and deletion. Personal language inherits the instance default unless overridden. English, Hebrew, Russian, and Arabic search remain supported; the dashboard supports all four languages, with RTL for Hebrew and Arabic. English is always searched; selecting Hebrew, Russian, or Arabic adds searches in that language. The instance search language defaults to English. During first-run setup, the search-language dropdown initially matches the dashboard language.

Set the dashboard language using `?lng=en`, `?lng=he`, `?lng=ru`, or `?lng=ar` (for example, `https://yourdomain.com/?lng=he`). For links that already have query parameters, append `&lng=he`. A valid URL language overrides the saved browser preference; otherwise the dashboard uses the saved preference or English. The dashboard language selector updates the URL and saves the preference. Interface language and search language can be changed independently.

Private account links grant access without a separate user password. Protected management uses an eight-hour browser session; legacy `X-Admin-Password` clients remain supported. Existing installations without an admin password stay unprotected until you enable protection in Settings. Removing all accounts never reopens public first-run setup.

Settings includes backup/restore. Backups contain private Telegram sessions. Restore preserves current admin credentials/protection, replaces accounts/preferences, and invalidates invitations and browser sessions. See [authentication and access documentation](docs/AUTHENTICATION.md) for API details.

---

## Tag Any Video to a Catalog Item

You can connect an accessible Telegram video to any movie, series, or episode catalog item you choose. Reply to the video message in Telegram with a `/tag` command containing the catalog ID:

```text
/tag tt0137523
/tag tmdb:550
/tag tt0108778:1:1
```

- `tt0137523` is an IMDB movie ID.
- `tmdb:550` is a TMDB movie ID.
- `tt0108778:1:1` is an IMDB series episode ID in the format `title:season:episode`.

When the compatible client searches for that catalog item, the tagged video is prioritized and marked as tagged. The built-in tag assistant can also generate the exact catalog ID command from a search result and send it to Telegram Saved Messages for easy copying.

See the complete [tag feature documentation](docs/TAG_FEATURE.md) for title-based tags, episode formats, and troubleshooting.

---

## Environment Variables

All values below are optional when using the setup wizard. Saved values in the selected persistence backend take precedence over environment defaults. If your deployment uses the old `STREAM_HOST` variable, rename it to `PUBLIC_URL`.

| Variable             | Description                                                                                          |
| -------------------- | ---------------------------------------------------------------------------------------------------- |
| `PUBLIC_URL`         | Public HTTPS base URL with a domain, used to create addon and stream links. For example, `https://yourdomain.com`. |
| `TELEGRAM_API_ID`    | Telegram API ID from [my.telegram.org](https://my.telegram.org).                                     |
| `TELEGRAM_API_HASH`  | Telegram API hash from [my.telegram.org](https://my.telegram.org).                                   |
| `TMDB_BEARER_TOKEN`  | TMDB v4 Read Access Token.                                                                           |
| `PREFERRED_LANGUAGE` | `en`, `he`, `ru`, or `ar`; defaults to `en`.                                                         |
| `PORT`               | HTTP port; defaults to `3000`.                                                                       |
| `STORAGE_DRIVER`     | `json` (default) or `sqlite`; restart to change the backend.                                          |
| `DATA_DIR`           | Private persistence directory; defaults to `data` relative to the working directory.                 |

### Persistence backends

Set `STORAGE_DRIVER=sqlite` to use `data/config.sqlite` instead of `data/config.json`. Both backends support the same settings, Telegram accounts, invitations, and JSON export/import endpoints. The backend is selected only through environment configuration; unsupported values stop startup.

On first SQLite initialization, StreamGram imports an existing `config.json` in `DATA_DIR` in one transaction, preserving account tokens, Telegram sessions, admin credentials, selections, and invitation states. The original JSON file is unchanged. Invalid data stops startup; fix the source and restart to retry. Once SQLite is initialized, later restarts never reimport JSON, even when all accounts have been deleted.

The JSON and SQLite stores evolve independently. To return to JSON with your latest data, export a JSON backup while running SQLite, restart with `STORAGE_DRIVER=json`, and restore that backup. Standard restore preserves the target backend's admin credentials and clears invitations; automatic first-run migration preserves the full source state.

Keep the persistence directory and backups private. Run one application process per store. Docker persists either backend in the existing `/app/data` volume; when overriding `DATA_DIR`, mount that directory instead. Local SQLite dependency installation may require Python, make, and a C++ compiler if a prebuilt native driver is unavailable; the Docker builder includes these tools.

Admin password authentication blocks an IP for 15 minutes after five failures within 15 minutes. Login and `x-admin-password` requests share the counter; successful password verification resets it. Existing browser sessions remain usable. Counters are held in memory and reset on restart.

---

## Disclaimer

> [!WARNING]
> StreamGram is a bridge, not a media library. It does not host, upload, or distribute any content. You choose the Telegram sources your account can access and are solely responsible for using this software in compliance with applicable law, copyright permissions, Telegram's Terms of Service, and the terms of your client or provider.

---
