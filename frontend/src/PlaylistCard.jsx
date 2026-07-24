// frontend/src/PlaylistCard.jsx
import React from "react";
import ImageWithFallback from "./ImageWithFallback.jsx";
import { fmtCount } from "./format.js";

export default function PlaylistCard({ playlist }) {
  return (
    <div className="video-card">
      {playlist.thumbnail && (
        <ImageWithFallback src={playlist.thumbnail} alt={playlist.title} loading="lazy" />
      )}
      <div className="body">
        <p className="title">
          <a href={playlist.playlistUrl} target="_blank" rel="noreferrer">{playlist.title}</a>
        </p>
        <div className="meta-grid">
          <span><b>Playlist ID:</b> {playlist.playlistId}</span>
          <span><b>Channel:</b> {playlist.channelTitle}</span>
          <span><b>Channel ID:</b> {playlist.channelId}</span>
          <span><b>Videos:</b> {fmtCount(playlist.videoCount)}</span>
          <span><b>Created:</b> {playlist.publishedAt}</span>
        </div>
      </div>
    </div>
  );
}