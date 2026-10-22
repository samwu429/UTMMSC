import { describe, expect, it } from 'vitest';
import { linkify, type LinkSegment } from './linkify';

type Link = Exclude<LinkSegment, { type: 'text' }>;

function links(text: string): Link[] {
  return linkify(text).filter((segment): segment is Link => segment.type !== 'text');
}

function joined(text: string): string {
  return linkify(text)
    .map((segment) => segment.text)
    .join('');
}

describe('linkify urls', () => {
  it('links http and https addresses', () => {
    expect(linkify('看 https://example.com/a?b=1#c 吧')).toEqual([
      { type: 'text', text: '看 ' },
      { type: 'url', text: 'https://example.com/a?b=1#c', href: 'https://example.com/a?b=1#c' },
      { type: 'text', text: ' 吧' },
    ]);
    expect(links('HTTP://EXAMPLE.COM')).toEqual([{ type: 'url', text: 'HTTP://EXAMPLE.COM', href: 'HTTP://EXAMPLE.COM' }]);
  });

  it('prefixes www addresses with https', () => {
    expect(links('go to www.example.com/x.')).toEqual([{ type: 'url', text: 'www.example.com/x', href: 'https://www.example.com/x' }]);
    expect(links('www.example')).toEqual([]);
  });

  it('trims trailing ASCII and CJK punctuation', () => {
    expect(linkify('https://a.com。')).toEqual([
      { type: 'url', text: 'https://a.com', href: 'https://a.com' },
      { type: 'text', text: '。' },
    ]);
    for (const tail of ['，', '！', '？', '）', '】', '」', '.', ',', '!', '?', ')', ';', ':']) {
      expect(links(`https://a.com/x${tail}`)).toEqual([{ type: 'url', text: 'https://a.com/x', href: 'https://a.com/x' }]);
    }
  });

  it('stops at Chinese text written right after the link', () => {
    expect(links('链接https://a.com/path，大家看看')).toEqual([{ type: 'url', text: 'https://a.com/path', href: 'https://a.com/path' }]);
  });

  it('keeps balanced brackets inside a link', () => {
    expect(links('(see https://en.wikipedia.org/wiki/Foo_(bar))')).toEqual([
      { type: 'url', text: 'https://en.wikipedia.org/wiki/Foo_(bar)', href: 'https://en.wikipedia.org/wiki/Foo_(bar)' },
    ]);
  });

  it('never links other schemes', () => {
    expect(links('javascript:alert(1)')).toEqual([]);
    expect(links('data:text/html,<script>alert(1)</script>')).toEqual([]);
    expect(links('vbscript:msgbox(1) file:///etc/passwd ftp://example.com')).toEqual([]);
    expect(links('https://')).toEqual([]);
  });

  it('only produces http, https, mailto and tel links', () => {
    const text = "javascript:alert('http://evil.com') mailto:x@y.com tel:4165551234 www.ok.com data:,x";
    for (const segment of links(text)) {
      expect(segment.href).toMatch(/^(https?:\/\/|mailto:|tel:)/);
    }
    expect(joined(text)).toBe(text);
  });
});

describe('linkify emails', () => {
  it('links addresses', () => {
    expect(linkify('mail a.b@example.co.uk.')).toEqual([
      { type: 'text', text: 'mail ' },
      { type: 'email', text: 'a.b@example.co.uk', href: 'mailto:a.b@example.co.uk' },
      { type: 'text', text: '.' },
    ]);
  });

  it('keeps numeric addresses whole', () => {
    expect(links('QQ:12345678@qq.com')).toEqual([{ type: 'email', text: '12345678@qq.com', href: 'mailto:12345678@qq.com' }]);
  });

  it('ignores incomplete addresses', () => {
    expect(links('@someone and a@b and a@b.c')).toEqual([]);
  });
});

describe('linkify phone numbers', () => {
  it('links numbers with at least seven digits', () => {
    expect(linkify('电话13812345678')).toEqual([
      { type: 'text', text: '电话' },
      { type: 'phone', text: '13812345678', href: 'tel:13812345678' },
    ]);
    expect(links('call +1 (416) 555-1234 now')).toEqual([{ type: 'phone', text: '+1 (416) 555-1234', href: 'tel:+14165551234' }]);
    expect(links('(416) 555-1234')).toEqual([{ type: 'phone', text: '(416) 555-1234', href: 'tel:4165551234' }]);
    expect(links('5551234')).toEqual([{ type: 'phone', text: '5551234', href: 'tel:5551234' }]);
  });

  it('leaves long bare digit runs such as timestamps alone', () => {
    expect(links('id 1792645077017')).toEqual([]);
    expect(links('+8613812345678')).toEqual([{ type: 'phone', text: '+8613812345678', href: 'tel:+8613812345678' }]);
  });

  it('ignores short numbers, dates, decimals and long ids', () => {
    expect(links('123456')).toEqual([]);
    expect(links('2025-10-08')).toEqual([]);
    expect(links('3.1415926')).toEqual([]);
    expect(links('1234567890123456789')).toEqual([]);
    expect(links('v1234567 abc1234567 1234567abc')).toEqual([]);
  });
});

describe('linkify performance', () => {
  it('stays linear on hostile input', () => {
    const samples = [
      'a'.repeat(50_000),
      '1'.repeat(50_000),
      '@'.repeat(50_000),
      'a@'.repeat(25_000),
      'http:////'.repeat(6_000),
      'www.a-'.repeat(9_000),
      '1 '.repeat(25_000),
      `https://a.com/${')'.repeat(50_000)}`,
    ];
    for (const text of samples) {
      const started = performance.now();
      const segments = linkify(text);
      expect(performance.now() - started).toBeLessThan(250);
      expect(segments.map((segment) => segment.text).join('')).toBe(text);
    }
  });
});
