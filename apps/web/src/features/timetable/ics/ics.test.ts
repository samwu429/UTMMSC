import { describe, expect, it } from 'vitest';
import {
  CRLF,
  escapeIcsText,
  foldIcsLine,
  formatIcsLocal,
  formatIcsUtc,
  icsInstant,
  icsLine,
  parseIcsDateTime,
  parseIcsDateTimes,
  parseIcsDuration,
  parseIcsLine,
  resolveIcsZone,
  torontoWallTime,
  unescapeIcsText,
  unfoldIcs,
} from './ics';

// Written with code points so the source stays plain ASCII.
// 用码点写出，源文件因此保持纯 ASCII。
const GRIN = String.fromCodePoint(0x1f600);
const BOM = String.fromCharCode(0xfeff);

function octets(text: string): number {
  return new TextEncoder().encode(text).length;
}

describe('text escaping', () => {
  it('escapes backslash, semicolon, comma and line breaks', () => {
    expect(escapeIcsText('a\\b;c,d\ne\r\nf')).toBe('a\\\\b\\;c\\,d\\ne\\nf');
  });

  it('reads escapes back in one pass', () => {
    expect(unescapeIcsText('a\\\\b\\;c\\,d\\ne\\Nf')).toBe('a\\b;c,d\ne\nf');
    // An escaped backslash before n is a backslash and an n, not a line break.
    // 转义的反斜杠后面跟着 n 是反斜杠加 n，不是换行。
    expect(unescapeIcsText('C:\\\\new')).toBe('C:\\new');
  });

  it('round-trips any text', () => {
    const text = 'Notes; with, commas\\ and\nlines \u4e2d\u6587' + GRIN;
    expect(unescapeIcsText(escapeIcsText(text))).toBe(text);
  });
});

describe('folding', () => {
  it('keeps every physical line within 75 octets and starts continuations with a space', () => {
    const line = `DESCRIPTION:${'x'.repeat(200)}`;
    const folded = foldIcsLine(line);
    const parts = folded.split(CRLF);
    expect(parts.length).toBeGreaterThan(2);
    for (const part of parts) expect(octets(part)).toBeLessThanOrEqual(75);
    for (const part of parts.slice(1)) expect(part.startsWith(' ')).toBe(true);
    expect(unfoldIcs(folded)).toEqual([line]);
  });

  it('never splits a Chinese character or an emoji', () => {
    const line = `SUMMARY:${'\u8bfe'.repeat(40)}${GRIN.repeat(10)}`;
    const parts = foldIcsLine(line).split(CRLF);
    for (const part of parts) {
      expect(octets(part)).toBeLessThanOrEqual(75);
      // A broken surrogate pair or a cut UTF-8 sequence would not survive the round trip.
      // 被拆开的代理对或被截断的 UTF-8 序列无法通过往返。
      expect(new TextDecoder().decode(new TextEncoder().encode(part))).toBe(part);
    }
    expect(unfoldIcs(parts.join(CRLF))).toEqual([line]);
  });

  it('leaves a short line alone', () => {
    expect(foldIcsLine('VERSION:2.0')).toBe('VERSION:2.0');
  });

  it('unfolds CRLF, LF and CR files, tabs as continuation, and drops a byte-order mark and blank lines', () => {
    expect(unfoldIcs(`${BOM}BEGIN:VCALENDAR\r\nSUMMARY:a\r\n b\r\n\tc\n\nEND:VCALENDAR\rX:1`)).toEqual(['BEGIN:VCALENDAR', 'SUMMARY:abc', 'END:VCALENDAR', 'X:1']);
  });
});

describe('content lines', () => {
  it('reads names, parameters and values, quoted or not', () => {
    expect(parseIcsLine('dtstart;tzid=America/Toronto:20260908T100000')).toEqual({
      name: 'DTSTART',
      params: { TZID: 'America/Toronto' },
      value: '20260908T100000',
    });
    expect(parseIcsLine('DTSTART;TZID="(UTC-05:00) Eastern Time (US & Canada)":20260908T100000')).toEqual({
      name: 'DTSTART',
      params: { TZID: '(UTC-05:00) Eastern Time (US & Canada)' },
      value: '20260908T100000',
    });
    expect(parseIcsLine('ATTENDEE;MEMBER="mailto:a@x",b;ROLE=CHAIR:mailto:c@x')).toEqual({
      name: 'ATTENDEE',
      params: { MEMBER: 'mailto:a@x,b', ROLE: 'CHAIR' },
      value: 'mailto:c@x',
    });
    expect(parseIcsLine('DESCRIPTION:a: b')?.value).toBe('a: b');
  });

  it('refuses a line without a value or with an unclosed quote', () => {
    expect(parseIcsLine('NOVALUE')).toBeNull();
    expect(parseIcsLine(':x')).toBeNull();
    expect(parseIcsLine('X;P="open:1')).toBeNull();
  });

  it('writes parameters, quoting those with separators', () => {
    expect(icsLine('DTSTART', '20260908T100000', { TZID: 'America/Toronto' })).toBe('DTSTART;TZID=America/Toronto:20260908T100000');
    expect(icsLine('X', 'v', { P: 'a:b' })).toBe('X;P="a:b":v');
  });
});

