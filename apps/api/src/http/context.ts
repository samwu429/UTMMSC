import type { Hono } from 'hono';
import type { Env } from '../env';
import type { MemberRow } from '../infrastructure/d1/members';

export interface Variables {
  member: MemberRow;
  sessionId: string;
}

export type AppEnv = { Bindings: Env; Variables: Variables };
export type App = Hono<AppEnv>;
