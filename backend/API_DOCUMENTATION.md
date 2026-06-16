# Backend API Documentation

This document describes the backend JSON API for the YouTube Data Extraction Web app.
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
  "title": "Rick Astley - Never Gonna Give You Up (Video)",
  "channelId": "UCuAXFkgsw1L7xaCfnd5JJOw",
  "channelTitle": "Rick Astley",
  "uploadDate": "Wednesday, December 12, 2007 04:34:00 UTC",
  "duration": "3 minutes 33 seconds",
  "likes": "1234567",
  "views": "1012345678",
  "comments": "456789",
  "thumbnail": "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
  "description": "The official video for “Never Gonna Give You Up” by Rick Astley.",
  "publishedAtRaw": "2007-10-24T06:57:33Z"
}
```

Errors:

- `400 Bad Request`: invalid or missing video ID.
- `404 Not Found`: no video published for the parsed ID.

---

## Channel Lookup and Playlists

### GET `/api/channel`

Description: Fetch channel profile details and public playlists.

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
  "playlists": [
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
  - `playlists`: array of playlist objects
    - `playlistId`, `playlistUrl`, `title`, `channelId`, `publishedAt`, `videoCount`

Errors:

- `400 Bad Request`: could not parse a channel ID.
- `404 Not Found`: no matching channel found.

Notes:

- Handles channel URLs, handles starting with `@`, legacy usernames, and raw `UC...` IDs.

---

## Channel Video Search

### GET `/api/channel-videos`

Description: Search videos published by a specific channel.

Query parameters:

- `channelId` (required): YouTube channel ID.
- `mode` (optional): `keyword` or `date`
- `keyword` (optional): search term used when `mode=keyword`
- `startDate` / `endDate` (optional): filter by published date range
- `durationFilter` (optional): `short`, `medium`, `long`
- `sort` (optional): `relevance`, `date-asc`, `date-desc`, `viewcount-asc`, `viewcount-desc`, `rating-asc`, `rating-desc`, `title-asc`, `title-desc`

Example request:

```http
GET http://localhost:5000/api/channel-videos?channelId=UCX6b17PVsYBQ0ip5gyeme-Q&mode=keyword&keyword=history&startDate=2024-01-01&endDate=2024-06-01&durationFilter=medium&sort=viewcount-desc
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

- When `mode=keyword`, the endpoint performs an initial YouTube search and additionally filters matched videos locally by title, description, and channel title.
- `startDate` and `endDate` are inclusive and converted to UTC range boundaries.

---

## General Video Search

### GET `/api/search-videos`

Description: Search YouTube videos across all channels with optional filters.

Query parameters:

- `keyword` (required): search term.
- `startDate` / `endDate` (optional): publication date range.
- `durationFilter` (optional): `short`, `medium`, `long`
- `sort` (optional): same values as `/api/channel-videos`

Example request:

```http
GET http://localhost:5000/api/search-videos?keyword=space+exploration&startDate=2024-01-01&durationFilter=short&sort=date-desc
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

- `400 Bad Request`: missing `keyword`.

Notes:

- The endpoint first searches YouTube and then fetches enriched video details for the matched ID set.
- Search results are limited by YouTube API pagination and the available video metadata.

---

## Single Comment Lookup

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

---

## Deployment notes

- The backend is implemented in `backend/server.js` using Express and Axios.
- Saved channels require a working MongoDB connection.
- YouTube quota usage depends on the number of requests and the search/video/comment endpoints.

---

## Related files

- `backend/server.js`
- `backend/helpers.js`
