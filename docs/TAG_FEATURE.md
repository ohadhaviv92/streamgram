# Tag Feature Documentation

## Overview

The Tag Feature allows users to annotate video files in Telegram channels with custom, searchable names using catalog IDs (IMDB or TMDB identifiers). This is particularly useful when videos have non-descriptive filenames but users want to easily find them by their actual movie or series identifier.

## How It Works

### User Workflow

1. **Find the video** - Locate the video message in a Telegram channel/group
2. **Reply with tag** - Reply to that video message with: `/tag tt0108778` (IMDB) or `/tag tmdb:550` (TMDB)
3. **Search in Stremio** - When searching for that movie/series in Stremio, the tagged video appears first with a 🏷️ emoji

### Example Scenario

**Problem**: You have "Fight Club (1999)" saved in a Telegram channel, but the filename is "movie_final_v2.mp4"

**Solution**:

1. In Telegram, reply to the video message with: `/tag tt0137523` or `/tag tmdb:550`
2. In Stremio, search for "Fight Club"
3. The tagged video appears at the top of results as: **🏷️ movie_final_v2.mp4 (tt0137523)**

## Interactive Tag Assistant Feature

### Overview

The **Interactive Tag Assistant** is a built-in feature that appears at the end of every search result list in Stremio. When clicked, it automatically sends the appropriate tag command to your Telegram Saved Messages, making it easy to copy and use for tagging videos.

### How It Works

When you search for any movie or TV show in Stremio, the last result in the list will show:

**🏷️ Send Tag to Saved Messages**

Clicking this result will:

1. Automatically send `/tag {catalogId}` to your Telegram Saved Messages
2. Use the exact catalog ID that Stremio is using internally (IMDB or TMDB)
3. Return a simple "OK" response

You can then:

1. Open your Telegram Saved Messages
2. Copy the `/tag` command
3. Reply to any video message with it

### Example: Movie

When searching for "Fight Club" (tt0137523) in Stremio:

**Last result shows:**

```
🏷️ Send Tag to Saved Messages

/tag tt0137523
```

**When clicked**: Sends `/tag tt0137523` to your Telegram Saved Messages

### Example: TV Series Episode

When searching for "Friends S01E01" (tt0108778:1:1) in Stremio:

**Last result shows:**

```
🏷️ Send Tag to Saved Messages

/tag tt0108778:1:1
```

**When clicked**: Sends `/tag tt0108778:1:1` to your Telegram Saved Messages

### Catalog ID Formats

The tag uses the same ID format that Stremio uses internally:

| Type               | Format          | Example              |
| ------------------ | --------------- | -------------------- |
| **IMDB Movie**     | `tt{id}`        | `/tag tt0137523`     |
| **TMDB Movie**     | `tmdb:{id}`     | `/tag tmdb:550`      |
| **IMDB Series Ep** | `tt{id}:s:e`    | `/tag tt0108778:1:1` |
| **TMDB Series Ep** | `tmdb:{id}:s:e` | `/tag tmdb:1668:1:5` |

### Multi-Language Support

The Interactive Tag Assistant label adapts to your configured language:

| Language    | Label                         |
| ----------- | ----------------------------- |
| **English** | 🏷️ Send Tag to Saved Messages |
| **Hebrew**  | 🏷️ שלח תגית להודעות שמורות    |
| **Russian** | 🏷️ Отправить тег в Избранное  |
| **Arabic**  | 🏷️ إرسال العلامة إلى الرسائل  |

### Features

✅ **One-Click Operation** - Click once to send tag command to Telegram  
✅ **Catalog ID Based** - Uses precise IMDB/TMDB identifiers instead of titles  
✅ **Priority Search** - Tagged content appears first when searching  
✅ **Silent Operation** - No UI feedback beyond Telegram's own notification  
✅ **Multi-Language** - Displays in your preferred language  
✅ **Always Present** - Appears at the end of every search result list  
✅ **Future-Ready** - Backend supports custom channel selection (coming soon)

### Technical Implementation

**Location**: [src/utils/stremio.ts](../src/utils/stremio.ts)

**Function**: `createHowToTagStream(userLanguage: string, mediaDetails: MediaDetails, catalogId: string, instanceKey: string)`

**Endpoint**: `GET /tag/:catalogId` in [src/modules/stream/stream.controller.ts](../src/modules/stream/stream.controller.ts)

**Flow**:

1. User clicks the tag stream in Stremio
2. Stremio makes GET request to `/tag/{catalogId}`
3. Backend sends `/tag {catalogId}` to user's Telegram Saved Messages
4. Returns "OK" response

**Stream Properties**:

