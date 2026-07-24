// frontend/src/CommentCard.jsx
import React from "react";
import ImageWithFallback from "./ImageWithFallback.jsx";
import LinkifiedText from "./LinkifiedText.jsx";
import { fmtCount } from "./format.js";

export default function CommentCard({ 
  comment, 
  parentCommentId, 
  children,
  showParentId = true 
}) {
  const showUpdated = comment.updatedAt && comment.updatedAt !== comment.publishedAt;

  // Extract parent ID from comment ID (everything before the dot)
  let extractedParentId = null;
  if (comment.commentId && comment.commentId.includes('.')) {
    extractedParentId = comment.commentId.split('.')[0];
  }

  const displayParentId = parentCommentId || comment.parentId || extractedParentId;

  return (
    <>
      <div className="comment-header" style={{ justifyContent: "space-between" }}>
        <div style={{ display: "flex", gap: 12 }}>
          {comment.authorProfileImageUrl && (
            <ImageWithFallback
              src={comment.authorProfileImageUrl}
              alt={comment.authorName}
              className="comment-avatar"
            />
          )}
          <div className="comment-meta-small">
            <span><b>ID:</b> {comment.commentId}</span>
            {showParentId && displayParentId && (
              <span><b>Parent ID:</b> {displayParentId}</span>
            )}
            <span><b>Channel ID:</b> {comment.authorChannelId}</span>
            <span>
              <b>Display Name:</b>{" "}
              {comment.authorChannelUrl ? (
                <a href={comment.authorChannelUrl} target="_blank" rel="noreferrer">
                  {comment.authorName}
                </a>
              ) : (
                comment.authorName
              )}
            </span>
            <span><b>Published:</b> {comment.publishedAt}</span>
            {showUpdated && <span><b>Updated:</b> {comment.updatedAt}</span>}
            {comment.replyCount != null && <span><b>Replies:</b> {comment.replyCount}</span>}
            {comment.likeCount != null && <span><b>Likes:</b> {fmtCount(comment.likeCount)}</span>}
          </div>
        </div>
      </div>
      <div
        className="description"
        style={{
          marginTop: 10,
          maxHeight: "none",
          overflow: "visible",
          overflowWrap: "anywhere",
          wordBreak: "break-word",
        }}
      >
        <LinkifiedText text={comment.textDisplay} videoId={comment.videoId} />
      </div>
      {children}
    </>
  );
}