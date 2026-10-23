import { DurableObject } from 'cloudflare:workers';
import type { Env } from '../../env';
import { deliverJobs } from './deliver';
import type { DeliveryJob, JobOutcome } from './types';

/**
 * Stateless helper object. Each call is its own invocation with its own outbound-request allowance
 * (50 on the free plan), so a notice to every member is split into chunks sent through here instead
 * of exceeding the caller's allowance. It stores nothing.
 * 无状态的辅助对象。每次调用都是一次独立的调用，拥有自己的外发请求额度（免费套餐为 50 次），
 * 因此发给全体成员的通知会被分块经由这里发送，而不会超出调用方的额度。它不保存任何数据。
 */
export class PushRelay extends DurableObject<Env> {
  async deliver(jobs: DeliveryJob[]): Promise<JobOutcome[]> {
    return deliverJobs(this.env, jobs);
  }
}
