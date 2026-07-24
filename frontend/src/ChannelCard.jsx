// frontend/src/ChannelCard.jsx
import React from "react";
import ImageWithFallback from "./ImageWithFallback.jsx";
import LinkifiedText from "./LinkifiedText.jsx";
import { fmtCount } from "./format.js";

export default function ChannelCard({ channel }) {
  return (
    <div className="video-card">
      {channel.thumbnail && (
        <ImageWithFallback src={channel.thumbnail} alt={channel.title} loading="lazy" />
      )}
      <div className="body">
        <p className="title">
          <a href={channel.channelUrl} target="_blank" rel="noreferrer">{channel.title}</a>
        </p>
        <div className="meta-grid">
          <span><b>Channel ID:</b> {channel.channelId}</span>
          <span><b>Subscribers:</b> {fmtCount(channel.subscribers)}</span>
          <span><b>Videos:</b> {fmtCount(channel.videoCount)}</span>
          <span><b>Total views:</b> {fmtCount(channel.viewCount)}</span>
          <span><b>Country:</b> {channel.country}</span>
          <span><b>Created:</b> {channel.publishedAt}</span>
        </div>
        {channel.description && (
          <div className="description" style={{ maxHeight: "none", overflow: "visible" }}>
            <LinkifiedText text={channel.description} />
          </div>
        )}
      </div>
    </div>
  );
}