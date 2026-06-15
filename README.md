# YouTube Data Extraction Tool (Web)

React + Node/Express web app that uses the YouTube Data API v3 to fetch
video, channel, playlist and comment information and provides a small UI
for searching and browsing results.

**Repository structure**

```
YT-Data-Extraction-Web/
├── backend/      # Express API server (Node, MongoDB-backed channel storage)
│   ├── server.js
│   ├── helpers.js
   └── package.json
└── frontend/     # React + Vite app
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
npm start
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

The backend exposes a small JSON API under `/api`:

- `GET /api/health` — basic health check; returns `{ ok: true, apiKeySet: boolean }`.
- `GET /api/video?q=<id|url>` — fetch single video details.
- `GET /api/channel?q=<id|url|handle>` — fetch channel details and public playlists.
- `GET /api/channels` — list saved channels (MongoDB-backed).
- `POST /api/channels` — add saved channel; JSON body: `{ name, id }`.
- `PUT /api/channels/:currentId` — update saved channel; JSON body: `{ name, id }`.
- `DELETE /api/channels/:id` — delete saved channel.
- `GET /api/channel-videos?channelId=...&mode=keyword|date&keyword=...&startDate=YYYY-MM-DD&endDate=YYYY-MM-DD&durationFilter=short|medium|long` — fetch videos for a channel with optional filters.
- `GET /api/search-videos?keyword=...&startDate=YYYY-MM-DD&endDate=YYYY-MM-DD&durationFilter=short|medium|long` — general video search.
- `GET /api/comment?q=<id|url-with-lc>` — fetch a single comment by ID or `lc` param.
- `GET /api/comments?q=<videoId|url>&sort=top|latest|earliest&keyword=...&startDate=YYYY-MM-DD&endDate=YYYY-MM-DD` — fetch comment threads and replies for a video.
- `GET /api/playlist?q=<id|url>` — fetch playlist metadata and videos.

See `backend/server.js` and `backend/helpers.js` for parsing/format details.

**Frontend features**

- Fetch single video details by ID or URL.
- Search videos within a saved channel or globally.
- Manage saved channels (add, update, delete) — saved to MongoDB.
- Fetch channel details (including public playlists).
- Fetch single comments or comment threads with replies, with keyword/date filters and sorting.
- Fetch playlist videos by playlist ID or URL.

**Notes & caveats**

- The YouTube Data API has daily quota limits; search and playlist operations can consume quota quickly.
- The app uses only read-only API calls — an API key is sufficient (no OAuth).
- If MongoDB is not available, channel management endpoints will fail; the backend prints a warning when it cannot connect.
