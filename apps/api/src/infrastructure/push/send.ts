import type { NotificationPrefs, PushPayload } from '@utmmsc/shared';
import type { Env } from '../../env';
import { listDeliveryDevices, recordDeliveryResults, type DeliveryDevice } from '../d1/push-devices';
import { deliverJobs } from './deliver';
import type { DeliveryJob, JobOutcome } from './types';

/** What the member should see, or null to send them nothing. Called once per member. */
/** 该成员应看到的内容；返回 null 表示不发送。每位成员调用一次。 */
export type PayloadFor = (memberId: string, prefs: NotificationPrefs) => PushPayload | null;

export interface DeliverySummary {
  /** Devices a push was attempted on. */
  /** 尝试推送的设备数。 */
  devices: number;
  sent: number;
  failed: number;
  /** Members reached on at least one device. */
  /** 至少在一台设备上收到的成员数。 */
  recipients: number;
}

/** Up to this many pushes are sent in the calling invocation; larger fan-outs go through the relay. */
/** 不超过此数量的推送在本次调用中直接发送；更多的推送交给中继发送。 */
export const INLINE_PUSH_MAX = 8;
/**
 * Pushes per relay call. The free plan allows 50 outbound requests per invocation, and one may be the
 * FCM token exchange.
 * 每次中继调用的推送数。免费套餐每次调用最多 50 个外发请求，其中可能有一个用于换取 FCM 令牌。
 */
export const RELAY_CHUNK = 40;

function chunk<T>(items: readonly T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
}

async function runJobs(env: Env, jobs: DeliveryJob[]): Promise<JobOutcome[]> {
  const relay = env.PUSH_RELAY;
  if (jobs.length <= INLINE_PUSH_MAX || !relay) return deliverJobs(env, jobs);
  const parts = await Promise.all(
    chunk(jobs, RELAY_CHUNK).map(async (part, index) => {
      try {
        return await relay.get(relay.idFromName(`push-relay-${index}`)).deliver(part);
      } catch (err) {
        console.error('push: relay call failed', err instanceof Error ? err.message : String(err));
        return part.map((job): JobOutcome => ({ deviceId: job.deviceId, outcome: 'transient' }));
      }
    }),
  );
  return parts.flat();
}

/**
 * Builds one payload per member, pushes it to each of their devices, then prunes devices the push
 * services reject. Rows whose stored keys cannot be read are removed as gone.
 * 为每位成员生成一份内容并推送到其每台设备，然后清理被推送服务拒绝的设备。无法读取已存密钥的记录按失效删除。
 */
export async function deliverToDevices(env: Env, devices: readonly DeliveryDevice[], payloadFor: PayloadFor): Promise<DeliverySummary> {
  const payloads = new Map<string, PushPayload | null>();
  const jobs: DeliveryJob[] = [];
  const broken: string[] = [];
  for (const device of devices) {
    if (!payloads.has(device.memberId)) payloads.set(device.memberId, payloadFor(device.memberId, device.prefs));
    const payload = payloads.get(device.memberId);
    if (!payload) continue;
    if (device.kind === 'webpush' && !device.keys) {
      broken.push(device.id);
      continue;
    }
    jobs.push({ deviceId: device.id, kind: device.kind, endpoint: device.endpoint, keys: device.keys, payload });
  }

  const outcomes = jobs.length > 0 ? await runJobs(env, jobs) : [];
  const byId = new Map(devices.map((device) => [device.id, device]));
  const results = [
    ...outcomes.map((o) => ({ deviceId: o.deviceId, outcome: o.outcome, failureCount: byId.get(o.deviceId)?.failureCount ?? 0 })),
    ...broken.map((deviceId) => ({ deviceId, outcome: 'gone' as const, failureCount: 0 })),
  ];
  try {
    await recordDeliveryResults(env.DB, results);
  } catch (err) {
    console.error('push: could not record delivery results', err instanceof Error ? err.message : String(err));
  }

  const reached = new Set<string>();
  let sent = 0;
  for (const outcome of outcomes) {
    if (outcome.outcome !== 'sent') continue;
    sent += 1;
    const memberId = byId.get(outcome.deviceId)?.memberId;
    if (memberId) reached.add(memberId);
  }
  return { devices: jobs.length, sent, failed: jobs.length - sent, recipients: reached.size };
}

/** Pushes to these members' live devices. Inactive members and signed-out devices get nothing. */
/** 推送到这些成员的有效设备。非在用成员和已退出登录的设备不会收到。 */
export async function sendToMembers(env: Env, memberIds: readonly string[], payloadFor: PayloadFor): Promise<DeliverySummary> {
  if (memberIds.length === 0) return { devices: 0, sent: 0, failed: 0, recipients: 0 };
  return deliverToDevices(env, await listDeliveryDevices(env.DB, memberIds), payloadFor);
}

/** Pushes to every active member's live devices. */
/** 推送到全体在用成员的有效设备。 */
export async function sendToAllMembers(env: Env, payloadFor: PayloadFor): Promise<DeliverySummary> {
  return deliverToDevices(env, await listDeliveryDevices(env.DB, 'all'), payloadFor);
}
