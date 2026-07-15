# Backend API Documentation

This document describes the backend JSON API for the YT Pool Web app.
The API is exposed under `/api` by `backend/server.js` and uses the YouTube Data API v3 plus a MongoDB-backed channel store.

## Base URL

- Local development: `http://localhost:5000/api`
- Production: depends on your deployment.

## Authentication

- The backend reads `YT_API_KEY` from `backend/.env`.
- Clients do not send the YouTube API key directly; all calls are proxied through the backend.

## Global query formats

- `startDate` and `endDate`: `YYYY-MM-DD`
- `pageToken`: YouTube API pagination token returned in response metadata.
- `durationFilter`: one of `short`, `medium`, `long`
- `sort`: API-specific values documented per endpoint.

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

Description: Fetch an image from a remote URL and return it as a proxied response.

Query parameters:

- `url` (required): remote image URL to proxy.

Errors:

- `400 Bad Request`: missing `url`.
- `502 Bad Gateway`: remote image fetch failed.

Notes:

- This endpoint is useful for browser-safe image loading when CORS or mixed content would otherwise block direct requests.

---

## Saved Channels (MongoDB)

### GET `/api/channels`

Description: Return all saved channels from MongoDB.

Response:

- `200 OK`
- JSON array of saved channel objects:
  - `name`: channel display name
  - `id`: channel ID

Example:

```json
[
  { "name": "CrashCourse", "id": "UCX6b17PVsYBQ0ip5gyeme-Q" },
  { "name": "Veritasium", "id": "UCHnyfMqiRRG1u-2MsSQLbXA" }
]
```

### POST `/api/channels`

Description: Add a saved channel.

Request body:

- `name` (required): channel display name
- `id` (required): channel ID

Example request:

```http
POST http://localhost:5000/api/channels
Content-Type: application/json

{
  "name": "Veritasium",
  "id": "UCHnyfMqiRRG1u-2MsSQLbXA"
}
```

Example response:

```json
{
  "name": "Veritasium",
  "id": "UCHnyfMqiRRG1u-2MsSQLbXA"
}
```

Response:

- `201 Created`
- JSON object with the saved channel.

Errors:

- `400 Bad Request`: missing or empty `name`/`id`.
- `409 Conflict`: channel with the same `id` already exists.

### PUT `/api/channels/:currentId`

Description: Update a saved channel record.

Path parameters:

- `currentId` (required): current channel ID to update.

Request body:

- `name` (required): updated channel display name
- `id` (required): updated channel ID

Example request:

```http
PUT http://localhost:5000/api/channels/UCHnyfMqiRRG1u-2MsSQLbXA
Content-Type: application/json

{
  "name": "Veritasium Official",
  "id": "UCHnyfMqiRRG1u-2MsSQLbXA"
}
```

Example response:

```json
{
  "name": "Veritasium Official",
  "id": "UCHnyfMqiRRG1u-2MsSQLbXA"
}
```

Response:

- `200 OK`
- JSON object with the updated channel.

Errors:

- `400 Bad Request`: missing or empty `name`/`id`.
- `404 Not Found`: no channel with `currentId` exists.
- `409 Conflict`: a different channel already uses the new `id`.

### DELETE `/api/channels/:id`

Description: Remove a saved channel.

Path parameters:

- `id` (required): channel ID to delete.

Example request:

```http
DELETE http://localhost:5000/api/channels/UCHnyfMqiRRG1u-2MsSQLbXA
```

Example response:

```json
{
  "deleted": true
}
```

Response:

- `200 OK`
- JSON object:
  - `deleted`: `true`

Errors:

- `404 Not Found`: channel with `id` does not exist.

Notes:

- Saved channels are stored in the MongoDB collection configured by `MONGO_COLL`.
- If the backend cannot connect to MongoDB, all saved channel endpoints will fail.

---

## Saved Videos (MongoDB)

