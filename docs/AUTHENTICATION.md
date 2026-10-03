# StreamGram authentication

StreamGram has one Telegram identity per installation. There are no application users, signup records, admin approval states, or bearer tokens for Stremio URLs.

## Browser setup

1. Start the app and open `/`.
2. Enter or confirm the Telegram API credentials and TMDB token with `POST /setup/config`. Safe values from the environment or `data/config.json` are pre-filled; blank secret fields preserve the server-side values.
3. Complete Telegram login with either QR or phone code.

Setup and authentication endpoints are intentionally unauthenticated for now. Protect the wizard and these endpoints with network access controls or a reverse proxy. The Stremio manifest, catalogs, search, and stream routes are tokenless because they all use the one local instance profile.

## Telegram phone-code flow

```text
POST /auth/send-code   { "phone": "+15551234567" }
POST /auth/verify-code { "phone": "+15551234567", "code": "12345", "password": "optional-2fa" }
```

The temporary phone-code hash and temporary session are held in the in-memory cache. After successful verification, the final Telegram session string is written to `data/config.json`.

## Telegram QR flow

```text
POST /auth/qr/generate
GET  /auth/qr/status/:qrToken
```

The browser polls the status endpoint until it receives `authorized`. QR state is temporary and is kept only in the in-memory cache.

## Security

- Use HTTPS for the wizard and all streaming routes.
- Keep `data/` private; it contains API credentials, selected source IDs, and the Telegram session string.
- Do not log or expose session strings, phone-code hashes, or TMDB tokens.
- Setup and authentication endpoints are intentionally unauthenticated for now; use network controls or reverse-proxy authentication for public deployments.
- Environment variables take precedence over values in `data/config.json`.
