# YT Pool (Web)

React + Node/Express web app that uses the YouTube Data API v3 to fetch
video, channel, playlist, and comment information, and provides a UI for
searching, browsing, and playing results.

**Live app:** https://yt-data-extraction-web.vercel.app/
(backend API hosted separately on Render; see [Deployment](#deployment) below)

**Repository structure**

```
YT-Data-Extraction-Web/
├── docker-compose.yml
├── backend/
│   ├── server.js
│   ├── helpers.js
│   ├── swagger.js
│   ├── Dockerfile
│   ├── .dockerignore
│   ├── .env.example
│   └── package.json
└── frontend/
    ├── src/
    │   ├── App.jsx
    │   ├── VideoCard.jsx
    │   ├── LinkifiedText.jsx
    │   ├── ImageWithFallback.jsx
    │   ├── format.js
    │   └── useInfiniteScroll.jsx
    ├── vite.config.js
    ├── vercel.json
    ├── Dockerfile
    ├── nginx.conf
    ├── .dockerignore
    └── package.json
```

**Quick start**

Option A - Start at once

Create package.json

```bash
touch package.json
```

Add this to it
```bash
{
  "name": "yt-data-extraction-web",
  "version": "1.0.0",
  "scripts": {
    "start": "npm run backend & npm run frontend",
    "backend": "cd backend && npm start",
    "frontend": "cd frontend && npm run dev"
  }
}
```
Run it
```
npm install
npm start
```
Option B - Start individually

1) Backend

```bash
cd backend
npm install
# copy backend/.env.example to backend/.env and fill in your values
```

Required environment variables (defaults shown when applicable):

- `YT_API_KEY` – YouTube Data API v3 key (no OAuth required)
- `PORT` – backend port (default: `5000`)
- `MONGO_URI` – full MongoDB connection string (e.g. an Atlas SRV URI). If set, this overrides the individual `MONGO_USER`/`MONGO_PASS`/`MONGO_HOST`/`MONGO_PORT` parts below — use this for MongoDB Atlas or any hosted deployment.
- `MONGO_USER` – MongoDB username, used to build a local connection string when `MONGO_URI` is not set (default: `admin`)
- `MONGO_PASS` – MongoDB password (default: `mongo123`)
- `MONGO_HOST` – MongoDB host (default: `localhost`)
- `MONGO_PORT` – MongoDB port (default: `27017`)
- `MONGO_DB` – database name (default: `yt-pool`)
- `MONGO_COLL_CHANNELS` – collection name for saved channels (default: `yt-channels`)
- `MONGO_COLL_VIDEOS` – collection name for saved videos (default: `yt-videos`)
- `MONGO_COLL_PLAYLISTS` – collection name for saved playlists (default: `yt-playlists`)
- `MONGO_COLL_COMMENTS` – collection name for saved comments (default: `yt-comments`)

Example `backend/.env` (local MongoDB):

```
YT_API_KEY=your_api_key_here
PORT=5000
MONGO_USER=admin
MONGO_PASS=mongo123
MONGO_HOST=localhost
MONGO_PORT=27017
MONGO_DB=yt-pool
MONGO_COLL_CHANNELS=yt-channels
MONGO_COLL_VIDEOS=yt-videos
MONGO_COLL_PLAYLISTS=yt-playlists
MONGO_COLL_COMMENTS=yt-comments
```

Example `backend/.env` (MongoDB Atlas / hosted deployment):

```
YT_API_KEY=your_api_key_here
PORT=5000
MONGO_URI=mongodb+srv://<user>:<pass>@<cluster>.mongodb.net/?retryWrites=true&w=majority
MONGO_DB=yt-pool
MONGO_COLL_CHANNELS=yt-channels
MONGO_COLL_VIDEOS=yt-videos
MONGO_COLL_PLAYLISTS=yt-playlists
MONGO_COLL_COMMENTS=yt-comments
```

Start the backend:

```bash
npm start
```

or

```bash
npm run dev
```

The server listens on http://localhost:5000 by default. Interactive Swagger
API docs are served at http://localhost:5000/api-docs.

2) Frontend

