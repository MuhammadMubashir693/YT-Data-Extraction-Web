# YouTube Data Extraction Tool (Web Version)

A React + Node/Express web app version of the original Python CLI tool.
Uses the YouTube Data API v3.

## Structure

```
yt-tool/
├── backend/      # Express API server
│   ├── server.js
│   ├── helpers.js
│   ├── channels.txt   # your saved channels (name:channelId), one per line
│   └── .env.example
└── frontend/     # React (Vite) app
    └── src/
```

## Setup

### 1. Backend

```bash
cd backend
npm install
cp .env.example .env
```

Edit `.env` and set your API key:

```
YT_API_KEY=your_api_key_here
PORT=5000
```

(Get an API key from the Google Cloud Console with the YouTube Data API v3 enabled.)

Edit `channels.txt` to add channels you want to appear in the "Search Channel Videos"
dropdown, one per line, format `Channel Name:UC...channelId`.

Start the backend:

```bash
npm start
```

It runs on http://localhost:5000

### 2. Frontend

In a separate terminal:

```bash
cd frontend
npm install
npm run dev
```

It runs on http://localhost:5173 and proxies `/api/*` requests to the backend.

Open http://localhost:5173 in your browser.

## Features

1. **Video Details** — paste a video ID or any YouTube video URL (watch, shorts,
   embed, live, youtu.be, music.youtube.com) to get full details.
2. **Search Channel Videos** — pick a channel from `channels.txt`, search by
   keyword and/or date range, optionally filter by duration (short/medium/long).
3. **Channel Details** — paste a channel ID, URL, `/@handle`, `/c/Name`, or
   `/user/Name` URL, or a bare handle.
4. **Comment Details** — paste a comment ID or a watch URL containing `lc=`.
5. **Playlist Videos** — paste a playlist ID or any URL containing `list=`.

## Notes

- The YouTube Data API has a daily quota; heavy use of search/playlist endpoints
  consumes quota quickly.
- All responses are read-only (no write/auth scopes required), so only an API
  key is needed (no OAuth).
