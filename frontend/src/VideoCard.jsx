// frontend/src/VideoCard.jsx
import React from "react";
import ImageWithFallback from "./ImageWithFallback.jsx";
import LinkifiedText from "./LinkifiedText.jsx";
import { fmtCount, fmtCountry } from "./format.js";
import { getCategoryName } from "./categoryMap.js";
import { getLanguageName } from "./languageMap.js";

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
          <span><b>Category:</b> {getCategoryName(v.categoryId)}</span>
        </div>
        
        {/* Description with label */}
        {v.description && (
          <div className="description-wrapper" style={{ marginTop: 8 }}>
            <div style={{ fontWeight: 600, fontsize: 14, color: 'var(--text)', marginBottom: 4 }}>
              Description:
            </div>
            <div className="description" style={{ maxHeight: "none", overflow: "visible" }}>
              <LinkifiedText text={v.description} videoId={v.videoId} />
            </div>
          </div>
        )}
        
        {/* Tags with label */}
        {showTags && v.tags && v.tags.length > 0 && (
          <div className="tags-wrapper" style={{ marginTop: 8 }}>
            <div style={{ fontWeight: 600, fontsize: 14, color: 'var(--text)', marginBottom: 4 }}>
              Tags:
            </div>
            <div className="description" style={{ maxHeight: "none", overflow: "visible" }}>
              <div>
                {v.tags.map((tag, i) => (
                  <span key={i} style={{ display: "block", fontSize: 14, color: 'var(--muted)' }}>
                    {tag}
                  </span>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Region restrictions with label */}
        {showTags && v.regionRestriction?.blocked && v.regionRestriction.blocked.length > 0 && (
          <div className="region-restriction-wrapper" style={{ marginTop: 8 }}>
            <div style={{ fontWeight: 600, fontsize: 14, color: 'var(--text)', marginBottom: 4 }}>
              Restricted in:
            </div>
            <div className="description" style={{ maxHeight: "none", overflow: "visible" }}>
              <div>
                {v.regionRestriction.blocked.map((code) => (
                  <span key={code} style={{ display: "block", fontSize: 12, color: 'var(--muted)' }}>
                    {fmtCountry(code)}
                  </span>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}