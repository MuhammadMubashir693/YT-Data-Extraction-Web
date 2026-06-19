# YouTube Data Extraction Tool (Web)

React + Node/Express web app that uses the YouTube Data API v3 to fetch
video, channel, playlist, and comment information, and provides a UI for
searching, browsing, and playing results.

**Repository structure**

```
YT-Data-Extraction-Web/
├── backend/
│   ├── server.js
│   ├── helpers.js
│   └── package.json
└── frontend/
    ├── src/
    ├── vite.config.js
    └── package.json
```

**Quick start**

1) Backend

```bash
cd backend
npm install
# create or edit backend/.env with your values (see example below)
```

Required environment variables (defaults shown when applicable):

- `YT_API_KEY` – YouTube Data API v3 key (no OAuth required)
- `PORT` – backend port (default: `5000`)
- `MONGO_USER` – MongoDB username (default: `admin`)
- `MONGO_PASS` – MongoDB password (default: `mongo123`)
- `MONGO_HOST` – MongoDB host (default: `localhost`)
- `MONGO_PORT` – MongoDB port (default: `27017`)
- `MONGO_DB` – database name (default: `yt-data-web`)
- `MONGO_COLL` – collection name for saved channels (default: `yt-channels`)

Example `backend/.env`:

```
YT_API_KEY=your_api_key_here
PORT=5000
MONGO_USER=admin
MONGO_PASS=mongo123
MONGO_HOST=localhost
MONGO_PORT=27017
MONGO_DB=yt-data-web
MONGO_COLL=yt-channels
```

Start the backend:

```bash
npm start   # or: npm run dev
```

The server listens on http://localhost:5000 by default.

2) Frontend

```bash
cd frontend
npm install
npm run dev
```

The Vite dev server runs on http://localhost:5173 and proxies `/api` requests
to the backend (see `frontend/vite.config.js`).

Open http://localhost:5173 in your browser.

**API endpoints**

The backend exposes a JSON API under `/api`:

- `GET /api/health` — health check; returns `{ ok: true, apiKeySet: boolean }`.
- `GET /api/video?q=<id|url>` — fetch single video details.
- `GET /api/channel?q=<id|url|handle>` — fetch channel details and public playlists.
- `GET /api/channels` — list saved channels (MongoDB-backed).
- `POST /api/channels` — add a saved channel; JSON body: `{ name, id }`.
- `PUT /api/channels/:currentId` — update a saved channel; JSON body: `{ name, id }`.
- `DELETE /api/channels/:id` — delete a saved channel.
- `GET /api/channel-videos?channelId=...&mode=keyword|date&keyword=...&startDate=YYYY-MM-DD&endDate=YYYY-MM-DD&durationFilter=short|medium|long&sort=...` — fetch videos for a channel with optional keyword, date range, duration, and sort filters.
- `GET /api/search-videos?keyword=...&startDate=YYYY-MM-DD&endDate=YYYY-MM-DD&durationFilter=short|medium|long&sort=...` — general video search with the same filter options.
- `GET /api/search-channels?keyword=...&maxResults=...` — search YouTube channels by name (channel description is not searched).
- `GET /api/search-playlists?keyword=...&keywordTitle=...&keywordChannel=...&maxResults=...` — search YouTube playlists by a single keyword (across playlist title and channel title) or by separate per-field keywords for playlist title and channel title.
- `GET /api/comment?q=<id|url-with-lc>` — fetch a single comment by ID or `lc` URL parameter.
- `GET /api/comments?q=<videoId|url>&sort=top|latest|earliest|likes-desc|likes-asc&keyword=...&startDate=YYYY-MM-DD&endDate=YYYY-MM-DD` — fetch comment threads with replies for a video.
- `GET /api/comment-replies?parentId=...&pageToken=...` — fetch replies for a top-level comment.
- `GET /api/playlist?q=<id|url>&sort=...` — fetch playlist metadata and videos.

For a full API reference, see `backend/API_DOCUMENTATION.md`.

**Frontend tabs**

- **Video Details** — fetch full details for a single video by ID or URL (all common YouTube URL formats supported).
- **Video Player** — play an embeddable video by ID or URL directly in the browser using a responsive 16:9 player.
- **Search** — search videos, channels, or playlists (selectable category):
  - *Videos* — search within a saved channel or globally, with optional keyword (single or per-field: title, description, channel name), date range, duration type, and sort filters.
  - *Channels* — search by channel name only (channel description is not matched).
  - *Playlists* — search with a single keyword (matched against playlist title and channel title) or with separate per-field keywords for playlist title and channel title.
- **Manage Channels** — add, update, and delete saved channels stored in MongoDB for use in Search Videos.
- **Channel Details** — fetch channel metadata (subscriber count, view count, video count, country, description, banner, avatar) and its public playlists with sort options.
- **Comment Details** — fetch a single comment by ID or YouTube URL with `lc=` parameter.
- **Comments Section** — fetch comment threads and paginated replies for a video, with keyword or date range filtering and multiple sort options.
- **Playlist Details** — fetch playlist metadata and its videos with sort options.

**Input formats supported**

All ID/URL inputs accept multiple formats:

- Videos: bare video ID, `youtube.com/watch?v=`, `youtu.be/`, `youtube.com/shorts/`, `youtube.com/live/`, `youtube.com/embed/`, `music.youtube.com`, `m.youtube.com`
- Channels: bare channel ID (`UCxxxx`), `youtube.com/channel/`, `youtube.com/@handle`, `youtube.com/c/`, `youtube.com/user/`, or a bare handle with or without `@`
- Playlists: bare playlist ID or any YouTube URL containing a `list=` parameter
- Comments: bare comment ID or a YouTube URL containing `lc=` parameter

**Notes & caveats**

- The YouTube Data API has daily quota limits; search and playlist operations consume quota more quickly than single-item lookups.
- Only read-only API calls are made — an API key is sufficient, no OAuth required.
- The Video Player can only play videos that the uploader has enabled for embedding on external sites; age-restricted or embedding-disabled videos will show YouTube's own error regardless of player configuration.
- If MongoDB is unavailable, channel management endpoints will fail; the backend logs a warning on startup when it cannot connect.