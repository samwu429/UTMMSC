import type { EnrollmentStatus, NotificationPrefs, PushDeviceKind, Role, WebPushKeys } from '@utmmsc/shared';
import { randomId } from '../../domain/crypto/encoding';
import { isMissingSchemaError } from './channels';
import { prefsFromColumns, type PrefColumns } from './notification-prefs';
import { nowIso } from './time';

/** Devices kept per member; registering another drops the one seen longest ago. */
/** 每位成员保留的设备数；再登记一台时删除最久未出现的那台。 */
export const DEVICES_PER_MEMBER_MAX = 20;
/** Consecutive failures after which a device is removed. */
/** 连续失败达到此次数时删除设备。 */
export const DEVICE_FAILURES_MAX = 5;

const IDS_PER_QUERY = 90;

export interface PushDeviceInput {
  memberId: string;
  sessionId: string;
  kind: PushDeviceKind;
  endpoint: string;
  keys: WebPushKeys | null;
  platform: string | null;
}

/**
 * Registers or refreshes a device. The endpoint is unique, so a browser or phone that changes hands
 * moves to whoever registered it last, under their current sign-in.
 * 登记或刷新设备。endpoint 唯一，因此换人使用的浏览器或手机归最后一次登记它的成员，并绑定其当前登录。
 */
export async function upsertPushDevice(db: D1Database, input: PushDeviceInput): Promise<void> {
  const ts = nowIso();
  await db.batch([
    db
      .prepare(
        `INSERT INTO push_devices (id, member_id, kind, endpoint, keys_json, platform, session_id, created_at, last_seen_at, failure_count)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
         ON CONFLICT (endpoint) DO UPDATE SET
           member_id = excluded.member_id,
           kind = excluded.kind,
           keys_json = excluded.keys_json,
           platform = excluded.platform,
           session_id = excluded.session_id,
           last_seen_at = excluded.last_seen_at,
           failure_count = 0`,
      )
      .bind(randomId('pd'), input.memberId, input.kind, input.endpoint, input.keys ? JSON.stringify(input.keys) : null, input.platform, input.sessionId, ts, ts),
    db
      .prepare(
        `DELETE FROM push_devices WHERE member_id = ? AND id NOT IN (
           SELECT id FROM push_devices WHERE member_id = ? ORDER BY last_seen_at DESC LIMIT ?
         )`,
      )
      .bind(input.memberId, input.memberId, DEVICES_PER_MEMBER_MAX),
  ]);
}

/** Removes one of the caller's own devices; true when a row was deleted. */
/** 删除调用者自己的一台设备；删除了记录时返回 true。 */
export async function removePushDevice(db: D1Database, memberId: string, endpoint: string): Promise<boolean> {
  const result = await db.prepare('DELETE FROM push_devices WHERE endpoint = ? AND member_id = ?').bind(endpoint, memberId).run();
  return (result.meta.changes ?? 0) > 0;
}

/** Devices registered under a sign-in that just ended. Tolerates the table not existing yet. */
/** 删除刚结束的那次登录下登记的设备。表尚不存在时也不报错。 */
export async function removeSessionDevices(db: D1Database, sessionId: string): Promise<void> {
  try {
    await db.prepare('DELETE FROM push_devices WHERE session_id = ?').bind(sessionId).run();
  } catch (err) {
    if (!isMissingSchemaError(err)) throw err;
  }
}

/** Devices whose sign-in was revoked or expired can never receive pushes again. */
/** 登录已被撤销或已过期的设备再也收不到推送。 */
export async function pruneSignedOutDevices(db: D1Database): Promise<number> {
  const result = await db
    .prepare(
      `DELETE FROM push_devices WHERE NOT EXISTS (
         SELECT 1 FROM sessions s WHERE s.id = push_devices.session_id AND s.revoked_at IS NULL AND s.expires_at > ?
       )`,
    )
    .bind(nowIso())
    .run();
  return result.meta.changes ?? 0;
}

/** A device that may receive pushes now, with its owner's notification switches. */
/** 当前可以接收推送的设备，附带其主人的通知开关。 */
export interface DeliveryDevice {
  id: string;
  memberId: string;
  kind: PushDeviceKind;
  endpoint: string;
  keys: WebPushKeys | null;
  failureCount: number;
  prefs: NotificationPrefs;
}

interface DeliveryDeviceRow extends PrefColumns {
  id: string;
  member_id: string;
  kind: PushDeviceKind;
  endpoint: string;
  keys_json: string | null;
  failure_count: number;
}

function parseKeys(raw: string | null): WebPushKeys | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<WebPushKeys>;
    return typeof value.p256dh === 'string' && typeof value.auth === 'string' ? { p256dh: value.p256dh, auth: value.auth } : null;
  } catch {
    return null;
  }
}

/**
 * Only active members, and only devices whose sign-in is still live, so a device signed out from
 * elsewhere or after a password reset stops receiving message text.
 * 只包括在用成员，以及登录仍然有效的设备；在别处退出登录或重设密码之后，该设备不再收到消息内容。
 */
const LIVE_DEVICES = `
  FROM push_devices d
  JOIN members m ON m.id = d.member_id AND m.status = 'active'
  JOIN sessions s ON s.id = d.session_id AND s.member_id = d.member_id AND s.revoked_at IS NULL AND s.expires_at > ?
  LEFT JOIN notification_prefs p ON p.member_id = d.member_id`;

const DEVICE_COLUMNS = 'd.id, d.member_id, d.kind, d.endpoint, d.keys_json, d.failure_count, p.messages AS pref_messages, p.events AS pref_events, p.preview AS pref_preview';

