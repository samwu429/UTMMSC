const PREVIEW_MAX = 80;

/** Single-line excerpt for conversation lists. Image-only messages get a fixed label. */
/** 会话列表使用的单行摘要。仅图片的消息使用固定文案。 */
export function previewOf(text: string, hasImage: boolean): string {
  const collapsed = text.replace(/\s+/g, ' ').trim();
  if (!collapsed) return hasImage ? '[图片]' : '';
  const base = hasImage ? `[图片] ${collapsed}` : collapsed;
  return base.length > PREVIEW_MAX ? `${base.slice(0, PREVIEW_MAX - 1)}…` : base;
}

/** Conversation-list line. A withdrawn message never contributes its original text. */
/** 会话列表上的一行。已撤回的消息不会带上原文。 */
export function conversationPreview(input: { text: string; hasImage: boolean; deleted: boolean; recalled: boolean }): string {
  if (input.recalled) return '撤回了一条消息';
  if (input.deleted) return '';
  return previewOf(input.text, input.hasImage);
}
