# Management redesign verification

Verified locally on 2026-10-05, with invitation migration checks added on 2026-10-06, without modifying the installation's saved accounts or configuration.

## Automated checks

- `pnpm run build`: passes.
- `pnpm test --runInBand`: 177 tests across eight suites pass.
- `pnpm run lint`: passes with zero errors and 93 warnings (primarily existing explicit `any` annotations). The command now includes all nested TypeScript files; `@eslint/js` is installed explicitly.
- Browser module syntax checks and `git diff --check`: pass.

The new tests cover protected/unprotected management, initialization before credential access, legacy password migration, salted password preservation, cookie flags, eight-hour session expiry, logout, same-origin enforcement, explicit personal tokens, independent preferences, identity-safe reconnect, deletion and in-flight client cancellation, invitation expiry/revocation/reuse/concurrent consumption, authentication failure/2FA retry, file-write rollback, backup validation/restore, and session/invitation invalidation.

Stremio compatibility checks include token-prefixed manifest/configure links, installation without catalogs, episode route parameters, and an HTTP 206 byte-range response to a cross-origin request.

Invitation migration regression tests cover legacy maps, ISO timestamps, preserved used/revoked/expired states, creation and single-use completion after migration, restart persistence, and rejection of corrupt records without overwriting the source. An isolated copy of the installation's configuration also migrated successfully: all four invitations (two revoked, two used) and all other configuration fields were preserved.

## Browser and visual review

An isolated Nest application used mock Telegram responses and temporary configuration directories. Reviewed:

- Desktop admin dashboard and first-run protection screen.
- Personal installation page, catalog disclosure, selection refresh/save, and profile renaming.
- Literal rendering of hostile profile/channel names containing HTML.
- QR generation dialog, keyboard Escape, and visible keyboard focus.
- Invitation creation, phone-code completion to an existing personal account, and the used-invitation explanation.
- Hebrew RTL at 390px and 320px; no horizontal overflow at 320px.

The 2026-10-06 interface follow-up was also checked on desktop and at 390px in Hebrew: the supplied logo and favicon, corrected brand line, clickable account rows with independent copy/delete controls, removal of revoked invitations from the list, the channel/folder catalog label, and masked credential suffixes with contextual help links. Saving blank credential fields preserves the previews. Previews show the last three characters and replace each preceding character with `*`, including the API ID, which uses a text field. Telegram preview lengths match the saved values; TMDB uses at most 70 `*` characters to keep its preview short. Browser console errors: none.

Text API IDs are accepted and normalized for Telegram; blank values preserve the saved ID, and invalid or masked values are rejected. The browser check confirmed that all three suffix previews remain correct after saving blank fields and reloading.

Measured contrast ratios: body text 17.03:1; muted text 7.70:1; primary-button text 5.17:1; input borders 4.70:1; focus ring against the primary button 3.48:1; success badges 7.61:1. Controls use at least 44px targets; checkbox labels have at least 48px targets. CSS respects reduced-motion preferences.

## External integration boundary

Telegram and media bytes were mocked for deterministic verification. No real phone code was sent, no real Telegram QR login was performed, and no external Stremio client was launched. A deployment smoke test with a real Telegram identity remains appropriate for confirming live Telegram delivery/2FA and playback on the operator's Stremio device.

## International phone authentication follow-up

Verified phone entry with country codes for the US, UK, India, Israel, Brazil, and Japan, including spaces, parentheses, hyphens, and the `00` prefix. Invalid local/letter-containing numbers are rejected without guessing a country. Phone DTO normalization is shared by code sending and verification.

The browser preview confirmed that the password field stays hidden until Telegram requests it, an incorrect password keeps the same attempt retryable, and a corrected password completes authentication. Adapter tests confirm password retries invoke `GetPassword`/`CheckPassword` without resubmitting the accepted code, and preserve the temporary session. All Telegram calls used mocks; no live code or password was sent.