```typescript
{
  name: "Tg2Stream\n🏷️ Send Tag to Saved Messages",
  title: "/tag tt0108778:1:1",
  url: "https://yourdomain.com/tag/tt0108778%3A1%3A1",
  behaviorHints: { notWebReady: true }
}
```

### Search Priority

Tagged content using catalog IDs receives **highest priority** (score 999) in search results:

1. **Tagged with catalog ID** - Videos tagged with `/tag tt0108778:1:1` appear first
2. **Title-based matches** - Traditional title searches follow
3. **Partial matches** - Fallback results appear last

### Configuration

Tag Assistant uses existing language configuration from `src/config/configuration.ts`:

```typescript
language: {
  languages: {
    en: {
      howToTagLabel: "Send Tag to Saved Messages",
      episodeTerms: { short: ["e"] },
    },
    he: {
      howToTagLabel: "איך לתייג",
      noLocalizedTitleMessage: "אין כותרת בעברית",
      seasonTerms: { short: ["ע"] },
      episodeTerms: { short: ["פ"] },
    },
    // ... other languages
  }
}
```

### Benefits for Users

1. **No Guesswork** - See exact command format for current content
2. **Learn by Example** - Understand how to tag movies vs series
3. **Language Support** - See localized formats when available
4. **Consistency** - Same emoji (🏷️) as actual tagged results
5. **Always Available** - Don't need to remember documentation

### Benefits for the System

1. **Reduced Support Queries** - Users self-serve tagging instructions
2. **Correct Tag Format** - Users see zero-padded episodes (s01e01)
3. **Increased Tag Adoption** - Easy to understand = more users tagging
4. **Multi-Language Promotion** - Encourages tagging in native language

## Tag Command Format

### Catalog IDs (Recommended)

**Best Practice**: Use catalog IDs for precise, language-independent tagging:

```
/tag tt0137523           (IMDB movie)
/tag tmdb:550            (TMDB movie)
/tag tt0108778:1:1       (IMDB series episode)
/tag tmdb:1668:5:10      (TMDB series episode)
```

**Advantages**:

- ✅ Single, precise search query (faster, more efficient)
- ✅ Language-independent (works for all users)
- ✅ Unique identifier (no ambiguity)
- ✅ Shown by Interactive Tag Assistant in Stremio

### Title-Based Tags (Fallback)

Title-based tags work but generate multiple search queries:

**Movies**:

```
/tag Movie Title
/tag Movie Title 2025
/tag טרזן 2024          (Hebrew example)
/tag Avatar: Fire and Ash 2025
```

**TV Series Episodes**:

```
/tag Friends s01e01
/tag Game of Thrones s08e06
/tag חברים ע01פ01        (Hebrew example)
```

### Case Insensitive

All variations work:

- `/tag Tarzan`
- `/Tag Tarzan`
- `/TAG Tarzan`
- `/tAg TaRzAn`

## Technical Implementation

### Search Query Generation

The system uses **different tag search strategies** depending on whether you're using catalog IDs or title-based tags:

**When Catalog ID is Available** (Stremio searches):

- Regular queries: `"Avatar: Fire and Ash"`, `"Avatar: Fire and Ash 2025"`, `"אווטאר: אש ואפר 2025"`
- **Tag query**: `/tag tt0499549` (ONLY the catalog ID, no title-based tags)
  - For series: `/tag tt0108778:1:1` (exact episode)
  - For TMDB: `/tag tmdb:550`
- **Result**: Single precise tag search per content item

**When No Catalog ID** (manual title-based tagging):

- Regular queries: `"Avatar: Fire and Ash"`, `"Avatar: Fire and Ash 2025"`
- **Tag queries**: Multiple variations including:
  - `/tag Avatar: Fire and Ash 2025` (English with year)
  - `/tag אווטאר: אש ואפר 2025` (localized with year)
  - For series: `/tag Friends s01e01`, `/tag חברים ע01פ01`
- **Result**: Multiple tag searches to cover different naming conventions

**Key Difference**: Catalog IDs result in a single, efficient tag search. Title-based tags generate multiple search queries to account for language and format variations.

### Tag Detection Process

1. **Global Search** - Telegram searches for `/tag Movie Name` across all accessible chats
2. **Reply Detection** - System checks if found messages are replies to other messages
3. **Video Validation** - Fetches the original message and verifies it's a video
4. **Result Creation** - Creates search result with:
   - `fileName`: `🏷️ Movie Name` (tag name with emoji)
   - `customName`: `Movie Name` (marks it as tagged)
   - `score`: 999+ (ensures top priority)

### Scoring System

- **Tagged results**: Score 999 (highest priority)
- **Regular results with year match**: Score ~400-700
- **Regular results with quality indicators**: Score 0-300

This ensures tagged videos **always appear first** in search results.

### Code Structure

**Tag Feature Files**:

