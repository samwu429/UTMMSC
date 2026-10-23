/**
 * The last message this room pushed to each member. Their device shows only that one for the room,
 * since a newer push replaces an older one under the same tag, so when it is withdrawn these are the
 * members whose notice still holds its text.
 * 本房间最近推送给每位成员的消息。同一 tag 下较新的推送会替换较旧的一条，因此设备上只显示这一条；
 * 它被撤回时，这些成员的通知里仍留着原文。
 */
export function recordPushedMessage(sql: SqlStorage, memberIds: readonly string[], messageId: number): void {
  for (const memberId of memberIds) {
    sql.exec(
      `INSERT INTO push_sent (member_id, message_id) VALUES (?, ?)
       ON CONFLICT(member_id) DO UPDATE SET message_id = excluded.message_id
       WHERE excluded.message_id > push_sent.message_id`,
      memberId,
      messageId,
    );
  }
}

/** Members whose latest push was this message; their rows are removed, so each is answered once. */
/** 最近一次推送正是这条消息的成员；同时删除这些行，每人只处理一次。 */
export function takePushedMembers(sql: SqlStorage, messageId: number): string[] {
  return sql
    .exec<{ member_id: string }>('DELETE FROM push_sent WHERE message_id = ? RETURNING member_id', messageId)
    .toArray()
    .map((row) => row.member_id);
}
