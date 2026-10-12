import { describe, expect, it } from 'vitest';
import { memberRoutes } from './index';

describe('member routes', () => {
  it('matches the feed and profile routes before the member id route', () => {
    const paths = memberRoutes.routes.map((route) => `${route.method} ${route.path}`);
    const feed = paths.indexOf('GET /feed');
    const byId = paths.indexOf('GET /:id');
    expect(feed).toBeGreaterThanOrEqual(0);
    expect(byId).toBeGreaterThan(feed);
    expect(paths).toContain('PATCH /me');
    expect(paths).toContain('POST /me/posts');
  });
});
