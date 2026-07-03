import React from "react";
import ImageWithFallback from "./ImageWithFallback.jsx";
import LinkifiedText from "./LinkifiedText.jsx";
import { fmtCount } from "../../backend/helpers.js";

export default function VideoCard({ v }) {
  return (
    <div className="video-card">
      <ImageWithFallback src={v.thumbnail} alt={v.title} loading="lazy" />
      <div className="body">
        <p className="title">
          <a href={v.videoUrl} target="_blank" rel="noreferrer">
            {v.title}
          </a>
        </p>
        <div className="meta-grid">
          <span><b>Video ID:</b> {v.videoId}</span>
          <span><b>Channel:</b> {v.channelTitle}</span>
          <span><b>Channel ID:</b> {v.channelId}</span>
          <span><b>Uploaded:</b> {v.uploadDate}</span>
          <span><b>Duration:</b> {v.duration}</span>
          <span><b>Views:</b> {fmtCount(v.views)}</span>
          <span><b>Likes:</b> {fmtCount(v.likes)}</span>
          <span><b>Comments:</b> {fmtCount(v.comments)}</span>
        </div>
        {v.description && (
          <div className="description" style={{ maxHeight: "none", overflow: "visible" }}>
            <LinkifiedText text={v.description} />
          </div>
        )}
      </div>
    </div>
  );
}