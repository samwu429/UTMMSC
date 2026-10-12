import { describe, expect, it } from 'vitest';
import { TRANSLATE_MAX_BYTES, planTranslation, translationFromGoogle, translationFromMyMemory } from './translate';

describe('planTranslation', () => {
  it('pairs Chinese and English in either direction', () => {
    expect(planTranslation('  你好，在吗  ')).toMatchObject({ ok: true, text: '你好，在吗', pair: 'zh-CN|en', source: 'zh-CN', target: 'en' });
    expect(planTranslation('Hello there')).toMatchObject({ ok: true, pair: 'en|zh-CN', source: 'en', target: 'zh-CN' });
    expect(planTranslation('Hello 你好')).toMatchObject({ pair: 'zh-CN|en' });
  });

  it('rejects empty and over-long text before any request', () => {
    expect(planTranslation('   ')).toEqual({ ok: false, error: 'empty' });
    expect(planTranslation('a'.repeat(TRANSLATE_MAX_BYTES + 1))).toEqual({ ok: false, error: 'too_long' });
    expect(planTranslation('中'.repeat(200))).toEqual({ ok: false, error: 'too_long' });
    expect(planTranslation('a'.repeat(TRANSLATE_MAX_BYTES))).toMatchObject({ ok: true });
  });
});

describe('translationFromMyMemory', () => {
  it('decodes a successful translation', () => {
    expect(
      translationFromMyMemory({
        responseStatus: 200,
        responseData: { translatedText: 'It&#39;s ok' },
      }),
    ).toBe("It's ok");
  });

  it('rejects quota warnings and bad payloads', () => {
    expect(
      translationFromMyMemory({
        responseStatus: 200,
        responseData: { translatedText: 'MYMEMORY WARNING: YOU USED ALL AVAILABLE FREE TRANSLATIONS FOR TODAY' },
      }),
    ).toBeNull();
    expect(translationFromMyMemory({ responseStatus: 429, responseData: { translatedText: 'secret' } })).toBeNull();
    expect(translationFromMyMemory(null)).toBeNull();
    expect(translationFromMyMemory({ responseStatus: 200, responseData: {} })).toBeNull();
  });
});

describe('translationFromGoogle', () => {
  it('joins every segment', () => {
    expect(translationFromGoogle([[['Hello', '你好'], [' there', '啊']]])).toBe('Hello there');
  });

  it('rejects a payload that is not a translation', () => {
    expect(translationFromGoogle(null)).toBeNull();
    expect(translationFromGoogle([[['ok', '好'], 'nope']])).toBeNull();
  });
});