```bash
cd frontend
npm install
npm run dev
```

The Vite dev server runs on http://localhost:5173 and proxies `/api` requests
to the backend (see `frontend/vite.config.js`). This proxy is **dev-only** —
production builds need `frontend/vercel.json` (or equivalent reverse-proxy
config) to route `/api/*` to the deployed backend; see
[Deployment](#deployment) below.

Open http://localhost:5173 in your browser.

---

**Docker**

The app can also be run entirely with Docker — no local Node install
required (MongoDB Atlas is still used for saved-item storage). This also
doubles as a good way to learn Docker basics: the backend uses a plain
single-stage `Dockerfile`, while the frontend uses a **multi-stage build**
(Node to build the static app, then a lightweight `nginx` image to serve it).

1. Copy `backend/.env.example` to `backend/.env` and fill in your real
   `YT_API_KEY` and MongoDB details (see the variable list above).

2. From the project root:

```bash
docker compose up --build
```

- Frontend: http://localhost:8080
- Backend (direct, e.g. for `/api-docs`): http://localhost:5000

Useful commands:

```bash
docker compose up --build       # rebuild images and start
docker compose up -d            # run in background (detached)
docker compose logs -f backend  # tail one service's logs
docker compose down             # stop and remove containers
docker compose down -v          # also remove any volumes
```

How the pieces fit together:

- `backend/Dockerfile` — installs backend dependencies and runs
  `node server.js` inside a `node:20-alpine` image.
- `frontend/Dockerfile` — stage 1 builds the static app with
  `npm run build`; stage 2 copies just the built `dist/` output into an
  `nginx:1.27-alpine` image, so the final image doesn't ship the Node
  toolchain at all.
- `frontend/nginx.conf` — serves the built frontend and proxies `/api/*`
  and `/api-docs` requests to the `backend` container by its Docker
  Compose service name (Docker's internal DNS resolves this automatically).
- `docker-compose.yml` — wires both containers together and loads
  `backend/.env` into the backend container.

---

**Deployment**

The live app is split across two hosts:

- **Frontend** — deployed on [Vercel](https://vercel.com), building from
  the `frontend/` directory (`npm run build`, output `dist/`).
  `frontend/vercel.json` rewrites all `/api/*` requests to the deployed
  backend URL, since Vercel doesn't know about the dev-only Vite proxy.
- **Backend** — deployed on [Render](https://render.com) as a web service,
  with root directory `backend/`, build command `npm install`, start
  command `npm start`. Render injects `PORT` automatically. MongoDB Atlas
  is used for saved-item storage (`MONGO_URI` env var); Atlas Network
  Access is set to allow `0.0.0.0/0` since Render's free tier doesn't use
  static outbound IPs.

If you fork/redeploy this yourself, remember: whenever the backend's URL
changes, `frontend/vercel.json` must be updated to point at it and the
frontend redeployed — that mapping is static, not automatic.

---

**API endpoints**

The backend exposes a JSON API under `/api`:

- `GET /api/health` — health check; returns `{ ok: true, apiKeySet: boolean }`.
- `GET /api/proxy-image?url=...` — proxy a remote image URL (avoids CORS issues loading thumbnails/avatars/banners in the browser).
- `GET /api/video?q=<id|url>` — fetch single video details.
- `GET /api/channel?q=<id|url|handle>` — fetch channel details, including its unsubscribed trailer video (if the channel has one set) and highest-available-resolution banner.
- `GET /api/channel-playlists?channelId=...` — fetch all of a channel's public playlists (fetched on demand, separately from `/api/channel`, since it can require many sequential API calls for channels with lots of playlists). Includes a synthetic "Uploads" entry for the channel's full uploads playlist.
- `GET /api/channel-latest-videos?channelId=...&count=<1-50>&pageToken=...` — fetch a channel's most recent uploads (paginated via the uploads playlist, cheaper on quota than a full search). Returns `message: "This channel has no uploads."` instead of an error when the channel has zero videos.
- `GET /api/channel-videos?channelId=...&mode=keyword|date&keyword=...&keywordTitle=...&keywordDescription=...&keywordChannel=...&startDate=YYYY-MM-DD&endDate=YYYY-MM-DD&durationFilter=short|medium|long&matchMode=every|some&maxResults=<1-500>&sort=...` — search/filter videos within a specific channel.
- `GET /api/search-videos?keyword=...&keywordTitle=...&keywordDescription=...&keywordChannel=...&startDate=YYYY-MM-DD&endDate=YYYY-MM-DD&durationFilter=short|medium|long&matchMode=every|some&maxResults=<1-500>&sort=...` — general video search across all of YouTube with the same filter options.
- `GET /api/search-channels?keyword=...&maxResults=<1-500>&pageToken=...` — search YouTube channels by name (channel description is not searched).
- `GET /api/search-playlists?keyword=...&keywordTitle=...&keywordChannel=...&maxResults=<1-500>` — search YouTube playlists by a single keyword (across playlist title and channel title) or by separate per-field keywords.
- `GET /api/playlist?q=<id|url>&sort=...&maxResults=<1-500>&pageToken=...` — fetch playlist metadata and videos. Returns `message: "This playlist is empty."` instead of an error for empty playlists.
- `GET /api/comment?q=<id|url-with-lc>` — fetch a single comment by ID or `lc=` URL parameter.
- `GET /api/comments?q=<videoId|url>&sort=top|latest|earliest|likes-desc|likes-asc&keyword=...&startDate=YYYY-MM-DD&endDate=YYYY-MM-DD&pageToken=...&maxResults=<1-50>` — fetch comment threads with replies for a video.
- `GET /api/comment-replies?parentId=...&videoId=...&pageToken=...&maxResults=<1-50>` — fetch (paginated) replies for a top-level comment. `videoId` is optional but recommended — YouTube's API doesn't reliably include it on reply objects, so passing the parent thread's known `videoId` keeps in-comment timestamp links working.
- `GET /api/channels` / `POST /api/channels` / `PUT /api/channels/:currentId` / `DELETE /api/channels/:id` — manage saved channels (MongoDB-backed). Body: `{ name, id }`.
- `GET /api/videos` / `POST /api/videos` / `PUT /api/videos/:currentId` / `DELETE /api/videos/:id` — manage saved videos (MongoDB-backed). Body: `{ name, id }`.
- `GET /api/playlists` / `POST /api/playlists` / `PUT /api/playlists/:currentId` / `DELETE /api/playlists/:id` — manage saved playlists (MongoDB-backed). Body: `{ name, id }`.
- `GET /api/saved-comments` / `POST /api/saved-comments` / `PUT /api/saved-comments/:currentId` / `DELETE /api/saved-comments/:id` — manage saved comments (MongoDB-backed). Body: `{ name, id }`. (Not `/api/comments` — that path is used by the comment-threads lookup endpoint above.)

For a full API reference including request/response schemas and error codes,
see `backend/API_DOCUMENTATION.md`, or the live interactive Swagger UI at
`/api-docs` on your running backend (e.g.
http://localhost:5000/api-docs locally).

**Frontend tabs**

- **Video Details** — fetch full details for a single video by ID or URL (all common YouTube URL formats supported).
- **Video Player** — play an embeddable video by ID or URL directly in the browser using a responsive 16:9 player, with the full video details (same as the Video Details tab) displayed below the player.
- **Search** — search videos, channels, or playlists (selectable category):
  - *Videos* — search within a saved channel or globally, with optional keyword (single or per-field: title, description, channel name), date range, duration type, and sort filters.
  - *Channels* — search by channel name only (channel description is not matched).
  - *Playlists* — search with a single keyword (matched against playlist title and channel title) or with separate per-field keywords for playlist title and channel title.
- **Channel Details** — fetch channel metadata (subscriber count, view count, video count, country — hidden entirely if not set — description, high-resolution banner, avatar), its unsubscribed trailer video (shown only if the channel has one set), its latest uploads, and its playlists (including an **"Uploads"** entry representing the channel's full uploads playlist) with sort options. Paste any playlist's ID/URL — including the Uploads one — into the **Playlist Details** tab to browse its videos with search-by-title, sorting, infinite scroll, and export, exactly like any other playlist.
- **Comment Details** — fetch a single comment by ID or YouTube URL with `lc=` parameter. In-comment `mm:ss` timestamps link to that point in the source video.
- **Comment Threads** — fetch comment threads and paginated replies for a video, with keyword or date range filtering and multiple sort options. In-comment `mm:ss` timestamps link to that point in the source video, for both top-level comments and replies.
- **Playlist Details** — fetch playlist metadata and its videos with sort options, plus a live client-side title search and start/end date range filter (auto-swapped if entered in reverse order) that combine with the sort — no extra API calls, since the full playlist is already loaded.
- **Manage Channels** — add, update, and delete saved channels stored in MongoDB for use in Search Videos. IDs must be unique.
- **Manage Videos** — add, update, and delete saved videos stored in MongoDB, in the same name/ID format as Manage Channels. IDs must be unique.
- **Manage Playlists** — add, update, and delete saved playlists stored in MongoDB, in the same name/ID format as Manage Channels. IDs must be unique.
- **Manage Comments** — add, update, and delete saved comments stored in MongoDB, in the same name/ID format as Manage Channels. IDs must be unique.

**Input formats supported**

All ID/URL inputs accept multiple formats:

- Videos: bare video ID, `youtube.com/watch?v=`, `youtu.be/`, `youtube.com/shorts/`, `youtube.com/live/`, `youtube.com/embed/`, `music.youtube.com`, `m.youtube.com`
- Channels: bare channel ID (`UCxxxx`), `youtube.com/channel/`, `youtube.com/@handle`, `youtube.com/c/`, `youtube.com/user/`, or a bare handle with or without `@`
- Playlists: bare playlist ID or any YouTube URL containing a `list=` parameter
- Comments: bare comment ID or a YouTube URL containing `lc=` parameter

**Exporting results**

Every tab with results to show offers JSON, XML, CSV, and TXT export buttons that download the current result set as a file:

- Single-item tabs (Video Details, Video Player, Channel Details, Comment Details, Playlist Details) export the one fetched record.
- Search/list tabs (Search, Comment Threads) export the full list of currently loaded results, including any comment replies that have been expanded/loaded so far.
- **Manage Channels**, **Manage Videos**, **Manage Playlists**, and **Manage Comments** each show export buttons only after their saved list has successfully loaded from MongoDB and is non-empty; export stays hidden if MongoDB is unreachable or there are no saved entries yet.

**Video descriptions and comments**

Video descriptions and comment text automatically hyperlink:

- URLs (`https://...`, `www...`)
- `#hashtags` (linking to the YouTube hashtag page)
- Timestamps such as `1:23` or `1:02:03` (linking to that point in the video)

**Responsive layout**

The frontend adapts to mobile-width screens: the sidebar becomes a
horizontally-scrollable top bar, video cards stack vertically, and
thumbnails/avatars resize accordingly.

**Notes & caveats**

- The YouTube Data API has daily quota limits; search and playlist operations consume quota more quickly than single-item lookups.
- Only read-only API calls are made — an API key is sufficient, no OAuth required.
- The Video Player can only play videos that the uploader has enabled for embedding on external sites; age-restricted or embedding-disabled videos will show YouTube's own error regardless of player configuration.
- If MongoDB is unavailable, the channel/video/playlist/comment management endpoints will fail; the backend logs a warning on startup when it cannot connect.
- Empty channels (no uploads) and empty playlists are reported with a friendly in-app message rather than an error — YouTube's API reports these as "not found" rather than as empty results, and the backend translates that internally.