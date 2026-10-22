import { describe, expect, it } from 'vitest';
import { chatRoutes } from './index';

describe('chat routes', () => {
  const paths = chatRoutes.routes.map((route) => `${route.method} ${route.path}`);

  it('exposes translate beside the room routes', () => {
    expect(paths).toContain('POST /translate');
    expect(paths).toContain('POST /rooms/:roomId/ticket');
  });

  it('exposes room info, members, prefs, read and clear', () => {
    expect(paths).toContain('GET /rooms/:roomId/info');
    expect(paths).toContain('GET /rooms/:roomId/members');
    expect(paths).toContain('PATCH /rooms/:roomId/prefs');
    expect(paths).toContain('POST /rooms/:roomId/read');
    expect(paths).toContain('POST /rooms/:roomId/clear');
  });
});
