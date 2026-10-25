import { afterEach, describe, expect, it } from 'vitest';
import { useLocaleStore } from '../../i18n/locale';
import { ApiClientError, errorMessage, localizedMessage } from '../errors';
import { ENGLISH } from './media';

afterEach(() => {
  useLocaleStore.setState({ locale: 'zh' });
});

describe('media message English', () => {
  it('has plain English for every message in the map', () => {
    useLocaleStore.setState({ locale: 'en' });
    for (const message of Object.keys(ENGLISH)) {
      const english = localizedMessage(message);
      expect(english, message).not.toBe(message);
      expect(english).not.toMatch(/[一-鿿]/);
    }
  });

  it('reads the limit from the avatar and cover size messages', () => {
    useLocaleStore.setState({ locale: 'en' });
    expect(errorMessage(new ApiClientError(400, 'too_large', '头像不能超过 8MB'))).toBe('Profile photos must be 8MB or smaller.');
    expect(localizedMessage('头像不能超过 1MB')).toBe('Profile photos must be 1MB or smaller.');
    expect(localizedMessage('封面不能超过 8MB')).toBe('Covers must be 8MB or smaller.');
    expect(localizedMessage('头像只支持 JPEG、PNG、WebP、GIF')).toBe('Profile photos must be JPEG, PNG, WebP, or GIF.');
  });

  it('keeps Chinese in Chinese', () => {
    expect(localizedMessage('头像不能超过 8MB')).toBe('头像不能超过 8MB');
  });
});
