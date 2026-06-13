import React from "react";

export default function VideoCard({ v }) {
  return (
    <div className="video-card">
      <img src={v.thumbnail} alt={v.title} loading="lazy" />
      <div className="body">
        <p className="title">
          <a href={v.videoUrl} target="_blank" rel="noreferrer">
            {v.title}
          </a>
        </p>
        <div className="meta-grid">
          <span><b>Channel:</b> {v.channelTitle}</span>
          <span><b>Uploaded:</b> {v.uploadDate}</span>
          <span><b>Duration:</b> {v.duration}</span>
          <span><b>Views:</b> {v.views}</span>
          <span><b>Likes:</b> {v.likes}</span>
          <span><b>Comments:</b> {v.comments}</span>
        </div>
        {v.description && <div className="description">{v.description}</div>}
      </div>
    </div>
  );
}