describe('date-time values', () => {
  it('reads DATE, local, UTC and zoned values', () => {
    expect(parseIcsDateTime('20261031')).toEqual({ date: '2026-10-31', minute: null, second: 0, utc: false, tzid: null });
    expect(parseIcsDateTime('20261031T235900')).toEqual({ date: '2026-10-31', minute: 1439, second: 0, utc: false, tzid: null });
    expect(parseIcsDateTime('20261031T035900Z', 'America/Toronto')).toEqual({ date: '2026-10-31', minute: 239, second: 0, utc: true, tzid: null });
    expect(parseIcsDateTime('20260908T100030', 'America/Toronto')).toEqual({ date: '2026-09-08', minute: 600, second: 30, utc: false, tzid: 'America/Toronto' });
  });

  it('refuses impossible values and accepts a leap second', () => {
    expect(parseIcsDateTime('20260230')).toBeNull();
    expect(parseIcsDateTime('20260230T100000')).toBeNull();
    expect(parseIcsDateTime('20260908T240000')).toBeNull();
    expect(parseIcsDateTime('20260908T106000')).toBeNull();
    expect(parseIcsDateTime('2026-09-08')).toBeNull();
    expect(parseIcsDateTime('20261231T235960Z')?.second).toBe(59);
  });

  it('reads every value of a list with the property zone', () => {
    const property = parseIcsLine('EXDATE;TZID=America/Toronto:20261012T100000,20261019T100000,bad');
    expect(property && parseIcsDateTimes(property).map((value) => value.date)).toEqual(['2026-10-12', '2026-10-19']);
  });

  it('formats local and UTC values', () => {
    expect(formatIcsLocal('2026-09-08', 600)).toBe('20260908T100000');
    expect(formatIcsUtc(Date.UTC(2026, 11, 4, 4, 59, 59))).toBe('20261204T045959Z');
  });
});

describe('zones', () => {
  it('reads IANA, Windows, prefixed and descriptive names', () => {
    expect(resolveIcsZone('America/Toronto')).toBe('America/Toronto');
    expect(resolveIcsZone('Eastern Standard Time')).toBe('America/Toronto');
    expect(resolveIcsZone('/mozilla.org/20050126_1/America/Toronto')).toBe('America/Toronto');
    expect(resolveIcsZone('(UTC-05:00) Eastern Time (US & Canada)')).toBe('America/Toronto');
    expect(resolveIcsZone('China Standard Time')).toBe('Asia/Shanghai');
    expect(resolveIcsZone('Asia/Shanghai')).toBe('Asia/Shanghai');
    expect(resolveIcsZone('Nowhere Special')).toBeNull();
    expect(resolveIcsZone('')).toBeNull();
  });

  it('turns any value into Toronto wall time', () => {
    const utc = parseIcsDateTime('20261031T035900Z');
    const toronto = parseIcsDateTime('20260908T100000', 'America/Toronto');
    const floating = parseIcsDateTime('20260908T100000');
    const shanghai = parseIcsDateTime('20260908T220000', 'Asia/Shanghai');
    const outlook = parseIcsDateTime('20261103T100000', 'Eastern Standard Time');
    const custom = parseIcsDateTime('20260908T100000', 'My Zone');
    expect(utc && torontoWallTime(utc)).toEqual({ date: '2026-10-30', minute: 1439 });
    expect(toronto && torontoWallTime(toronto)).toEqual({ date: '2026-09-08', minute: 600 });
    expect(floating && torontoWallTime(floating)).toEqual({ date: '2026-09-08', minute: 600 });
    expect(shanghai && torontoWallTime(shanghai)).toEqual({ date: '2026-09-08', minute: 600 });
    // After the November switch Toronto is UTC-5; Outlook's Windows name still means Toronto.
    // 十一月切换之后多伦多为 UTC-5；Outlook 的 Windows 时区名仍表示多伦多。
    expect(outlook && torontoWallTime(outlook)).toEqual({ date: '2026-11-03', minute: 600 });
    // A file's own VTIMEZONE names win over guessing; unknown names read as Toronto.
    // 文件自己的 VTIMEZONE 名称优先于猜测；无法识别的名称按多伦多时间读取。
    expect(custom && torontoWallTime(custom, new Map([['My Zone', 'Asia/Shanghai']]))).toEqual({ date: '2026-09-07', minute: 1320 });
    expect(custom && torontoWallTime(custom)).toEqual({ date: '2026-09-08', minute: 600 });
  });

  it('has no instant for a DATE value', () => {
    const date = parseIcsDateTime('20261031');
    expect(date && icsInstant(date)).toBeNull();
    expect(date && torontoWallTime(date)).toBeNull();
  });
});

describe('durations', () => {
  it('reads weeks, days, hours, minutes and seconds, with a sign', () => {
    expect(parseIcsDuration('PT1H30M')).toBe(90 * 60_000);
    expect(parseIcsDuration('P1D')).toBe(86_400_000);
    expect(parseIcsDuration('-P1W')).toBe(-7 * 86_400_000);
    expect(parseIcsDuration('+PT50M')).toBe(50 * 60_000);
    expect(parseIcsDuration('P1DT2H')).toBe(26 * 3_600_000);
  });

  it('refuses empty or broken values', () => {
    expect(parseIcsDuration('P')).toBeNull();
    expect(parseIcsDuration('PT')).toBeNull();
    expect(parseIcsDuration('1H')).toBeNull();
  });
});
