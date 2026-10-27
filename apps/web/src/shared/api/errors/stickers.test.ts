import { afterEach, describe, expect, it } from 'vitest';
import { STICKER_MESSAGES } from '@utmmsc/shared';
import { useLocaleStore } from '../../i18n/locale';
import { ApiClientError, errorMessage, localizedMessage } from '../errors';
import { ENGLISH, ENGLISH_PATTERNS } from './stickers';

afterEach(() => {
  useLocaleStore.setState({ locale: 'zh' });
});

describe('sticker message English', () => {
  it('has English for every STICKER_MESSAGES value, and nothing else', () => {
    const values = Object.values(STICKER_MESSAGES);
    for (const message of values) expect(ENGLISH[message], message).toBeTruthy();
    expect(Object.keys(ENGLISH).sort()).toEqual([...values].sort());
    expect(ENGLISH_PATTERNS).toEqual([]);
  });

  it('reaches every message through the merged map, in plain English', () => {
    useLocaleStore.setState({ locale: 'en' });
    for (const message of Object.values(STICKER_MESSAGES)) {
      const english = localizedMessage(message);
      expect(english, message).toBe(ENGLISH[message]);
      expect(english).not.toMatch(/[一-鿿]/);
    }
  });

  it('names the same numbers as the Chinese', () => {
    useLocaleStore.setState({ locale: 'en' });
    expect(localizedMessage(STICKER_MESSAGES.tooLarge)).toBe('Stickers must be 8 MB or smaller.');
    expect(localizedMessage(STICKER_MESSAGES.dimensions)).toBe('The image is too large. Each side can be at most 2048 pixels.');
    expect(localizedMessage(STICKER_MESSAGES.animatedSize)).toBe('Animated stickers can be at most 1024 pixels on each side.');
    expect(localizedMessage(STICKER_MESSAGES.frames)).toBe('Animated stickers can have at most 300 frames.');
    expect(localizedMessage(STICKER_MESSAGES.full)).toBe('You can have up to 999 stickers. Delete some first.');
    for (const key of ['tooLarge', 'dimensions', 'animatedSize', 'frames', 'full'] as const) {
      const zhNumbers = STICKER_MESSAGES[key].match(/\d+/g);
      const enNumbers = (ENGLISH[STICKER_MESSAGES[key]] ?? '').match(/\d+/g);
      expect(enNumbers, key).toEqual(zhNumbers);
    }
  });

  it('translates the errors the routes and the room answer with', () => {
    useLocaleStore.setState({ locale: 'en' });
    expect(errorMessage(new ApiClientError(409, 'sticker_full', STICKER_MESSAGES.full))).toBe('You can have up to 999 stickers. Delete some first.');
    expect(errorMessage(new ApiClientError(503, 'schema_pending', STICKER_MESSAGES.pending))).toBe("Stickers aren't available yet.");
    expect(localizedMessage(STICKER_MESSAGES.notFound)).toBe('This sticker is no longer available.');
  });

  it('keeps Chinese in Chinese', () => {
    expect(localizedMessage(STICKER_MESSAGES.daily)).toBe('今天上传的表情太多了，请明天再试');
  });
});