function toDeliveryDevice(row: DeliveryDeviceRow): DeliveryDevice {
  return {
    id: row.id,
    memberId: row.member_id,
    kind: row.kind,
    endpoint: row.endpoint,
    keys: parseKeys(row.keys_json),
    failureCount: row.failure_count,
    prefs: prefsFromColumns(row),
  };
}

/** Live devices of these members, or of every member. Empty before migration 0015. */
/** 这些成员（或全体成员）的有效设备。迁移 0015 之前为空。 */
export async function listDeliveryDevices(db: D1Database, members: readonly string[] | 'all'): Promise<DeliveryDevice[]> {
  try {
    const ts = nowIso();
    if (members === 'all') {
      const result = await db.prepare(`SELECT ${DEVICE_COLUMNS} ${LIVE_DEVICES} ORDER BY d.member_id, d.id LIMIT 10000`).bind(ts).all<DeliveryDeviceRow>();
      return result.results.map(toDeliveryDevice);
    }
    const unique = [...new Set(members)];
    const devices: DeliveryDevice[] = [];
    for (let i = 0; i < unique.length; i += IDS_PER_QUERY) {
      const slice = unique.slice(i, i + IDS_PER_QUERY);
      const result = await db
        .prepare(`SELECT ${DEVICE_COLUMNS} ${LIVE_DEVICES} WHERE d.member_id IN (${slice.map(() => '?').join(', ')})`)
        .bind(ts, ...slice)
        .all<DeliveryDeviceRow>();
      devices.push(...result.results.map(toDeliveryDevice));
    }
    return devices;
  } catch (err) {
    if (isMissingSchemaError(err)) return [];
    throw err;
  }
}

/** A member who has at least one live device, with what decides their access and their switches. */
/** 至少有一台有效设备的成员，附带决定其权限的字段和通知开关。 */
export interface PushableMember {
  id: string;
  role: Role;
  acting_role: string | null;
  enrollment_status: EnrollmentStatus;
  prefs: NotificationPrefs;
}

interface PushableMemberRow extends PrefColumns {
  id: string;
  role: Role;
  acting_role: string | null;
  enrollment_status: EnrollmentStatus;
}

const MEMBER_COLUMNS = 'DISTINCT m.id, m.role, m.acting_role, m.enrollment_status, p.messages AS pref_messages, p.events AS pref_events, p.preview AS pref_preview';

function toPushableMember(row: PushableMemberRow): PushableMember {
  return { id: row.id, role: row.role, acting_role: row.acting_role, enrollment_status: row.enrollment_status, prefs: prefsFromColumns(row) };
}

/**
 * Members who could receive a push at all, narrowed to `memberIds` when given. Recipient checks start
 * here, so a channel with many readers costs one query for the few who enabled notifications.
 * 能够接收推送的成员；给出 `memberIds` 时只在其中查找。收件人判断从这里开始，读者众多的频道也只需一次查询即可找出开启了通知的少数人。
 */
export async function listPushableMembers(db: D1Database, memberIds?: readonly string[]): Promise<PushableMember[]> {
  try {
    const ts = nowIso();
    if (!memberIds) {
      const result = await db.prepare(`SELECT ${MEMBER_COLUMNS} ${LIVE_DEVICES} LIMIT 10000`).bind(ts).all<PushableMemberRow>();
      return result.results.map(toPushableMember);
    }
    const unique = [...new Set(memberIds)];
    const members: PushableMember[] = [];
    for (let i = 0; i < unique.length; i += IDS_PER_QUERY) {
      const slice = unique.slice(i, i + IDS_PER_QUERY);
      const result = await db
        .prepare(`SELECT ${MEMBER_COLUMNS} ${LIVE_DEVICES} WHERE m.id IN (${slice.map(() => '?').join(', ')})`)
        .bind(ts, ...slice)
        .all<PushableMemberRow>();
      members.push(...result.results.map(toPushableMember));
    }
    return members;
  } catch (err) {
    if (isMissingSchemaError(err)) return [];
    throw err;
  }
}

export interface DeviceResult {
  deviceId: string;
  outcome: 'sent' | 'gone' | 'failed' | 'transient' | 'skipped';
  /** Failure count when the device was loaded. */
  /** 加载设备时的失败次数。 */
  failureCount: number;
}

/**
 * Removes devices the push service says are gone, counts consecutive refusals and removes a device at
 * the limit, and clears the count after a success. Transient and skipped results change nothing.
 * 删除推送服务表示已失效的设备；累计连续被拒绝的次数，达到上限时删除设备；成功后清零。临时错误和跳过的结果不做改动。
 */
export async function recordDeliveryResults(db: D1Database, results: readonly DeviceResult[]): Promise<void> {
  const statements: D1PreparedStatement[] = [];
  const failed: string[] = [];
  for (const result of results) {
    if (result.outcome === 'gone') {
      statements.push(db.prepare('DELETE FROM push_devices WHERE id = ?').bind(result.deviceId));
    } else if (result.outcome === 'failed') {
      if (result.failureCount + 1 >= DEVICE_FAILURES_MAX) statements.push(db.prepare('DELETE FROM push_devices WHERE id = ?').bind(result.deviceId));
      else failed.push(result.deviceId);
    } else if (result.outcome === 'sent' && result.failureCount > 0) {
      statements.push(db.prepare('UPDATE push_devices SET failure_count = 0 WHERE id = ?').bind(result.deviceId));
    }
  }
  for (let i = 0; i < failed.length; i += IDS_PER_QUERY) {
    const slice = failed.slice(i, i + IDS_PER_QUERY);
    statements.push(db.prepare(`UPDATE push_devices SET failure_count = failure_count + 1 WHERE id IN (${slice.map(() => '?').join(', ')})`).bind(...slice));
  }
  for (let i = 0; i < statements.length; i += 50) await db.batch(statements.slice(i, i + 50));
}