Same shape and behavior as [Saved Channels](#saved-channels-mongodb), scoped to videos.

### GET `/api/videos`

Description: Return all saved videos from MongoDB.

Response:

- `200 OK`
- JSON array of saved video objects:
  - `name`: video display name
  - `id`: video ID

Example:

```json
[
  { "name": "Me at the zoo", "id": "jNQXAC9IVRw" }
]
```

### POST `/api/videos`

Description: Add a saved video.

Request body:

- `name` (required): video display name
- `id` (required): video ID

Example request:

```http
POST http://localhost:5000/api/videos
Content-Type: application/json

{
  "name": "Me at the zoo",
  "id": "jNQXAC9IVRw"
}
```

Response:

- `201 Created`
- JSON object with the saved video.

Errors:

- `400 Bad Request`: missing or empty `name`/`id`.
- `409 Conflict`: video with the same `id` already exists.

### PUT `/api/videos/:currentId`

Description: Update a saved video record.

Path parameters:

- `currentId` (required): current video ID to update.

Request body:

- `name` (required): updated video display name
- `id` (required): updated video ID

Response:

- `200 OK`
- JSON object with the updated video.

Errors:

- `400 Bad Request`: missing or empty `name`/`id`.
- `404 Not Found`: no video with `currentId` exists.
- `409 Conflict`: a different video already uses the new `id`.

### DELETE `/api/videos/:id`

Description: Remove a saved video.

Path parameters:

- `id` (required): video ID to delete.

Response:

- `200 OK`
- JSON object: `{ "deleted": true }`

Errors:

- `404 Not Found`: video with `id` does not exist.

Notes:

- Saved videos are stored in the MongoDB collection configured by `MONGO_COLL_VIDEOS` (default `yt-videos`).
- If the backend cannot connect to MongoDB, all saved video endpoints will fail.

---

## Saved Playlists (MongoDB)

Same shape and behavior as [Saved Channels](#saved-channels-mongodb), scoped to playlists.

### GET `/api/playlists`

Description: Return all saved playlists from MongoDB.

Response:

- `200 OK`
- JSON array of saved playlist objects:
  - `name`: playlist display name
  - `id`: playlist ID

### POST `/api/playlists`

Description: Add a saved playlist.

Request body:

- `name` (required): playlist display name
- `id` (required): playlist ID

Response:

- `201 Created`
- JSON object with the saved playlist.

Errors:

- `400 Bad Request`: missing or empty `name`/`id`.
- `409 Conflict`: playlist with the same `id` already exists.

### PUT `/api/playlists/:currentId`

Description: Update a saved playlist record.

Path parameters:

- `currentId` (required): current playlist ID to update.

Request body:

- `name` (required): updated playlist display name
- `id` (required): updated playlist ID

Response:

- `200 OK`
- JSON object with the updated playlist.

Errors:

- `400 Bad Request`: missing or empty `name`/`id`.
- `404 Not Found`: no playlist with `currentId` exists.
- `409 Conflict`: a different playlist already uses the new `id`.

### DELETE `/api/playlists/:id`

Description: Remove a saved playlist.

Path parameters:

- `id` (required): playlist ID to delete.

Response:

- `200 OK`
- JSON object: `{ "deleted": true }`

Errors:

- `404 Not Found`: playlist with `id` does not exist.

Notes:

- Saved playlists are stored in the MongoDB collection configured by `MONGO_COLL_PLAYLISTS` (default `yt-playlists`).
- If the backend cannot connect to MongoDB, all saved playlist endpoints will fail.

---

## Saved Comments (MongoDB)

Same shape and behavior as [Saved Channels](#saved-channels-mongodb), scoped to comments. Exposed under `/api/saved-comments` rather than `/api/comments`, since that path is already used by the [Comment Threads and Replies](#comment-threads-and-replies) lookup endpoint.

### GET `/api/saved-comments`

Description: Return all saved comments from MongoDB.

Response:

- `200 OK`
- JSON array of saved comment objects:
  - `name`: comment display name
  - `id`: comment ID

### POST `/api/saved-comments`

Description: Add a saved comment.

Request body:

- `name` (required): comment display name
- `id` (required): comment ID

Response:

- `201 Created`
- JSON object with the saved comment.

Errors:

- `400 Bad Request`: missing or empty `name`/`id`.
- `409 Conflict`: comment with the same `id` already exists.

### PUT `/api/saved-comments/:currentId`

Description: Update a saved comment record.

Path parameters:

- `currentId` (required): current comment ID to update.

Request body:

- `name` (required): updated comment display name
- `id` (required): updated comment ID

Response:

- `200 OK`
- JSON object with the updated comment.

Errors:

- `400 Bad Request`: missing or empty `name`/`id`.
- `404 Not Found`: no comment with `currentId` exists.
- `409 Conflict`: a different comment already uses the new `id`.

### DELETE `/api/saved-comments/:id`

Description: Remove a saved comment.

Path parameters:

- `id` (required): comment ID to delete.

Response:

- `200 OK`
- JSON object: `{ "deleted": true }`

Errors:

- `404 Not Found`: comment with `id` does not exist.

Notes:

- Saved comments are stored in the MongoDB collection configured by `MONGO_COLL_COMMENTS` (default `yt-comments`).
- If the backend cannot connect to MongoDB, all saved comment endpoints will fail.

---

## Video Lookup

### GET `/api/video`

Description: Fetch details for a single video by ID or URL.

Query parameters:

- `q` (required): video ID, URL, or other supported video identifier.

Response:

- `200 OK`
- JSON object with video details:
  - `videoId`, `videoUrl`, `title`, `channelId`, `channelTitle`
  - `uploadDate`, `duration`, `likes`, `views`, `comments`
  - `thumbnail`, `description`, `publishedAtRaw`

Example request:

```http
GET http://localhost:5000/api/video?q=https://www.youtube.com/watch?v=dQw4w9WgXcQ
```

Example response:

```json
{
  "videoId": "dQw4w9WgXcQ",
  "videoUrl": "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
  "title": "Rick Astley - Never Gonna Give You Up (Official Video) (4K Remaster)",
  "channelId": "UCuAXFkgsw1L7xaCfnd5JJOw",
  "channelTitle": "Rick Astley",
  "uploadDate": "Sunday, October 25, 2009 at 06:57:33 UTC",
  "duration": "3 minutes 33 seconds",
  "likes": "1234567",
  "views": "1012345678",
  "comments": "456789",
  "thumbnail": "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
  "description": "The official video for “Never Gonna Give You Up” by Rick Astley.",
  "publishedAtRaw": "2009-10-25T06:57:33Z"
}
```

Errors:

- `400 Bad Request`: invalid or missing video ID.
- `404 Not Found`: no video published for the parsed ID.

---

## Channel Lookup and Playlists

### GET `/api/channel`

Description: Fetch channel profile details and playlists (including the channel's uploads playlist).

Query parameters:

- `q` (required): channel ID, URL, handle, or username.

Example request:

```http
GET http://localhost:5000/api/channel?q=@veritasium
```

Example response:

```json
{
  "channelId": "UCHnyfMqiRRG1u-2MsSQLbXA",
  "title": "Veritasium",
  "description": "Veritasium is a channel about science, education, and curiosity.",
  "createdAt": "Thursday, August 19, 2010 02:00:00 UTC",
  "customUrl": "N/A",
  "country": "United States",
  "thumbnail": "https://yt3.ggpht.com/ytc/AAUvwnj...",
  "banner": "https://yt3.ggpht.com/ytc/AAUvwnj...",
  "videoCount": "233",
  "subscriberCount": "8,100,000",
  "viewCount": "760,000,000",
  "uploadsPlaylistId": "UUHnyfMqiRRG1u-2MsSQLbXA",
  "playlists": [
    {
      "playlistId": "UUHnyfMqiRRG1u-2MsSQLbXA",
      "playlistUrl": "https://www.youtube.com/playlist?list=UUHnyfMqiRRG1u-2MsSQLbXA",
      "title": "Uploads",
      "channelId": "UCHnyfMqiRRG1u-2MsSQLbXA",
      "publishedAt": "Thursday, August 19, 2010 02:00:00 UTC",
      "videoCount": 233
    },
    {
      "playlistId": "PLy6E4A7J_XfN2YQG2hO2pUj7xv",
      "playlistUrl": "https://www.youtube.com/playlist?list=PLy6E4A7J_XfN2YQG2hO2pUj7xv",
      "title": "Science Explanations",
      "channelId": "UCHnyfMqiRRG1u-2MsSQLbXA",
      "publishedAt": "Monday, January 04, 2021 12:00:00 UTC",
      "videoCount": 45
    }
  ]
}
```

Response:

- `200 OK`
- JSON object:
  - `channelId`, `title`, `description`, `createdAt`
  - `customUrl`, `country`, `thumbnail`, `banner`
  - `videoCount`, `subscriberCount`, `viewCount`
  - `uploadsPlaylistId`: the channel's uploads playlist ID (from `contentDetails.relatedPlaylists.uploads`), or `null` if unavailable. This same ID is also included as the first entry of `playlists` (titled `"Uploads"`).
  - `playlists`: array of playlist objects, always led by the channel's uploads playlist (if available) followed by its regular public playlists
    - `playlistId`, `playlistUrl`, `title`, `channelId`, `publishedAt`, `videoCount`

Errors:

- `400 Bad Request`: could not parse a channel ID.
- `404 Not Found`: no matching channel found.

Notes:

- Handles channel URLs, handles starting with `@`, legacy usernames, and raw `UC...` IDs.
- The uploads playlist is never returned by `playlists.list?channelId=...` (it's a synthetic playlist, not a user-created one), so the backend adds it in manually using the channel's own snippet/statistics.
- `uploadsPlaylistId` starts with `UU` rather than `PL`; `GET /api/playlist` and its `q` parser (`parsePlaylistId`) accept `UU`-prefixed IDs (as well as `LL`, `FL`, `WL`, `RD`) in addition to regular `PL` playlists, so this playlist can be fetched the same way as any other.

---

## Channel Video Search

### GET `/api/channel-videos`

Description: Search videos published by a specific channel.

Query parameters:

- `channelId` (required): YouTube channel ID.
- `mode` (optional): `keyword` or `date`
- `keyword` (optional): single search term applied across title, description, and channel name when `mode=keyword`. Mutually exclusive with per-field keywords below.
- `keywordTitle` (optional): keyword matched only against the video title. When any per-field keyword (`keywordTitle`, `keywordDescription`, `keywordChannel`) is provided, `keyword` is ignored for local filtering.
- `keywordDescription` (optional): keyword matched only against the video description.
- `keywordChannel` (optional): keyword matched only against the channel name.
- `startDate` / `endDate` (optional): filter by published date range
- `durationFilter` (optional): `short`, `medium`, `long`
- `sort` (optional): `relevance`, `date-asc`, `date-desc`, `viewcount-asc`, `viewcount-desc`, `rating-asc`, `rating-desc`, `title-asc`, `title-desc`

Example request:

```http
# Single keyword across all fields
GET http://localhost:5000/api/channel-videos?channelId=UCX6b17PVsYBQ0ip5gyeme-Q&mode=keyword&keyword=history&startDate=2024-01-01&endDate=2024-06-01&durationFilter=medium&sort=viewcount-desc

# Per-field keywords (title must contain "world war", description must contain "documentary")
GET http://localhost:5000/api/channel-videos?channelId=UCX6b17PVsYBQ0ip5gyeme-Q&mode=keyword&keywordTitle=world+war&keywordDescription=documentary&sort=date-desc
```

Example response:

```json
{
  "videos": [
    {
      "videoId": "abcd1234efg",
      "videoUrl": "https://www.youtube.com/watch?v=abcd1234efg",
      "title": "World War II in 20 Minutes",
      "channelId": "UCX6b17PVsYBQ0ip5gyeme-Q",
      "channelTitle": "CrashCourse",
      "uploadDate": "Monday, April 22, 2024 10:00:00 UTC",
      "duration": "19 minutes 58 seconds",
      "likes": "154321",
      "views": "2,345,678",
      "comments": "8112",
      "thumbnail": "https://i.ytimg.com/vi/abcd1234efg/hqdefault.jpg",
      "description": "A fast-paced history overview of World War II.",
      "publishedAtRaw": "2024-04-22T10:00:00Z"
    }
  ],
  "count": 1
}
```

Response:

- `200 OK`
- JSON object:
  - `videos`: array of shaped video objects
  - `count`: number of returned videos

Errors:

- `400 Bad Request`: missing `channelId`.

Notes:

- When `mode=keyword`, the endpoint performs an initial YouTube search and additionally filters matched videos locally.
- **Single keyword mode** (`keyword`): the term is matched against title, description, and channel name combined — a video passes if the keyword appears in any of the three fields.
- **Per-field keyword mode** (`keywordTitle`, `keywordDescription`, `keywordChannel`): each provided keyword is matched only against its respective field. Empty fields are ignored. All provided keywords must match (AND logic). If any per-field param is present, `keyword` is ignored for local filtering (it is still forwarded to the YouTube search API as a pre-filter).
- `startDate` and `endDate` are inclusive and converted to UTC range boundaries.

---

## General Video Search

### GET `/api/search-videos`

Description: Search YouTube videos across all channels with optional filters.

Query parameters:

- `keyword` (optional): single search term applied across title, description, and channel name. Required if no per-field keyword is provided.
- `keywordTitle` (optional): keyword matched only against the video title.
- `keywordDescription` (optional): keyword matched only against the video description.
- `keywordChannel` (optional): keyword matched only against the channel name.
- `startDate` / `endDate` (optional): publication date range.
- `durationFilter` (optional): `short`, `medium`, `long`
- `sort` (optional): same values as `/api/channel-videos`

At least one of `keyword`, `keywordTitle`, `keywordDescription`, or `keywordChannel` must be provided.

Example request:

```http
# Single keyword across all fields
GET http://localhost:5000/api/search-videos?keyword=space+exploration&startDate=2024-01-01&durationFilter=short&sort=date-desc

# Per-field keywords (title must contain "space", channel name must contain "NASA")
GET http://localhost:5000/api/search-videos?keywordTitle=space&keywordChannel=NASA&sort=date-desc
```

Example response:

```json
{
  "videos": [
    {
      "videoId": "xyz98765432",
      "videoUrl": "https://www.youtube.com/watch?v=xyz98765432",
      "title": "5 Space Facts You Didn't Know",
      "channelId": "UCBI3mAQwY3Ssf8fVdCxYrrA",
      "channelTitle": "NASA",
      "uploadDate": "Friday, May 10, 2024 14:30:00 UTC",
      "duration": "8 minutes 42 seconds",
      "likes": "45321",
      "views": "1,234,567",
      "comments": "4067",
      "thumbnail": "https://i.ytimg.com/vi/xyz98765432/hqdefault.jpg",
      "description": "Explore five surprising facts about space exploration.",
      "publishedAtRaw": "2024-05-10T14:30:00Z"
    }
  ],
  "count": 1
}
```

Response:

- `200 OK`
- JSON object:
  - `videos`: array of shaped video objects
  - `count`: number of returned videos

Errors:

- `400 Bad Request`: no keyword provided (neither `keyword` nor any per-field keyword).

Notes:

- The endpoint first searches YouTube and then fetches enriched video details for the matched ID set.
- **Single keyword mode** (`keyword`): the term is matched against title, description, and channel name combined.
- **Per-field keyword mode** (`keywordTitle`, `keywordDescription`, `keywordChannel`): each non-empty keyword is matched only against its respective field with AND logic. When any per-field param is provided, `keyword` is used only as the YouTube API search query, not for local filtering.
- Search results are limited by YouTube API pagination and the available video metadata.

---

## Channel Search

### GET `/api/search-channels`

Description: Search YouTube channels by name.

Query parameters:

- `keyword` (required): search term matched only against the channel name (title). Channel descriptions are **not** searched or matched against.
- `maxResults` (optional): maximum number of results to return, 1–500. Default: 50.

Example request:

```http
GET http://localhost:5000/api/search-channels?keyword=NASA&maxResults=50
```

Example response:

```json
{
  "channels": [
    {
      "channelId": "UCBI3mAQwY3Ssf8fVdCxYrrA",
      "channelUrl": "https://www.youtube.com/channel/UCBI3mAQwY3Ssf8fVdCxYrrA",
      "title": "NASA",
      "description": "NASA's official YouTube channel.",
      "country": "United States",
      "publishedAt": "Tuesday, July 10, 2007 00:00:00 UTC",
      "subscribers": "10500000",
      "videoCount": "10234",
      "viewCount": "987654321",
      "thumbnail": "https://yt3.googleusercontent.com/abcd1234"
    }
  ],
  "count": 1
}
```

Response:

- `200 OK`
- JSON object:
  - `channels`: array of shaped channel objects (`channelId`, `channelUrl`, `title`, `description`, `country`, `publishedAt`, `subscribers`, `videoCount`, `viewCount`, `thumbnail`)
  - `count`: number of returned channels

Errors:

- `400 Bad Request`: missing or empty `keyword`.

Notes:

- The endpoint first searches YouTube for matching channels, then fetches enriched channel details for the matched ID set.
- Matching is performed **only against the channel name (title)**. The channel `description` is included in the response for display purposes but is never used as a search-matching field.
- There is no per-field keyword mode for channel search, since name is the only searchable field.

---

## Playlist Search

### GET `/api/search-playlists`

Description: Search YouTube playlists across all channels.

Query parameters:

- `keyword` (optional): single search term matched against playlist title and channel title combined. Required if no per-field keyword is provided.
- `keywordTitle` (optional): keyword matched only against the playlist title.
- `keywordChannel` (optional): keyword matched only against the channel title.
- `maxResults` (optional): maximum number of results to return, 1–500. Default: 50.

At least one of `keyword`, `keywordTitle`, or `keywordChannel` must be provided.

Example request:

```http
# Single keyword across playlist title and channel title
GET http://localhost:5000/api/search-playlists?keyword=cooking+basics&maxResults=50

# Per-field keywords (playlist title must contain "basics", channel title must contain "Tasty")
GET http://localhost:5000/api/search-playlists?keywordTitle=basics&keywordChannel=Tasty
```

Example response:

```json
{
  "playlists": [
    {
      "playlistId": "PLynG1pZ1ZgJzHYlq3F4u1xY8NFe8r0Kkp",
      "playlistUrl": "https://www.youtube.com/playlist?list=PLynG1pZ1ZgJzHYlq3F4u1xY8NFe8r0Kkp",
      "title": "Cooking Basics",
      "channelId": "UC8butISFwT-Wl7EV0hUK0BQ",
      "channelTitle": "Tasty",
      "publishedAt": "Friday, March 01, 2024 08:00:00 UTC",
      "videoCount": 24,
      "thumbnail": "https://i.ytimg.com/vi/a1b2c3d4e5f/hqdefault.jpg"
    }
  ],
  "count": 1
}
```

Response:

- `200 OK`
- JSON object:
  - `playlists`: array of shaped playlist objects (`playlistId`, `playlistUrl`, `title`, `channelId`, `channelTitle`, `publishedAt`, `videoCount`, `thumbnail`)
  - `count`: number of returned playlists

Errors:

- `400 Bad Request`: no keyword provided (neither `keyword` nor any per-field keyword).

Notes:

- The endpoint first searches YouTube for matching playlists, then fetches enriched playlist details for the matched ID set.
- **Single keyword mode** (`keyword`): the term is matched against playlist title and channel title combined — a playlist passes if the keyword appears in either field.
- **Per-field keyword mode** (`keywordTitle`, `keywordChannel`): each non-empty keyword is matched only against its respective field with AND logic. When any per-field param is provided, `keyword` is used only as the YouTube API search query, not for local filtering.

---



### GET `/api/comment`

Description: Fetch a single comment by comment ID or by URL containing an `lc` parameter.

Query parameters:

- `q` (required): comment ID or comment URL.

Example request:

```http
GET http://localhost:5000/api/comment?q=UgxA1B2C3D4E5F6G7H8I9J0
```

Example response:

```json
{
  "commentId": "UgxA1B2C3D4E5F6G7H8I9J0",
  "authorName": "Jane Doe",
  "authorChannelId": "UC6789ExampleChannel",
  "authorProfileImageUrl": "https://yt3.ggpht.com/ytc/AAUvwnj...",
  "textDisplay": "Amazing video! Learned a lot.",
  "textOriginal": "Amazing video! Learned a lot.",
  "likeCount": 123,
  "publishedAt": "Tuesday, May 14, 2024 09:22:00 UTC",
  "updatedAt": "Tuesday, May 14, 2024 09:22:00 UTC"
}
```

Response:

- `200 OK`
- JSON object with comment details:
  - `commentId`, `authorName`, `authorChannelId`, `authorProfileImageUrl`
  - `textDisplay`, `textOriginal`, `likeCount`
  - `publishedAt`, `updatedAt`

Errors:

- `400 Bad Request`: invalid or missing comment ID.
- `404 Not Found`: no comment found.

---

## Comment Threads and Replies

### GET `/api/comments`

Description: Fetch a video’s top-level comment threads and their first page of replies.

Query parameters:

- `q` (required): video ID or URL.
- `sort` (optional): `top`, `latest`, `earliest`
- `keyword` (optional): filter threads and replies by keyword text
- `startDate` / `endDate` (optional): filter threads by published date
- `pageToken` (optional): fetch a specific page of comment threads

Example request:

```http
GET http://localhost:5000/api/comments?q=https://www.youtube.com/watch?v=dQw4w9WgXcQ&sort=latest&keyword=awesome
```

Example response:

```json
{
  "videoId": "dQw4w9WgXcQ",
  "commentCount": 3,
  "threadCount": 2,
  "totalThreads": 200,
  "hasMore": true,
  "nextPageToken": "CAUQAA",
  "sort": "latest",
  "threads": [
    {
      "commentId": "Ugy12345ExampleComment",
      "authorName": "John Smith",
      "authorChannelId": "UC123ExampleChannel",
      "authorProfileImageUrl": "https://yt3.ggpht.com/ytc/AAUvwnj...",
      "likeCount": 34,
      "publishedAt": "Monday, June 10, 2024 12:20:00 UTC",
      "updatedAt": "Monday, June 10, 2024 12:20:00 UTC",
      "textDisplay": "This video is awesome!",
      "textOriginal": "This video is awesome!",
      "replyCount": 1,
      "replies": [
        {
          "commentId": "Ugz67890ExampleReply",
          "authorName": "Jane Doe",
          "authorChannelId": "UC6789ExampleChannel",
          "authorProfileImageUrl": "https://yt3.ggpht.com/ytc/AAUvwnj...",
          "likeCount": 5,
          "publishedAt": "Monday, June 10, 2024 12:45:00 UTC",
          "updatedAt": "Monday, June 10, 2024 12:45:00 UTC",
          "textDisplay": "Totally agree!",
          "textOriginal": "Totally agree!"
        }
      ]
    },
    {
      "commentId": "Ugy98765ExampleComment",
      "authorName": "Emily Roe",
      "authorChannelId": "UC987ExampleChannel",
      "authorProfileImageUrl": "https://yt3.ggpht.com/ytc/AAUvwnj...",
      "likeCount": 12,
      "publishedAt": "Sunday, June 09, 2024 18:10:00 UTC",
      "updatedAt": "Sunday, June 09, 2024 18:10:00 UTC",
      "textDisplay": "Best upload yet!",
      "textOriginal": "Best upload yet!",
      "replyCount": 0,
      "replies": []
    }
  ]
}
```

Response:

- `200 OK`
- JSON object:
  - `videoId`
  - `commentCount`: total comments in returned threads and replies
  - `threadCount`: number of threads returned
  - `totalThreads`: YouTube estimated total thread count
  - `hasMore`: boolean
  - `nextPageToken`: token for next page or `null`
  - `sort`
  - `threads`: array of thread objects

Thread object fields:

- `commentId`, `authorName`, `authorChannelId`, `authorProfileImageUrl`
- `likeCount`, `publishedAt`, `updatedAt`
- `textDisplay`, `textOriginal`
- `replyCount`
- `replies`: array of reply objects

Reply object fields mirror the thread object shape.

Errors:

- `400 Bad Request`: invalid or missing video ID.

Notes:

- `sort=top` maps to YouTube order `relevance`.
- Local filtering is applied after YouTube returns the comment threads.

---

## Comment Replies by Parent ID

### GET `/api/comment-replies`

Description: Fetch direct replies for a top-level comment.

Query parameters:

- `parentId` (required): top-level comment ID.
- `pageToken` (optional): YouTube comment page token.

Example request:

```http
GET http://localhost:5000/api/comment-replies?parentId=Ugy12345ExampleComment
```

Example response:

```json
{
  "parentId": "Ugy12345ExampleComment",
  "replies": [
    {
      "commentId": "Ugz67890ExampleReply",
      "authorName": "Jane Doe",
      "authorChannelId": "UC6789ExampleChannel",
      "authorProfileImageUrl": "https://yt3.ggpht.com/ytc/AAUvwnj...",
      "likeCount": 5,
      "publishedAt": "Monday, June 10, 2024 12:45:00 UTC",
      "updatedAt": "Monday, June 10, 2024 12:45:00 UTC",
      "textDisplay": "Totally agree!",
      "textOriginal": "Totally agree!"
    }
  ],
  "hasMore": false,
  "nextPageToken": null,
  "totalResults": 1
}
```

Response:

- `200 OK`
- JSON object:
  - `parentId`
  - `replies`: array of reply objects
  - `hasMore`: boolean
  - `nextPageToken`: token for next page or `null`
  - `totalResults`: estimated total result count

Errors:

- `400 Bad Request`: missing `parentId`.

---

## Playlist Lookup

### GET `/api/playlist`

Description: Fetch playlist metadata and all playlist videos.

Query parameters:

- `q` (required): playlist ID or playlist URL.

Example request:

```http
GET http://localhost:5000/api/playlist?q=PLynG1pZ1ZgJzHYlq3F4u1xY8NFe8r0Kkp
```

Example response:

```json
{
  "playlistInfo": {
    "playlistId": "PLynG1pZ1ZgJzHYlq3F4u1xY8NFe8r0Kkp",
    "title": "Introduction to Computer Science",
    "channelId": "UC8butISFwT-Wl7EV0hUK0BQ",
    "publishedAt": "Friday, March 01, 2024 08:00:00 UTC"
  },
  "videos": [
    {
      "videoId": "a1b2c3d4e5f",
      "videoUrl": "https://www.youtube.com/watch?v=a1b2c3d4e5f",
      "title": "Welcome to CS 101",
      "channelId": "UC8butISFwT-Wl7EV0hUK0BQ",
      "channelTitle": "FreeCodeCamp.org",
      "uploadDate": "Friday, March 01, 2024 08:00:00 UTC",
      "duration": "12 minutes 34 seconds",
      "likes": "9876",
      "views": "123,456",
      "comments": "345",
      "thumbnail": "https://i.ytimg.com/vi/a1b2c3d4e5f/hqdefault.jpg",
      "description": "An introduction to computer science and programming concepts.",
      "publishedAtRaw": "2024-03-01T08:00:00Z"
    }
  ],
  "count": 1
}
```

Response:

- `200 OK`
- JSON object:
  - `playlistInfo`
    - `playlistId`, `title`, `channelId`, `publishedAt`
  - `videos`: array of shaped video objects
  - `count`: number of videos returned

Errors:

- `400 Bad Request`: invalid or missing playlist ID.

Notes:

- The endpoint loads the full playlist item list using YouTube pagination and then fetches enriched video metadata in batches.
- `q` accepts any playlist-style ID: regular playlists (`PL`), a channel's uploads playlist (`UU`), liked videos (`LL`), legacy favorites (`FL`), watch later (`WL`), and mixes/radios (`RD`) — so a channel's `uploadsPlaylistId` (from `GET /api/channel`) can be passed here directly to list all of a channel's uploads.
- `playlists.list` never returns metadata for "special" playlists like the uploads playlist, even when queried directly by ID. For these, `playlistInfo` is instead derived from the owning channel (whose ID is encoded in the playlist ID, e.g. `UUxxxx` → channel `UCxxxx`), giving a title like `"Channel Name – Uploads"`. The video listing itself (`playlistItems.list`) works normally regardless.

---

## Video Object Shape

The `videos` arrays returned by most endpoints use a consistent shape generated by `backend/helpers.js`:

- `videoId`
- `videoUrl`
- `title`
- `channelId`
- `channelTitle`
- `uploadDate`
- `duration`
- `likes`
- `views`
- `comments`
- `thumbnail`
- `description`
- `publishedAtRaw`

---

## Error handling

- Most errors return `500 Internal Server Error` with JSON `{ error: string }` when the backend encounters an unexpected failure.
- Validation errors return `400 Bad Request` or `409 Conflict` with a JSON error message.
- `403 Forbidden`: returned when the YouTube Data API quota is exhausted. The response body contains `{ error: string }` with a human-readable message. Retrying immediately will not help; the quota resets at midnight Pacific Time.

---

## Deployment notes

- The backend is implemented in `backend/server.js` using Express and Axios.
- Saved channels, videos, playlists, and comments each require a working MongoDB connection.
- YouTube quota usage depends on the number of requests and the search/video/comment endpoints.

---

## Related files

- `backend/server.js`
- `backend/helpers.js`