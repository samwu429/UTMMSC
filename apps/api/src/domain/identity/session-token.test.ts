import { describe, expect, it } from 'vitest';
import { issueSessionToken, readSessionToken } from './session-token';
import { issueRoomTicket, readRoomTicket } from './room-ticket';

const SECRET = 'test-secret-with-enough-entropy-for-hmac';

describe('session tokens', () => {
  it('round-trips claims', async () => {
    const expires = new Date(Date.now() + 60_000);
    const token = await issueSessionToken(SECRET, 'ses_1', 'mem_1', expires);
    const claims = await readSessionToken(SECRET, token);
    expect(claims).toMatchObject({ sid: 'ses_1', mid: 'mem_1' });
  });

  it('rejects expired tokens', async () => {
    const token = await issueSessionToken(SECRET, 'ses_1', 'mem_1', new Date(Date.now() - 1));
    expect(await readSessionToken(SECRET, token)).toBeNull();
  });

  it('rejects tampered or foreign-key tokens', async () => {
    const token = await issueSessionToken(SECRET, 'ses_1', 'mem_1', new Date(Date.now() + 60_000));
    expect(await readSessionToken('other-secret', token)).toBeNull();
    const [body, sig] = token.split('.');
    expect(await readSessionToken(SECRET, `${body}x.${sig}`)).toBeNull();
    expect(await readSessionToken(SECRET, 'not-a-token')).toBeNull();
  });
});

describe('room tickets', () => {
  it('carries room and posting rights and expires after one minute', async () => {
    const now = new Date();
    const ticket = await issueRoomTicket(
      SECRET,
      { roomId: 'channel:ch_all', memberId: 'mem_1', displayName: 'Sam', role: 'student', canPost: true },
      now,
    );
    const claims = await readRoomTicket(SECRET, ticket, now);
    expect(claims).toMatchObject({ roomId: 'channel:ch_all', memberId: 'mem_1', canPost: true });
    const later = new Date(now.getTime() + 61_000);
    expect(await readRoomTicket(SECRET, ticket, later)).toBeNull();
  });

  it('does not accept a session token as a room ticket', async () => {
    const token = await issueSessionToken(SECRET, 'ses_1', 'mem_1', new Date(Date.now() + 60_000));
    expect(await readRoomTicket(SECRET, token)).toBeNull();
  });
});
