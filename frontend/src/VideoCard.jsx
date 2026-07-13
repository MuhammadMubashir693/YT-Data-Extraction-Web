import React from "react";
import ImageWithFallback from "./ImageWithFallback.jsx";
import LinkifiedText from "./LinkifiedText.jsx";
import { fmtCount } from "../../backend/helpers.js";

export default function VideoCard({ v, showTags = false }) {
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
          {v.scheduledStartTime && <span><b>Scheduled:</b> {v.scheduledStartTime}</span>}
          {v.actualStartTime && <span><b>Started:</b> {v.actualStartTime}</span>}
          {v.actualEndTime && <span><b>Ended:</b> {v.actualEndTime}</span>}
          <span><b>Duration:</b> {v.duration}</span>
          <span><b>Views:</b> {fmtCount(v.views)}</span>
          <span><b>Likes:</b> {fmtCount(v.likes)}</span>
          <span><b>Comments:</b> {fmtCount(v.comments)}</span>
          <span><b>Default language:</b> {v.defaultLanguage}</span>
          <span><b>Default audio language:</b> {v.defaultAudioLanguage}</span>
          <span><b>Category ID:</b> {v.categoryId ?? "N/A"}</span>
          <span><b>Category:</b> {v.categoryName}</span>
        </div>
        {v.description && (
          <div className="description" style={{ maxHeight: "none", overflow: "visible" }}>
            <LinkifiedText text={v.description} videoId={v.videoId} />
          </div>
        )}
        {showTags && v.tags && v.tags.length > 0 && (
          <div className="description" style={{ maxHeight: "none", overflow: "visible", marginTop: 6 }}>
            <div>
              {v.tags.map((tag, i) => (
                <span key={i} style={{ display: "block" }}>{tag}</span>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}