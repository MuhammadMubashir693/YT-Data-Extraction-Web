# Backend API Documentation

This document describes the backend JSON API for the YT Pool Web app.
The API is exposed under `/api` by `backend/server.js` and uses the YouTube
Data API v3 plus a MongoDB-backed store for saved channels/videos/playlists/comments.

An interactive, always-up-to-date version of this document (generated from
the same source) is also served at `/api-docs` on any running backend
instance (e.g. `http://localhost:5000/api-docs` locally).

## Base URL

- Local development: `http://localhost:5000/api`
- Docker (via `docker compose up`): `http://localhost:5000/api` directly, or
  `http://localhost:8080/api` through the frontend's nginx proxy.
- Production: the live backend is deployed on Render; the live frontend
  (https://yt-data-extraction-web.vercel.app/) reaches it through a rewrite
  rule in `frontend/vercel.json`, not directly.

## Authentication

- The backend reads `YT_API_KEY` from `backend/.env`.
- Clients do not send the YouTube API key directly; all calls are proxied through the backend.
- Saved-item endpoints (channels/videos/playlists/comments) require a working MongoDB connection (`MONGO_URI`, or the individual `MONGO_USER`/`MONGO_PASS`/`MONGO_HOST`/`MONGO_PORT` variables). No auth is required to call them.

## Global query formats

- `startDate` and `endDate`: `YYYY-MM-DD`
- `pageToken`: pagination token. For most endpoints this is YouTube's own opaque token, echoed back in the response (`nextPageToken`/`prevPageToken`). For `/api/playlist`, it's a numeric offset string instead (see that endpoint).
- `durationFilter`: one of `short`, `medium`, `long`
- `matchMode`: one of `every` (AND — all provided per-field keywords must match) or `some` (OR — any one is enough); defaults to `every`-style "all provided fields must match" behavior when omitted
- `sort`: endpoint-specific values documented per endpoint below

## Errors

Errors are returned as `{ "error": "<message>" }` with an appropriate HTTP status. Common cases across most endpoints:

- `400 Bad Request` — missing/unparseable required input (e.g. an ID/URL that couldn't be parsed).
- `403 Forbidden` — either the YouTube API quota has been exceeded, or (for comment endpoints) the video has comments disabled.
- `404 Not Found` — the requested video/channel/comment genuinely doesn't exist.
- `409 Conflict` — (saved-item endpoints only) an ID conflict on create/update.
- `500 Internal Server Error` — anything else (surfaces the underlying YouTube/Mongo error message where available).

Note: a channel with no uploads, or a playlist with no videos, is **not**
treated as an error — see `/api/channel-latest-videos` and `/api/playlist`
below, both of which return `200 OK` with an empty list and a friendly
`message` field instead.

---

## Health

### GET `/api/health`

Description: Verify the backend is running and whether the YouTube API key is configured.

Response:

- `200 OK`
- JSON body:
  - `ok`: `true`
  - `apiKeySet`: `true` if `YT_API_KEY` is set, otherwise `false`

Example:

```json
{
  "ok": true,
  "apiKeySet": true
}
```

---

## Image Proxy

### GET `/api/proxy-image`

Description: Fetch an image from a remote URL and stream it back through the backend, to avoid browser CORS/mixed-content issues when loading YouTube thumbnails, avatars, or banners directly.

Query parameters:

- `url` (required): remote image URL to proxy.

Errors:

- `400 Bad Request`: missing `url`.
- `502 Bad Gateway`: remote image fetch failed.

---

## Saved Channels (MongoDB)

### GET `/api/channels`

Description: Return all saved channels from MongoDB.

Response: `200 OK`, JSON array of `{ name, id }` objects.

```json
[
  { "name": "CrashCourse", "id": "UCX6b17PVsYBQ0ip5gyeme-Q" },
  { "name": "Veritasium", "id": "UCHnyfMqiRRG1u-2MsSQLbXA" }
]
```

### POST `/api/channels`

Description: Add a saved channel.

Request body: `{ "name": string, "id": string }` (both required)

Responses:

- `201 Created` — the created object
- `400 Bad Request` — missing `name` or `id`
- `409 Conflict` — a channel with that `id` already exists

### PUT `/api/channels/:currentId`

Description: Update a saved channel's name and/or id.

Path parameter: `currentId` — the channel's current saved `id`.

Request body: `{ "name": string, "id": string }` (both required — `id` is the new id to save, which may be unchanged)

Responses:

- `200 OK` — the updated object
- `404 Not Found` — no saved channel with `currentId`
- `409 Conflict` — another saved channel already uses the new `id`

### DELETE `/api/channels/:id`

Description: Delete a saved channel.

Responses:

- `200 OK`
- `404 Not Found`

---

## Saved Videos (MongoDB)

Same shape and semantics as Saved Channels, under `/api/videos`:

- `GET /api/videos`
- `POST /api/videos` — body `{ name, id }`
- `PUT /api/videos/:currentId` — body `{ name, id }`
- `DELETE /api/videos/:id`

---

## Saved Playlists (MongoDB)

Same shape and semantics as Saved Channels, under `/api/playlists`:

- `GET /api/playlists`
- `POST /api/playlists` — body `{ name, id }`
- `PUT /api/playlists/:currentId` — body `{ name, id }`
- `DELETE /api/playlists/:id`

---

## Saved Comments (MongoDB)

Same shape and semantics as Saved Channels, under `/api/saved-comments`
(intentionally *not* `/api/comments` — that path is the comment-threads
lookup endpoint documented below):

- `GET /api/saved-comments`
- `POST /api/saved-comments` — body `{ name, id }`
- `PUT /api/saved-comments/:currentId` — body `{ name, id }`
- `DELETE /api/saved-comments/:id`

---

## Video object shape

Every endpoint that returns video data (`/api/video`, `/api/channel-videos`,
`/api/channel-latest-videos`, `/api/playlist`, `/api/search-videos`) uses
this same shape:

```json
{
  "videoId": "dQw4w9WgXcQ",
  "videoUrl": "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
  "title": "string",
  "channelId": "UCxxxxxxxx",
  "channelTitle": "string",
  "uploadDate": "formatted date string",
  "duration": "formatted duration (e.g. 12:34) or N/A",
  "durationSeconds": 754,
  "likes": "number or N/A",
  "views": "number or N/A",
  "comments": "number or N/A",
  "thumbnail": "url",
  "description": "string",
  "tags": ["string", "..."],
  "defaultLanguage": "string or N/A",
  "defaultAudioLanguage": "string or N/A",
  "categoryId": "string or null",
  "regionRestriction": "object or null",
  "publishedAtRaw": "ISO 8601 timestamp",
  "scheduledStartTime": "formatted date or null",
  "actualStartTime": "formatted date or null",
  "actualEndTime": "formatted date or null",
  "liveBroadcastContent": "none | upcoming | live"
}
```

`/api/video` additionally includes `channelThumbnail` (the uploading
channel's avatar URL, `null` if it couldn't be resolved) — this extra
lookup is only done for the single-video endpoint, not for list endpoints,
to avoid an extra API call per item in a list.

---

## GET `/api/video`

Description: Fetch full details for a single video.

Query parameters:

- `q` (required) — video ID or any supported YouTube video URL format.

Responses:

- `200 OK` — the video object (see shape above), plus `channelThumbnail`
- `400 Bad Request` — could not parse a valid video ID from `q`
- `404 Not Found` — no video found with that ID

---

## GET `/api/channel-videos`

Description: Search/filter videos within a specific channel. Uses YouTube's search API under the hood, then filters and sorts server-side.

Query parameters:

- `channelId` (required)
- `mode` — `keyword` or `date`. In `keyword` mode, the query is applied both at the YouTube API level (`q=`) and again server-side after fetching full details. In `date` mode, only the date range is applied.
- `keyword` — combined keyword matched against title, description, and channel title
- `keywordTitle`, `keywordDescription`, `keywordChannel` — per-field keywords; if any of these are set, per-field matching is used instead of the combined `keyword`
- `startDate`, `endDate` — `YYYY-MM-DD`
- `durationFilter` — `short` | `medium` | `long`
- `matchMode` — `every` | `some` (applies to per-field keyword matching)
- `maxResults` — integer, 1–500 (default 50)
- `sort` — one of `date-asc`/`date-desc`, `viewcount-asc`/`viewcount-desc`, `rating-asc`/`rating-desc`, `title-asc`/`title-desc`, `duration-asc`/`duration-desc` (default: unsorted/relevance order)

Response: `200 OK`

```json
{ "videos": [ /* video objects */ ], "count": 12 }
```

---

## GET `/api/channel-latest-videos`

Description: Fetch a channel's most recent uploads via its uploads playlist — cheaper on API quota than `/api/channel-videos`, and paginated using YouTube's own tokens.

Query parameters:

- `channelId` (required)
- `count` (required) — integer, 1–50, videos per page
- `pageToken` — optional, from a previous response's `nextPageToken`/`prevPageToken`

Response: `200 OK`

```json
{
  "videos": [ /* video objects, newest first */ ],
  "count": 10,
  "uploadsPlaylistId": "UUxxxxxxxx",
  "nextPageToken": "string or null",
  "prevPageToken": "string or null"
}
```

If the channel has zero uploads, `videos` is `[]`, `count` is `0`, and the
response includes `"message": "This channel has no uploads."` — this is a
`200 OK`, not an error, even though YouTube's own API reports this
internally as a "not found" condition.

Errors:

- `400 Bad Request` — missing `channelId`, or `count` outside 1–50
- `404 Not Found` — the channel itself has no uploads playlist at all (distinct from having zero videos in it)

---

## GET `/api/channel`

Description: Fetch channel details.

Query parameters:

- `q` (required) — channel ID, URL, `@handle`, or bare handle.

Response: `200 OK`

```json
{
  "channelId": "UCxxxxxxxx",
  "title": "string",
  "description": "string",
  "createdAt": "formatted date",
  "customUrl": "string or N/A",
  "country": "string or N/A",
  "thumbnail": "url or null",
  "banner": "url or null (highest resolution available)",
  "videoCount": "number or N/A",
  "subscriberCount": "number or N/A",
  "viewCount": "number or N/A",
  "uploadsPlaylistId": "UUxxxxxxxx or null",
  "trailerVideo": "video object (see shape above), or null if the channel has no unsubscribed trailer set"
}
```

Notes:

- `banner` is resolved to the highest resolution Google's image CDN will
  serve for that asset (see `helpers.js`'s `highResBannerUrl`), not the
  smaller default YouTube returns.
- `country` should be treated as possibly absent — the frontend hides the
  "Country" field entirely rather than displaying a placeholder when this
  is not available.
- This endpoint does **not** fetch the channel's playlists — use
  `/api/channel-playlists` separately for that (see below), since walking
  a channel's full playlist list can require many sequential API calls.

Errors:

- `400 Bad Request` — could not resolve a valid channel ID from `q`
- `404 Not Found` — no channel found

---

## GET `/api/channel-playlists`

Description: Fetch all of a channel's public playlists, including a
synthetic `"Uploads"` entry representing the channel's full uploads
playlist (YouTube's `playlists.list` never returns this one on its own,
since it's an auto-generated system playlist rather than a user-created
one).

Query parameters:

- `channelId` (required) — must match a valid `UC...` channel ID format.

Response: `200 OK`

```json
{
  "channelId": "UCxxxxxxxx",
  "playlists": [
    {
      "playlistId": "string",
      "playlistUrl": "https://www.youtube.com/playlist?list=...",
      "title": "string",
      "channelId": "string",
      "publishedAt": "formatted date",
      "publishedAtRaw": "ISO 8601 timestamp or null",
      "videoCount": "number or N/A",
      "videoCountRaw": "number or null",
      "thumbnail": "url or null"
    }
  ]
}
```

Errors:

- `400 Bad Request` — `channelId` missing or not a valid `UC...` ID
- `404 Not Found` — no channel found

---

## GET `/api/comment`

Description: Fetch a single comment by ID.

Query parameters:

- `q` (required) — a bare comment ID, or a YouTube URL containing an `lc=` parameter.

Response: `200 OK`

```json
{
  "commentId": "string",
  "authorName": "string",
  "authorChannelId": "string or N/A",
  "authorProfileImageUrl": "url or null",
  "textDisplay": "string",
  "textOriginal": "string",
  "likeCount": 0,
  "publishedAt": "formatted date",
  "updatedAt": "formatted date",
  "videoId": "string or null"
}
```

Note on `videoId`: YouTube's API only reliably includes `videoId` in the
snippet for **top-level** comments — it's typically omitted for replies.
If the comment being looked up is a reply, this endpoint falls back to
parsing a video ID out of the input `q` itself (useful if you passed a
full URL containing both `v=` and `lc=`); otherwise it will be `null`,
and in-comment timestamp links won't be resolvable client-side.

Errors:

- `400 Bad Request` — could not parse a valid comment ID from `q`
- `404 Not Found` — no comment found

---

## GET `/api/comments`

Description: Fetch comment threads (with their first page of replies, if any) for a video.

Query parameters:

- `q` (required) — video ID or URL
- `sort` — `top` (default) | `latest` | `earliest` | `likes-desc` | `likes-asc`
- `keyword` — filters threads (matched against both the top-level comment's and its replies' text)
- `startDate`, `endDate` — `YYYY-MM-DD`, filters by the top-level comment's publish date
- `pageToken` — YouTube pagination token
- `maxResults` — integer, 1–50 (default 20)

Response: `200 OK`

```json
{
  "videoId": "string",
  "commentCount": "number or null (total comment count on the video, if resolvable)",
  "hasMore": true,
  "nextPageToken": "string or null",
  "sort": "top",
  "threads": [
    {
      "commentId": "string",
      "authorName": "string",
      "authorChannelId": "string or N/A",
      "authorChannelUrl": "url or null",
      "authorProfileImageUrl": "url or null",
      "likeCount": 0,
      "publishedAt": "formatted date",
      "updatedAt": "formatted date",
      "textDisplay": "string",
      "textOriginal": "string",
      "replyCount": 0,
      "replies": [ /* same shape as a thread's own comment fields, plus videoId */ ],
      "publishedAtRaw": "ISO 8601 timestamp",
      "videoId": "string"
    }
  ]
}
```

Notes:

- `replies` here is only the batch of replies YouTube includes inline with
  the thread response (typically the first handful) — use
  `/api/comment-replies` to page through the rest.
- Every thread and reply object here has `videoId` populated directly
  (unlike `/api/comment`), since the endpoint already knows which video
  was queried.

Errors:

- `400 Bad Request` — could not parse a valid video ID from `q`
- `403 Forbidden` — comments are disabled for this video
- `404 Not Found` — video not found

---

## GET `/api/comment-replies`

Description: Fetch (paginated) replies for a top-level comment.

Query parameters:

- `parentId` (required) — the top-level comment's ID
- `videoId` — optional but recommended. YouTube's API doesn't reliably
  include `videoId` on individual reply objects, so passing the parent
  thread's already-known `videoId` here lets replies fetched through this
  endpoint keep working in-comment timestamp links.
- `pageToken` — YouTube pagination token
- `maxResults` — integer, 1–50 (default 20)

Response: `200 OK`

```json
{
  "parentId": "string",
  "replies": [
    {
      "commentId": "string",
      "authorName": "string",
      "authorChannelId": "string or N/A",
      "authorChannelUrl": "url or null",
      "authorProfileImageUrl": "url or null",
      "likeCount": 0,
      "publishedAt": "formatted date",
      "updatedAt": "formatted date",
      "textDisplay": "string",
      "textOriginal": "string",
      "publishedAtRaw": "ISO 8601 timestamp",
      "videoId": "string or null"
    }
  ],
  "hasMore": true,
  "nextPageToken": "string or null",
  "totalResults": "number or null"
}
```

Errors:

- `400 Bad Request` — missing `parentId`

---

## GET `/api/playlist`

Description: Fetch playlist metadata and its videos, paginated server-side
over an already-fully-fetched (and cached) copy of the playlist.

Query parameters:

- `q` (required) — playlist ID or URL containing `list=`
- `sort` — same options as `/api/channel-videos` (default: `date-asc`)
- `maxResults` — integer, 1–500 (default 50) — page size
- `pageToken` — a numeric string offset (**not** a YouTube token) from a previous response's `nextPageToken`

Response: `200 OK`

```json
{
  "playlistInfo": {
    "playlistId": "string",
    "title": "string",
    "channelId": "string",
    "channelTitle": "string",
    "publishedAt": "formatted date",
    "description": "string",
    "thumbnail": "url or null"
  },
  "videos": [ /* video objects, current page */ ],
  "count": 137,
  "nextPageToken": "string or null"
}
```

Special "system" playlists (a channel's uploads = `UU...`, liked videos =
`LL...`, legacy favorites = `FL...`, watch later = `WL...`) aren't returned
by `playlists.list` even by ID — `playlistInfo` is instead derived from a
channel lookup in that case (the playlist ID prefix encodes the owning
channel's ID).

If the playlist has zero videos, `videos` is `[]`, `count` is `0`,
`playlistInfo` is still populated where resolvable, and the response
includes `"message": "This playlist is empty."` — this is a `200 OK`, not
an error, even though YouTube's API reports an empty "uploads" playlist
internally as "not found."

Errors:

- `400 Bad Request` — could not parse a valid playlist ID from `q`

---

## GET `/api/search-videos`

Description: General video search across all of YouTube (not scoped to a channel).

Query parameters: same as `/api/channel-videos`, minus `channelId` and `mode` (search mode is implied by whichever keyword/date/duration params are given).

- `keyword`, `keywordTitle`, `keywordDescription`, `keywordChannel`
- `startDate`, `endDate`
- `durationFilter` — `short` | `medium` | `long`
- `matchMode` — `every` | `some`
- `maxResults` — integer, 1–500 (default 50)
- `sort` — same options as `/api/channel-videos`

At least one of `keyword`/per-field keyword, a date range, or `durationFilter` must be provided.

Response: `200 OK`

```json
{ "videos": [ /* video objects */ ], "count": 12 }
```

Errors:

- `400 Bad Request` — no keyword, date range, or duration filter provided

---

## GET `/api/search-channels`

Description: Search YouTube channels by name (channel description is not matched).

Query parameters:

- `keyword` (required)
- `maxResults` — integer, 1–500 (default 50)
- `pageToken` — YouTube pagination token (only meaningful when `maxResults` fits within a single YouTube page; larger requests aggregate multiple pages internally and don't expose per-page navigation)

Response: `200 OK`

```json
{
  "channels": [
    {
      "channelId": "string",
      "channelUrl": "url",
      "title": "string",
      "description": "string",
      "country": "string or N/A",
      "publishedAt": "formatted date or N/A",
      "subscribers": "number or N/A",
      "videoCount": "number or N/A",
      "viewCount": "number or N/A",
      "thumbnail": "url or null"
    }
  ],
  "count": 20,
  "nextPageToken": "string or null",
  "prevPageToken": "string or null"
}
```

Errors:

- `400 Bad Request` — missing `keyword`

---

## GET `/api/search-playlists`

Description: Search YouTube playlists by keyword (matched against playlist title and/or channel title).

Query parameters:

- `keyword` — combined keyword matched against playlist title and channel title
- `keywordTitle`, `keywordChannel` — per-field keywords; if either is set, per-field matching is used instead of `keyword`
- `maxResults` — integer, 1–500 (default 50)

At least one of `keyword`, `keywordTitle`, or `keywordChannel` is required.

Response: `200 OK`

```json
{
  "playlists": [
    {
      "playlistId": "string",
      "playlistUrl": "url",
      "title": "string",
      "channelId": "string or N/A",
      "channelTitle": "string or N/A",
      "publishedAt": "formatted date or N/A",
      "videoCount": "number or N/A",
      "thumbnail": "url or null"
    }
  ],
  "count": 15
}
```

Errors:

- `400 Bad Request` — no keyword provided

---

## GET `/api/all-comments`

Description: Fetch one page of top-level comment threads for a video, using YouTube's `commentThreads.list` with `order=time` (latest-first). This endpoint is used by the **Comment Picker** tab to paginate through a video's comments without fetching them all at once. The client stores page tokens in memory to enable both forward and backward navigation.

Query parameters:

- `q` (required) – video ID or URL.
- `pageToken` – optional YouTube pagination token (from a previous response's `nextPageToken`). If omitted, returns the first page.

Response: `200 OK`

```json
{
  "videoId": "string",
  "commentCount": "number or null (if resolvable from video statistics)",
  "threads": [
    {
      // Each thread is the same shape as in `/api/comments`
      "commentId": "string",
      "authorName": "string",
      "authorChannelId": "string or N/A",
      "authorChannelUrl": "url or null",
      "authorProfileImageUrl": "url or null",
      "likeCount": 0,
      "publishedAt": "formatted date",
      "updatedAt": "formatted date",
      "textDisplay": "string",
      "textOriginal": "string",
      "replyCount": 0,
      "replies": [ /* reply objects (first page only) */ ],
      "publishedAtRaw": "ISO 8601 timestamp",
      "videoId": "string"
    }
  ],
  "nextPageToken": "string or null",
  "prevPageToken": "string or null"   // always null from YouTube, but included for consistency
}
```
---

## Caching notes

Most read endpoints are backed by short-lived in-memory server-side caches
(per resource type, keyed on the parameters that actually require a fresh
YouTube API call). This means:

- Changing only a `sort` parameter on an already-fetched result set is
  effectively free — it re-sorts cached data rather than re-querying.
- Repeat lookups of the same video/channel/playlist/comment within the
  cache TTL don't consume additional YouTube API quota.
- Caches are in-memory and per-process — they reset on backend restart/redeploy, and are not shared across multiple backend instances if you ever scale horizontally.