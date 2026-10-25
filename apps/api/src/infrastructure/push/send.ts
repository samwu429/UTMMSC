import type { NotificationPrefs, PushPayload, TestDeviceOutcome, TestNotificationResponse } from '@utmmsc/shared';
import type { Env } from '../../env';
import { listDeliveryDevices, recordDeliveryResults, type DeliveryDevice } from '../d1/push-devices';
import { deliverJobs } from './deliver';
import type { DeliveryJob, DeliveryOutcome, JobOutcome } from './types';

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

/**
 * auto: up to INLINE_PUSH_MAX pushes are sent in the calling invocation, more go through the relay. always: every
 * push goes through the relay, which keeps encryption and push requests out of a cron run's own CPU and
 * outbound-request budget. Without the relay binding both send inline.
 * auto：不超过 INLINE_PUSH_MAX 条推送在本次调用中直接发送，更多的交给中继。always：所有推送都交给中继，使加密和推送请求不占用定时任务
 * 本身的 CPU 和外发请求额度。没有中继绑定时两者都直接发送。
 */
export type RelayMode = 'auto' | 'always';

export interface SendOptions {
  relay?: RelayMode;
}

async function runJobs(env: Env, jobs: DeliveryJob[], mode: RelayMode): Promise<JobOutcome[]> {
  const relay = env.PUSH_RELAY;
  if (!relay || (mode === 'auto' && jobs.length <= INLINE_PUSH_MAX)) return deliverJobs(env, jobs);
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

interface DeliveryRun {
  summary: DeliverySummary;
  /** Outcome per device id, for every device a push was attempted on or that was removed. */
  /** 每台设备的结果，按设备 id 记录，包括尝试推送的设备和被删除的设备。 */
  outcomes: Map<string, DeliveryOutcome>;
}

/**
 * Builds one payload per member, pushes it to each of their devices, then prunes devices the push
 * services reject. Rows whose stored keys cannot be read are removed as gone.
 * 为每位成员生成一份内容并推送到其每台设备，然后清理被推送服务拒绝的设备。无法读取已存密钥的记录按失效删除。
 */
export async function deliverToDevices(env: Env, devices: readonly DeliveryDevice[], payloadFor: PayloadFor): Promise<DeliverySummary> {
  return (await deliver(env, devices, payloadFor, 'auto')).summary;
}

async function deliver(env: Env, devices: readonly DeliveryDevice[], payloadFor: PayloadFor, mode: RelayMode): Promise<DeliveryRun> {
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

  const outcomes = jobs.length > 0 ? await runJobs(env, jobs, mode) : [];
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
  return {
    summary: { devices: jobs.length, sent, failed: jobs.length - sent, recipients: reached.size },
    outcomes: new Map(results.map((r) => [r.deviceId, r.outcome])),
  };
}

/** When one sign-in has several rows (an old token beside its replacement), the best outcome speaks for it. */
/** 同一登录有多条记录时（旧令牌和替换它的新令牌并存），以最好的结果为准。 */
const OUTCOME_RANK: Record<DeliveryOutcome, number> = { sent: 0, skipped: 1, transient: 1, failed: 2, gone: 3 };

function isServiceSide(outcome: DeliveryOutcome): outcome is 'skipped' | 'transient' {
  return outcome === 'skipped' || outcome === 'transient';
}

/**
 * The test push: to every live device of the member, whatever their switches say. It reports how the push
 * went for the devices registered under `sessionId`, the sign-in that asked, so the screen can speak about
 * the device in the member's hand, and whether a failure lay with the server or the push service.
 * 测试推送：发到成员的每台有效设备，不受通知开关影响。返回在 `sessionId`（发出请求的那次登录）下登记的设备的结果，
 * 页面因此能说明成员手中这台设备的情况；同时说明失败是否出在服务器或推送服务一侧。
 */
export async function sendTestPush(env: Env, memberId: string, sessionId: string, payload: PushPayload): Promise<TestNotificationResponse> {
  const devices = await listDeliveryDevices(env.DB, [memberId]);
  const { summary, outcomes } = await deliver(env, devices, () => payload, 'auto');
  let here: DeliveryOutcome | null = null;
  for (const device of devices) {
    const outcome = device.sessionId === sessionId ? outcomes.get(device.id) : undefined;
    if (outcome && (here === null || OUTCOME_RANK[outcome] < OUTCOME_RANK[here])) here = outcome;
  }
  const thisDevice: TestDeviceOutcome = here === null ? 'none' : isServiceSide(here) ? 'unavailable' : here;
  return { devices: summary.devices, sent: summary.sent, failed: summary.failed, thisDevice, serviceProblem: [...outcomes.values()].some(isServiceSide) };
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

/**
 * How a push went for one member. sent: at least one device took it. retry: none did, and at least one failure lay
 * with the push service or our credentials, so trying again may work. failed: every device refused it or is gone.
 * none: the member has no live device, or was given no payload.
 * 一位成员的推送结果。sent：至少一台设备收到。retry：没有设备收到，且至少有一次失败出在推送服务或我方凭据一侧，重试可能成功。
 * failed：每台设备都拒绝了或已失效。none：该成员没有有效设备，或没有为其生成内容。
 */
export type MemberPushOutcome = 'sent' | 'retry' | 'failed' | 'none';

/** One member's outcome from the outcomes of their devices. */
/** 由一位成员各台设备的结果得出该成员的结果。 */
export function memberPushOutcome(outcomes: readonly DeliveryOutcome[]): MemberPushOutcome {
  if (outcomes.length === 0) return 'none';
  if (outcomes.includes('sent')) return 'sent';
  if (outcomes.some(isServiceSide)) return 'retry';
  return 'failed';
}

/**
 * Pushes to these members' live devices like sendToMembers, and reports the outcome for each member asked about,
 * so a caller that keeps its own ledger can mark each row sent, skipped, failed or due for a retry. Devices are
 * pruned exactly as for any other push.
 * 与 sendToMembers 一样推送到这些成员的有效设备，并报告每位被询问成员的结果；自己维护记录的调用方因此能把每一行标记为已发送、
 * 已跳过、失败或待重试。设备的清理与其他推送完全相同。
 */
export async function sendToMembersReport(
  env: Env,
  memberIds: readonly string[],
  payloadFor: PayloadFor,
  options: SendOptions = {},
): Promise<Map<string, MemberPushOutcome>> {
  const unique = [...new Set(memberIds)];
  const report = new Map<string, MemberPushOutcome>(unique.map((memberId) => [memberId, 'none']));
  if (unique.length === 0) return report;
  const devices = await listDeliveryDevices(env.DB, unique);
  const { outcomes } = await deliver(env, devices, payloadFor, options.relay ?? 'auto');
  const byMember = new Map<string, DeliveryOutcome[]>();
  for (const device of devices) {
    const outcome = outcomes.get(device.id);
    if (!outcome) continue;
    const list = byMember.get(device.memberId) ?? [];
    list.push(outcome);
    byMember.set(device.memberId, list);
  }
  for (const memberId of unique) report.set(memberId, memberPushOutcome(byMember.get(memberId) ?? []));
  return report;
}
