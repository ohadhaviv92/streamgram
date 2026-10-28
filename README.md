![StreamGram logo](https://i.ibb.co/4Lcx07n/logo-banner-dark-out.png)

<p align="center">
  <img src="https://img.shields.io/badge/Node.js-20+-339933?logo=node.js&logoColor=white" alt="Node.js 20+">
  <img src="https://img.shields.io/badge/pnpm-10.11.0-F69220?logo=pnpm&logoColor=white" alt="pnpm 10.11.0">
  <img src="https://img.shields.io/badge/NestJS-10-E0234E?logo=nestjs&logoColor=white" alt="NestJS 10">
  <img src="https://img.shields.io/badge/License-GPLv3-blue" alt="GPLv3 License">
  <img src="https://img.shields.io/badge/Stremio-Addon-8A05BE?logo=stremio&logoColor=white" alt="Stremio Addon">
</p>

<p align="center">
  <a href="https://discord.gg/hZ6YzUWzYK">
    <img src="docs/assets/join-discord.svg" alt="Join our Discord">
  </a>
  <a href="https://app.instapods.com/dashboard/pods/create?repo=https://github.com/ohadhaviv92/streamgram&branch=main&ref=streamgram">
    <img src="https://instapods.com/deploy-button.svg" alt="Deploy StreamGram on InstaPods">
  </a>
</p>

<p align="center">
  <strong>StreamGram is an advanced, self-hosted addon for Stremio-like apps that connects your personal Telegram account to your streaming environment. Operating via a dedicated proxy server, it seamlessly searches your Telegram account in real-time, returning direct playback links for smooth, stable streaming—without requiring full file downloads. Open any movie or episode in your Stremio-like app, or map your specific Telegram folders and channels into a dynamic native catalog to browse your collection just like a personal VOD library.</strong>
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
- [Optional Admin Features](#optional-admin-features)
- [Contributing](#contributing)
- [Disclaimer](#disclaimer)
- [Support the project](#support-the-project)

---

## Features

- 📺 **Stream provider** — open a movie or episode in Stremio or Nuvio to find matching Telegram playback sources using the title's metadata and localized names.
- 📂 **Channel and folder catalogs** — select Telegram channels or folders in settings and browse their videos as catalogs in your player.
- 🔎 **Global Telegram search** — search from Stremio or Nuvio using exactly the text you type, just like searching in Telegram. Get up to 100 video items, each with one playback stream.
- 🔗 Install StreamGram using a private `/:userToken/manifest.json` addon URL.
- 🎬 Use TMDB metadata and localized search terms for movies and series.
- 🏷️ Tag any accessible Telegram video to the catalog item of your choice using an IMDB or TMDB ID.
- 🧙 Use the browser setup wizard for configuration, Telegram authentication, and source selection.
- 🌐 Support English, Hebrew, Russian, Arabic, and Spanish search configuration.

---

## How the Addon Works

StreamGram brings your Telegram videos into Stremio and Nuvio in three ways:

### 1. Stream Provider — Sources for Movies and Series

Open a movie or episode from a catalog in your player. StreamGram uses its metadata, localized titles and episode information to find matching Telegram videos and show them as playback sources for that title.

### 2. Channel and Folder Catalogs — Browse Videos

Select Telegram channels or folders in settings. They appear as catalogs in your player, where you can browse their videos and choose what to watch.

### 3. Global Telegram Search — Search What You Type

Type in the app's global search and look for **StreamGram — Telegram Search**. Your exact text is sent to Telegram's global message search in your connected account, just like searching in Telegram itself. Up to 100 matching videos appear as separate items, each with one playback stream. This searches your account, including Saved Messages, without translating the query or using movie metadata.

### Pinned Tagging — Precise Matching

You can "pin" any Telegram video to a specific IMDB or TMDB catalog item using the `/tag` command (reply to the video in Telegram). Tagged videos are always matched correctly and appear first — even if the filename doesn't match the title.

> [!NOTE]
> **Neither search mode requires selecting channels or folders.** Source selections only control which channels and folders appear as browsing catalogs. Both search modes use the Telegram account connected to your private addon link.

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

**Nuvio does not require HTTPS.** You can use `http://<server-ip>:3000` as your public URL, provided your Nuvio device can reach that address, and skip the [Public Domain & HTTPS](#public-domain--https) section.

Stremio needs a publicly reachable **domain with HTTPS** for addon and stream URLs. Use a public HTTPS URL when installing the addon in Stremio. We recommend [your own domain with Caddy](#recommended-domain--https-with-caddy) for automatic HTTPS. You can also use InstaPods' included HTTPS URL, or [Tailscale Funnel](#alternative-tailscale-funnel) for a provided domain and certificate.

```bash
git clone https://github.com/ohadhaviv92/streamgram.git
cd streamgram
pnpm install --frozen-lockfile
pnpm run start
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

Open `http://<server-ip>:3000/` to use the setup wizard. If StreamGram is behind a reverse proxy, open the wizard through the public HTTPS domain instead.

Add `--env-file .env` to `docker run` when supplying environment variables instead of using the setup wizard.

---

## Public Domain & HTTPS

**Nuvio users can skip this section:** HTTP is supported, so a domain and HTTPS setup are not required.

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

5. **Set StreamGram's public URL.** Open `https://streamgram.example.com` and enter it in the setup wizard, or update **Server settings** for an existing instance. Before first-run setup, you can also use `.env`:

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

Copy the HTTPS URL printed by Funnel into the setup wizard's public URL field (or **Server settings** for an existing instance). Alternatively, set it in `.env` before first-run setup:

```dotenv
PUBLIC_URL=https://streamgram.example-tailnet.ts.net
```

Open that URL to finish setup and install the addon. Keep admin protection enabled, since Funnel makes the app public. See the [Linux installation guide](https://tailscale.com/docs/install/linux) and [Funnel CLI reference](https://tailscale.com/docs/reference/tailscale-cli/funnel) for details.

---

## Server Configuration & Setup

1. **Choose admin protection (optional).** Enabled by default; use a password of at least eight characters, or disable it if you do not need it. Without protection, anyone who can reach the instance can manage it.
2. **Configure the instance.** Enter the server URL (HTTP is supported for Nuvio; Stremio requires HTTPS), Telegram API ID/hash from [my.telegram.org](https://my.telegram.org), and TMDB v4 Read Access Token from [TMDB settings](https://www.themoviedb.org/settings/api). Environment values prefill the wizard; blank secrets preserve saved values.
3. **Connect Telegram.** Authenticate using QR or phone code, including Telegram two-step verification when required.
4. **Install in Stremio or Nuvio.** Use the prominent install button or copy the addon URL: `https://your-domain/{user_token}/manifest.json` for Stremio, or `http://<server-ip>:3000/{user_token}/manifest.json` for Nuvio over HTTP. Folder/channel catalogs are optional; you can install before selecting any.

After initialization, `/` opens the admin dashboard with Overview, Accounts, Invitations, Server settings, Admin settings, and Tutorials. Admins can connect accounts directly or create seven-day, single-use invitations. Copy an invitation when it is created; its secret is not shown again.

Each account has a personal page at `/{user_token}/configure` (the existing `/?action=settings&token=…` link also works). It manages only that account's display name, search language, optional catalogs, reconnection, and deletion. Personal language inherits the instance default unless overridden. English, Hebrew, Russian, Arabic, and Spanish search remain supported; the dashboard supports all five languages, with RTL for Hebrew and Arabic. English is always searched; selecting Hebrew, Russian, Arabic, or Spanish adds searches in that language. The instance search language defaults to English. During first-run setup, the search-language dropdown initially matches the dashboard language.

Set the dashboard language using `?lng=en`, `?lng=he`, `?lng=ru`, `?lng=ar`, or `?lng=es` (for example, `https://yourdomain.com/?lng=he`). For links that already have query parameters, append `&lng=he`. A valid URL language overrides the saved browser preference; otherwise the dashboard uses the saved preference or English. The dashboard language selector updates the URL and saves the preference. Interface language and search language can be changed independently.

Private account links grant access without a separate user password. Protected management uses an eight-hour browser session; legacy `X-Admin-Password` clients remain supported. Existing installations without an admin password stay unprotected until you enable protection in Admin settings. Removing all accounts never reopens public first-run setup.

**Server settings** contains instance credentials, default search language, connection checks, and cache controls. **Admin settings** contains password protection, Telegram notifications/recovery, and backup/restore. Backups contain private Telegram sessions. Restore preserves current admin credentials/protection, replaces accounts/preferences, and invalidates invitations and browser sessions. See [authentication and access documentation](docs/AUTHENTICATION.md) for API details.

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

All values below are optional when using the setup wizard. Saved values in `data/config.json` take precedence over environment defaults. If your deployment uses the old `STREAM_HOST` variable, rename it to `PUBLIC_URL`.

| Variable             | Description                                                                                          |
| -------------------- | ---------------------------------------------------------------------------------------------------- |
| `PUBLIC_URL`         | Server base URL used to create addon and stream links. Nuvio supports HTTP, e.g. `http://<server-ip>:3000`; Stremio requires HTTPS, e.g. `https://yourdomain.com`. |
| `TELEGRAM_API_ID`    | Telegram API ID from [my.telegram.org](https://my.telegram.org).                                     |
| `TELEGRAM_API_HASH`  | Telegram API hash from [my.telegram.org](https://my.telegram.org).                                   |
| `TMDB_BEARER_TOKEN`  | TMDB v4 Read Access Token.                                                                           |
| `PREFERRED_LANGUAGE` | `en`, `he`, `ru`, `ar`, or `es`; defaults to `en`.                                                         |
| `PORT`               | HTTP port; defaults to `3000`.                                                                       |

---

## Optional Admin Features

Admin protection, Telegram notifications, password recovery, and backups are **optional**. Configure them in **Admin settings**; a notification bot is not required for streaming.

- **Password protection:** enabled by default; you can disable it or change the password.
- **Telegram notifications:** add a [BotFather](https://t.me/BotFather) bot token and destination chat ID, choose alerts, save, and click **Send test notification**. The bot needs permission to send messages in that chat.
- **Password recovery:** enable it with notifications. **Forgot password** sends a single-use link to the same chat, valid for **10 minutes**. Recovery requires an HTTPS public URL and works even when routine alerts are disabled. Anyone with access to the chat can use the link.
- **Backup & restore:** download or restore instance backups. Backups contain private Telegram sessions and bot tokens; store them securely.

See [authentication and access documentation](docs/AUTHENTICATION.md) for details.

---

## Contributing

Bug reports, fixes, translations, tests, and documentation improvements are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) for Node.js/pnpm prerequisites, development setup, code conventions, validation commands, and the pull request process.

---

## Disclaimer

> [!WARNING]
> StreamGram is a streaming addon, not a media library. It does not host, upload, or distribute any content. You choose the Telegram sources your account can access and are solely responsible for using this software in compliance with applicable law, copyright permissions, Telegram's Terms of Service, and the terms of your client or provider.

---

## Support the project

Enjoying StreamGram? Give the project a **star on GitHub** to help others discover it, and **join our Discord community** to share feedback, ask questions, and connect with other users.

[![Star on GitHub](https://img.shields.io/badge/GitHub-Star_the_project-E3B341?logo=github&logoColor=white)](https://github.com/ohadhaviv92/streamgram)
[![Join our Discord](https://img.shields.io/badge/Discord-Join_the_community-5865F2?logo=discord&logoColor=white)](https://discord.gg/hZ6YzUWzYK)
