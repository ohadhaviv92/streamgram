# StreamGram Agent Instructions

StreamGram is a self-hosted NestJS application that performs global media search across public Telegram channels/groups and streams video files directly from Telegram to Stremio clients.

## Quick Start

### Development Commands

```bash
pnpm run build           # Compile TypeScript
pnpm run start:prod      # Run the compiled application
pnpm run lint            # Run ESLint
pnpm test                # Run Jest tests
```

### Environment Setup

Create a `.env` file or use the first-run web wizard. The wizard can collect all of these values:

- `TELEGRAM_API_ID` & `TELEGRAM_API_HASH` - from https://my.telegram.org
- `TMDB_BEARER_TOKEN` - TMDB v4 API bearer token
- `PUBLIC_URL` or `STREAM_HOST` - Public HTTPS URL for streaming (e.g., `https://yourdomain.com`)
- `PREFERRED_LANGUAGE` - ISO 639-1 code (en, he, ru, ar)

Setup and authentication endpoints are intentionally unauthenticated for now; protect them with deployment-level access controls.

See [README.md](README.md#environment-variables) for full environment variable documentation.

## Architecture

### Tech Stack

- **Framework**: NestJS 10.x with TypeScript 5.6
- **Telegram**: teleproto
- **Media Metadata**: TMDB API
- **Caching**: cache-manager with in-memory store
- **Logging**: Pino
- **Validation**: class-validator + class-transformer

### Module Structure

Standard NestJS pattern: each feature has `*.module.ts`, `*.controller.ts`, `*.service.ts`, and DTOs in `dto/` subdirectories.

**Core Modules:**

- `auth/` - Phone-based authentication with Telegram verification codes
- `stream/` - Search and streaming endpoints (Stremio addon)
- `telegram/` - Single lazy Telegram connection manager
- `tmdb/` - TMDB API integration for metadata
- `user/` - Local instance configuration and compatibility facade
- `cache/` - Global caching service
- `setup/` - First-run configuration and status endpoints
- `health/` - Health check endpoint

### Single-Instance Architecture

**Critical**: Each installation owns one Telegram client managed by `TelegramClientManager`. See [REFACTORING_SUMMARY.md](REFACTORING_SUMMARY.md) for complete details.

- `TelegramClientManager` maintains one lazy client session
- Clients are lazy-initialized on first use
- The client is disconnected during application shutdown
- Streaming services receive the shared client for the local instance

## Key Patterns & Conventions

### Authentication Flow

1. Owner enters Telegram/TMDB settings in `POST /setup/config`.
2. Owner authenticates Telegram with QR or phone code.
3. The resulting session is stored in `data/config.json`; Stremio uses tokenless URLs.

See [docs/AUTHENTICATION.md](docs/AUTHENTICATION.md) for complete flow.

### Request Guards

Stremio endpoints use `@UseGuards(InstanceProfileGuard)` only to attach the local profile:

- Loads the local profile from `data/config.json`
- Injects user into request: `req.user`

Setup and owner settings are intentionally unauthenticated for now; deployment access control is the operator's responsibility.

### Getting User's Telegram Client

```typescript
// In services that need Telegram access:
const client = await this.telegramClientManager.getOrInitializeClient(
  user.token,
  user.session_string,
);
// Then pass client to telegram service methods
const results = await this.telegramService.searchMedia(client, query, media);
```

### DTOs & Validation

- Use class-validator decorators for all input validation
- DTOs in `src/common/dto/` for shared types
- Module-specific DTOs in `src/modules/<module>/dto/`
- Response DTOs documented with Swagger decorators

### Configuration

All config in [src/config/configuration.ts](src/config/configuration.ts) exported as typed object:

```typescript
this.configService.get<string>("server.streamHost");
this.configService.get<number>("cache.defaultTtl");
```

### Language Support

Multi-language search system with ISO 639-1 codes. Config at `configuration.ts` → `language.languages`:

- Each language has season/episode terms, subtitle/dub indicators
- Add new languages by extending `src/config/configuration.ts` (must be valid ISO 639-1 codes)

### Persistence

- No database is required.
- `data/config.json` stores the local configuration, session string, and source selections.
- The cache is in memory and may be discarded on restart.

### Streaming

- Byte-range streaming via `/watch/:chatId/:messageId`
- Implements HTTP 206 Partial Content for seeking
- Chunk size: 1MB (configurable in config)

### Logging

Use Pino logger from [src/logger.ts](src/logger.ts):

```typescript
import { logger } from "../../logger";
logger.info({ context: "value" }, "Message");
logger.error({ err: error }, "Error message");
```

## Common Pitfalls

1. **Use the singleton Telegram client** - Always obtain it via `TelegramClientManager`
2. **HTTPS required for streaming** - Stremio requires HTTPS; set `PUBLIC_URL` to the HTTPS domain
3. **Session strings are sensitive** - Never log or expose `session_string` values
4. **ISO 639 language codes** - Must use valid ISO 639-1 codes for language config
5. **Setup protection** - Keep the `data/` directory private and protect setup endpoints at the deployment layer
6. **No Stremio token** - Addons are installed from `/manifest.json` on the private instance

## Testing

- Jest configured with ts-jest
- Tests in `*.spec.ts` files alongside source
- Coverage reports in `coverage/` directory
- Example test: [src/modules/tmdb/tmdb.service.spec.ts](src/modules/tmdb/tmdb.service.spec.ts)

## API Documentation

Swagger UI available at `/api` endpoint when server running:

- Complete API documentation with request/response schemas
- Try-it-out functionality for all endpoints
- Generated from NestJS decorators (@ApiTags, @ApiOperation, etc.)

## Related Documentation

- [README.md](README.md) - Complete project overview and setup guide
- [REFACTORING_SUMMARY.md](REFACTORING_SUMMARY.md) - Single-instance architecture details
- [docs/AUTHENTICATION.md](docs/AUTHENTICATION.md) - Authentication flow documentation
- [QUICKSTART_AUTH.md](QUICKSTART_AUTH.md) - Quick authentication setup guide
