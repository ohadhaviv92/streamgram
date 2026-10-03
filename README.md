![TGStreamBridge logo](https://i.ibb.co/393S2Z44/SCR-20260928-synh-out.png)

<p align="center">
  <img src="https://img.shields.io/badge/Node.js-20+-339933?logo=node.js&logoColor=white" alt="Node.js 20+">
  <img src="https://img.shields.io/badge/pnpm-10.11.0-F69220?logo=pnpm&logoColor=white" alt="pnpm 10.11.0">
  <img src="https://img.shields.io/badge/NestJS-10-E0234E?logo=nestjs&logoColor=white" alt="NestJS 10">
  <img src="https://img.shields.io/badge/License-GPLv3-blue" alt="GPLv3 License">
  <img src="https://img.shields.io/badge/Stremio-Addon-8A05BE?logo=stremio&logoColor=white" alt="Stremio Addon">
  <a href="https://t.me/+fqC5RbLhPKw4MTQ8"><img src="https://img.shields.io/badge/Telegram-Community-2CA5E0?logo=telegram&logoColor=white" alt="Telegram Community"></a>
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
- 🔗 Install the bridge using a standard `/manifest.json` addon URL.
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
| **Stream Provider** | You open a movie or episode in Stremio → StreamGram searches your whole Telegram account         | Just a connected Telegram account     |
| **Catalog**         | You browse a catalog tab in Stremio → StreamGram lists videos from selected folders/channels     | At least one source selected in setup |
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

## Server Configuration & Setup

1. **Set the public URL.** Enter the public URL of this bridge. Stremio and many compatible clients require HTTPS for streaming, so use a TLS reverse proxy like Nginx for public deployments.
2. **Create Telegram API credentials** at [my.telegram.org](https://my.telegram.org) and enter the API ID and hash.
3. **Create a TMDB token** in [TMDB API settings](https://www.themoviedb.org/settings/api) and enter the v4 Read Access Token.
4. **Set an Admin Password (Optional).** Secure your setup wizard by configuring an admin password. Once set, it will be required for any future configuration changes.
5. **Choose a Secondary Language.** The addon searches in English by default. If you need results in another language (e.g., Hebrew, Russian, Arabic), select it as your preferred language in the setup wizard.
6. **Authenticate** the Telegram account by QR code or phone code. If Telegram 2FA is enabled, the wizard asks for the password without storing it.
7. **Select sources.** Load and select the Telegram folders, groups, and channels to search, then save the selection. **This step is required** — without at least one source selected, all searches will return zero results and no streams will be available.
8. **Install the addon.** Copy the generated `https://your-domain/{user_token}/manifest.json` URL into Stremio or another compatible client.

The wizard can be reopened later to refresh source selections or change local configuration. If you configured an admin password during setup, you will need it to access these settings again.

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

All values below are optional when using the setup wizard. Environment variables take precedence over values in `data/config.json`.

| Variable             | Description                                                                                    |
| -------------------- | ---------------------------------------------------------------------------------------------- |
| `PUBLIC_URL`         | Public base URL used to create addon and stream links. `STREAM_HOST` is supported as an alias. |
| `TELEGRAM_API_ID`    | Telegram API ID from [my.telegram.org](https://my.telegram.org).                               |
| `TELEGRAM_API_HASH`  | Telegram API hash from [my.telegram.org](https://my.telegram.org).                             |
| `TMDB_BEARER_TOKEN`  | TMDB v4 Read Access Token.                                                                     |
| `PREFERRED_LANGUAGE` | `en`, `he`, `ru`, or `ar`; defaults to `he`.                                                   |
| `PORT`               | HTTP port; defaults to `3000`.                                                                 |

---

## Disclaimer

> [!WARNING]
> StreamGram is a bridge, not a media library. It does not host, upload, or distribute any content. You choose the Telegram sources your account can access and are solely responsible for using this software in compliance with applicable law, copyright permissions, Telegram's Terms of Service, and the terms of your client or provider.

---
