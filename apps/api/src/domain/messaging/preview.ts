const PREVIEW_MAX = 80;

/** Single-line excerpt for conversation lists. Image-only messages get a fixed label. */
/** 会话列表使用的单行摘要。仅图片的消息使用固定文案。 */
export function previewOf(text: string, hasImage: boolean): string {
  const collapsed = text.replace(/\s+/g, ' ').trim();
  if (!collapsed) return hasImage ? '[图片]' : '';
  const base = hasImage ? `[图片] ${collapsed}` : collapsed;
  return base.length > PREVIEW_MAX ? `${base.slice(0, PREVIEW_MAX - 1)}…` : base;
}
