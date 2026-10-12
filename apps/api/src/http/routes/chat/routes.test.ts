import { describe, expect, it } from 'vitest';
import { chatRoutes } from './index';

describe('chat routes', () => {
  it('exposes translate beside the room routes', () => {
    const paths = chatRoutes.routes.map((route) => `${route.method} ${route.path}`);
    expect(paths).toContain('POST /translate');
    expect(paths).toContain('POST /rooms/:roomId/ticket');
  });
});