- `src/modules/telegram/types.ts` - Added `customName?: string` field
- `src/modules/telegram/telegram.service.ts`:
  - `parseTagCommand()` - Extracts tag name from `/tag` messages
  - `fetchRepliedMessage()` - Fetches the original video message
  - `generateSearchQueries()` - Adds catalog ID tag (if available) OR title-based tag
  - `generateEpisodeSearchQueries()` - Adds catalog ID tag (if available) OR title-based tag
  - `performGlobalSearch()` - Processes tag replies and fetches videos
  - `evaluateResultScore()` - Gives tagged results score 999

**Tag Assistant Files**:

- `src/config/configuration.ts` - Added `howToTagLabel` and `noLocalizedTitleMessage` to each language
- `src/utils/stremio.ts`:
  - `createHowToTagStream()` - Generates instructional stream with tag commands
- `src/modules/stream/stream.controller.ts`:
  - Modified `getStream()` - Appends Tag Assistant result to end of streams array

**Test Files**:

- `src/utils/stremio.spec.ts` - Tests for Tag Assistant feature
- `src/modules/telegram/telegram.service.spec.ts` - Tests for tag parsing and scoring

## Advantages

✅ **No Database Required** - Tags are discovered via Telegram search in real-time  
✅ **Catalog ID Efficiency** - Single precise search when using IMDB/TMDB IDs  
✅ **Multi-Language Support** - Works with any language (English, Hebrew, Arabic, Russian, etc.)  
✅ **Instant Priority** - Tagged results always appear first (score 999)  
✅ **Visual Indicator** - 🏷️ emoji clearly shows it's a user-tagged result  
✅ **Flexible Format** - Both catalog IDs and title-based tags supported  
✅ **Global Scope** - All users benefit from tags created by anyone  
✅ **No Setup Required** - Just reply with `/tag` command  
✅ **Built-in Assistant** - Interactive Tag Assistant shows exact catalog ID for every search

## Limitations

