# Contributing to StreamGram

Thanks for helping improve StreamGram! Bug fixes, reproducible reports, documentation, translations, tests, and improvements to search, playback, and the dashboard are welcome.

## Before you start

- Check existing [issues](https://github.com/ohadhaviv92/streamgram/issues) and [pull requests](https://github.com/ohadhaviv92/streamgram/pulls) to avoid duplicate work.
- For a substantial feature or architectural change, open an issue to discuss the use case and approach first. Small fixes can go directly to a pull request.
- Keep discussions respectful and changes focused enough to review.
- For setup help and general questions, see the [README](README.md) or join the [Discord community](https://discord.gg/hZ6YzUWzYK).

## Development setup

### Prerequisites

- Node.js 20 or later.
- pnpm 10.11.0, as specified in `package.json` and the Dockerfile.
- Your own Telegram API ID/hash and TMDB Read Access Token for live integration checks. Automated tests should use mocks instead of real accounts.

If pnpm is not installed, install the pinned version:

```bash
npm install --global pnpm@10.11.0
```

Fork the repository on GitHub, then clone your fork and create a branch:

```bash
git clone https://github.com/YOUR_USERNAME/streamgram.git
cd streamgram
git switch -c fix/describe-your-change
pnpm install --frozen-lockfile
pnpm run build
pnpm run start:prod
```

The Docker build installs dependencies with `--ignore-scripts`; you can use `pnpm install --frozen-lockfile --ignore-scripts` to match that installation step.

Open `http://localhost:3000/` and use the first-run wizard to configure admin protection, the public URL, Telegram credentials, and TMDB token. An `.env` file is optional: copy `.env.example` to `.env` if you prefer supplying environment defaults. Saved configuration takes precedence over those defaults. See [environment variables](README.md#environment-variables) and [server setup](README.md#server-configuration--setup).

The instance persists configuration, account sessions, and preferences in `data/config.json`; no external database or Redis service is required. Use a separate checkout/data directory for development so authentication, deletion, and restore checks cannot affect a live instance.

After changing backend code, stop the server, rebuild with `pnpm run build`, and restart with `pnpm run start:prod`. Swagger documentation is served at `/api`.

For end-to-end playback, use a URL reachable by your player. Stremio requires a public HTTPS domain; Nuvio supports HTTP. Install using the account-specific `/:userToken/manifest.json` link shown by the dashboard. The README covers [Docker](README.md#docker) and [domain/HTTPS setup](README.md#public-domain--https).

## Code map

| Location | Responsibility |
| --- | --- |
| `src/main.ts`, `src/app.module.ts` | Startup, validation, security headers, Swagger, and module composition. |
| `src/config/configuration.ts` | Configuration defaults and search-language definitions. |
| `src/modules/setup/` | First-run initialization, configuration, and connection checks. |
| `src/modules/management/` | Admin access, accounts, invitations, and password recovery. |
| `src/modules/auth/` | Scoped Telegram phone/code and QR authentication. |
| `src/modules/user/` | File-backed instance/account configuration and preferences. |
| `src/modules/telegram/` | Managed Telegram clients, media search, and downloads. |
| `src/modules/stream/` | Addon manifests, catalogs, metadata, and byte-range playback. |
| `src/modules/tmdb/`, `src/modules/wikidata/` | Media metadata and title resolution. |
| `src/modules/cache/`, `src/modules/health/`, `src/modules/notifications/` | Caching, health, and optional Telegram notifications. |
| `src/common/`, `src/utils/` | Guards, validation, middleware, DTOs, and shared utilities. |
| `public/` | Dashboard HTML, CSS, JavaScript, translations, and player-facing assets. |
| `tests/dashboard.test.cjs` | Dashboard tests using Node's built-in test runner. |

## Implementation guidelines

- Follow the existing NestJS module, service, controller, and dependency injection patterns. Validate request DTOs and update Swagger descriptions when API behavior changes.
- Obtain persistent Telegram clients through `TelegramClientManager`, which owns the account-keyed client pool. Preserve retain/release and cancellation handling for downloads and operations spanning multiple requests.
- Preserve account isolation: personal APIs require an explicit account token and must not fall back to another account. Keep account-scoped sessions, source selections, and caches separate.
- Preserve admin/personal guard boundaries, same-origin checks on management mutations, and first-run initialization protections. See [authentication and access](docs/AUTHENTICATION.md).
- Preserve HTTP range responses and resource cleanup when changing playback. Check seeking, disconnects, and recovery from download errors where relevant.
- Use the existing configuration services and Pino logger. Avoid logging credentials, account links, or Telegram session strings.
- Include related lockfile changes when updating dependencies. Keep generated build output, runtime data, and unrelated formatting out of pull requests.
- Update documentation and `.env.example` when setup or configuration changes.

### Languages and interface changes

Search-language definitions live under `language.languages` in `src/config/configuration.ts`; dashboard localization lives in `public/js/`. When adding a language, use a valid ISO 639-1 key, provide the fields used by existing entries, and test representative titles and season/episode patterns. Keep search-language selection distinct from dashboard-language selection.

For interface changes, check narrow screens, keyboard access, visible focus, and Hebrew/Arabic right-to-left layouts as applicable. Include screenshots and describe the languages and viewport sizes checked. For tag-assistant media, follow [the asset instructions](public/assets/tag-assistant/README.md).

## Validation

Run the following before opening a pull request:

```bash
pnpm run build
pnpm run lint
pnpm test --runInBand
pnpm run test:dashboard
git diff --check
```

Jest tests live alongside TypeScript source in `*.spec.ts` files. The dashboard suite is separate from Jest. To run a focused suite or collect coverage:

```bash
pnpm test --runInBand src/modules/tmdb/tmdb.service.spec.ts
pnpm test --runInBand --coverage
```

Add regression tests for bug fixes and meaningful coverage for new behavior. Mock Telegram, TMDB, and notification delivery; use temporary directories for tests that write configuration. Automated tests must not send real messages, authenticate real users, or overwrite a developer's saved accounts.

For relevant integration changes, describe manual checks such as initialization, protected admin access, invitation acceptance, Telegram reconnection, account isolation, saving settings, and playback/seek behavior. Use only content you have permission to access and share. Passing mocked tests does not establish that live Telegram or player integration works.

If a check fails on the unchanged base branch too, report the command and a sanitized failure summary in the pull request. Distinguish existing failures from regressions introduced by the change.

## Issues and security reports

For a bug report, include the commit/version, deployment method, Node.js/pnpm versions, player/device where relevant, steps to reproduce, expected/actual behavior, and sanitized logs or screenshots. For search issues, include a non-sensitive example query, language, and media ID or season/episode if applicable.

For a feature request, explain the user problem, current workaround, and desired outcome.

Do not commit or publish `.env`, `data/`, instance backups, private addon/configuration URLs, account or invitation tokens, password-reset links, Telegram sessions, bot tokens, API hashes, login codes, passwords, or private account/channel details. Remove secrets from logs, screenshots, and reproduction examples.

For a suspected vulnerability, use GitHub's private vulnerability reporting option if the repository offers it. Otherwise, ask a maintainer for a private reporting channel before publishing exploit details.

## Pull requests

Commit the relevant files with a clear message and push your branch to your fork:

```bash
git add path/to/changed-file
git commit -m "Describe the change"
git push -u origin fix/describe-your-change
```

Open a pull request against `main` in `ohadhaviv92/streamgram`. Include:

- The problem, resulting behavior, and linked issue if applicable.
- Commands run and their results, plus any manual checks and their limits.
- Screenshots for visible changes.
- New configuration, compatibility changes, or upgrade steps.

Draft pull requests are welcome for work in progress. Respond to review feedback and keep the change focused. Do not assume a reviewer has read the issue discussion or your development notes.

## License

StreamGram is distributed under the GNU General Public License v3; see [LICENSE](LICENSE). Contributions should be compatible with the project license. Preserve existing notices and identify the origin and license of any third-party code or assets you add.