⚠️ **Reply Required** - Must reply to the video message (can't just send `/tag` separately)  
⚠️ **Video Files Only** - Only works with video files, not photos or documents  
⚠️ **Search Dependent** - Tags are found via Telegram global search (subject to API limits)  
⚠️ **Catalog IDs Recommended** - Title-based tags generate multiple search queries (less efficient)

## Configuration

The tag feature uses the main search configuration in `src/config/configuration.ts`:

```typescript
search: {
  globalSearchLimit: 150,             // Max results per search query
}
```

No separate configuration needed for the tag feature itself.

## API Response Format

Tagged results appear in the standard search results array:

```json
{
  "imdb_id": "tt0120855",
  "title": "Tarzan",
  "type": "movie",
  "results": [
    {
      "chatId": "-1001234567890",
      "messageId": 12345,
      "fileName": "🏷️ tarzan_movie.mp4 (Tarzan)",
      "customName": "Tarzan",
      "fileSize": 1073741824,
      "mimeType": "video/mp4",
      "score": 999,
      "hasSubtitles": false,
      "isDubbed": true
    },
    {
      "chatId": "-1001234567890",
      "messageId": 67890,
      "fileName": "Tarzan.1999.1080p.mkv",
      "fileSize": 2147483648,
      "mimeType": "video/x-matroska",
      "score": 485
    }
  ]
}
```

## Use Cases

### 1. Generic Filenames

**Problem**: File named "movie.mp4"  
**Solution**: `/tag Avatar 2025`  
**Result**: Found when searching "Avatar"

### 2. Foreign Language Content

**Problem**: Hebrew movie with English filename  
**Solution**: `/tag טרזן 2024`  
**Result**: Found when searching in Hebrew

### 3. Misnamed Files

**Problem**: "Friends_final.mkv" is actually Season 1 Episode 5  
**Solution**: `/tag Friends s01e05`  
**Result**: Found when searching for Friends S01E05

### 4. Split Video Files

**Problem**: Movie split into parts: "part1.mp4", "part2.mp4"  
**Solution**: Tag each part: `/tag Inception Part 1`, `/tag Inception Part 2`  
**Result**: Both parts appear when searching "Inception"

### 5. Compilation Videos

**Problem**: "compilation_2024.mp4" contains multiple episodes  
**Solution**: `/tag Friends S01 Episodes 1-5`  
**Result**: Descriptive name appears in search

## Testing

Automated Tests

Run the test suite to verify tag functionality:

```bash
pnpm test -- stremio.spec.ts          # Tag Assistant tests
pnpm test -- telegram.service.spec.ts  # Tag parsing and scoring tests
```

**Test Coverage**:

- Tag command parsing (case insensitive, multi-language)
- Tag query generation (movies and episodes)
- Tag result scoring (999 priority)
- Tag Assistant stream creation (all languages)
- Episode number padding (s01e01 format)
- Localized title handling
- Edge cases (complex titles, special characters)

### Manual Testing Steps

#### Testing Tag Feature

1. **Tag a video**:

   ```
   In Telegram: Reply to a video with "/tag Test Movie 2025"
   ```

2. **Search for it**:

   ```
   In Stremio: Search for "Test Movie"
   ```

3. **Verify result**:
   - Result appears at top of list
   - Shows: 🏷️ original_filename.mp4 (Test Movie 2025)
   - Score is 999+
   - `customName` field is present in API response

4. **Test multi-language**:

   ```
   /tag טרזן 2024    (Hebrew)
   /tag アバター 2025   (Japanese)
   ```

5. **Test episodes**:
   ```
   /tag Friends s01e01
   ```

#### Testing Tag Assistant

1. **Search for any movie** in Stremio (e.g., "Tarzan")

2. **Scroll to last result** - Should see:

   ```
   🏷️ How to Tag
   /tag Tarzan 1999
   ```

3. **Note**: Tagged video results will display as `🏷️ original_filename.ext (Tag Name)` showing both the original file name and the custom tag

4. **Change user language** to Hebrew in settings

5. **Search again** - Last result should now show:

   ```
   🏷️ איך לתייג
   /tag Tarzan 1999
   /tag טרזן 1999
   ```

6. **Search for TV episode** (e.g., "Friends S01E01")

7. **Verify last result shows**:

   ```
   🏷️ How to Tag
   /tag Friends s01e01
   ```

8. **Test movie without localized title** (non-English user):
   - Should show: `/tag Movie Title 2025` + "אין כותרת בעברית"

9. **Verify stream properties**:
   - `notWebReady` is `true`
   - URL points to documentation
   - Name includes 🏷️ emoji
   - Not playable in Stremiog Friends s01e01

   ```

   ```

### Verification Logs

Check application logs for:

```
"Found tagged video via /tag command"
{
  "tagName": "Test Movie 2025",
  "originalMessageId": 12345,
  "chatId": "-1001234567890"
}
```

## Best Practices

### For Users

1. **Use Catalog IDs** - `/tag tt0137523` or `/tag tmdb:550` (most efficient, recommended)
2. **Copy from Tag Assistant** - Use the Interactive Tag Assistant in Stremio to get the exact catalog ID
3. **For Title-Based Tags**:
   - Include year for movies: `/tag Movie Name 2025`
   - Use standard format for series: `/tag Series s01e01`
   - Be specific: `/tag The Matrix 1999` (better than just "Matrix")
4. **Match Language** - If using title-based tags, tag in the language you search in
5. **Keep It Simple** - Don't add extra info beyond the catalog ID or title

### For Developers

1. **Monitor API Limits** - Tag queries count toward Telegram rate limits
2. **Cache Results** - Tagged results are cached like regular results
3. **Log Tag Activity** - Track tag usage for debugging and analytics
4. **Test Edge Cases** - Non-video messages, deleted messages, private chats

## Troubleshooting

### Tag Not Found

**Possible Causes**:

1. Message was deleted
2. Tag message is not a reply to video
3. Video message is in private chat (not searchable)
4. Telegram search indexing delay (wait a few minutes)

**Solution**: Re-tag the video and wait 5-10 minutes for indexing

### Wrong Video Returned

**Cause**: Multiple videos tagged with same name

**Solution**: Use more specific tags (include year, quality, language)

### Tag Appears for Wrong Movie

**Cause**: Tag name too generic (e.g., just "Avatar")

**Solution**: Include year and distinguishing info: `/tag Avatar: Fire and Ash 2025`

## Future Enhancements

Potential improvements (not currently implemented):

1. **Tag Management** - Web UI to view/edit/delete user's tags
2. **Tag Statistics** - Show most-used tags, tag effectiveness
3. **Tag Suggestions** - Auto-suggest tags based on TMDB metadata
4. **Multi-Tag Support** - Allow multiple tags per video
5. **Tag Export/Import** - Backup and restore tag collections
6. **Tag Collaboration** - Share tag collections between users

## Related Documentation

- [README.md](../README.md) - Main project documentation
- [AUTHENTICATION.md](./AUTHENTICATION.md) - User authentication flow
- [QUICKSTART_AUTH.md](../QUICKSTART_AUTH.md) - Quick setup guide

## Support

For issues or questions:

1. Check logs: `"Found tagged video via /tag command"`
2. Verify tag format: `/tag Movie Name 2025`
3. Confirm message is a reply to a video
4. Wait 5-10 minutes for Telegram indexing
5. Try re-tagging the video

---

**Last Updated**: April 22, 2026  
**Feature Status**: ✅ Fully Implemented  
**API Version**: Compatible with all current endpoints
