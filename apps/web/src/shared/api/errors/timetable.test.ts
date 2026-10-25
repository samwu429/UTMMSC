import { afterEach, describe, expect, it } from 'vitest';
import { TIMETABLE_MESSAGES } from '@utmmsc/shared';
import { useLocaleStore } from '../../i18n/locale';
import { ApiClientError, errorMessage, localizedMessage } from '../errors';

afterEach(() => {
  useLocaleStore.setState({ locale: 'zh' });
});

describe('timetable message English', () => {
  it('has English for every message the timetable routes send', () => {
    useLocaleStore.setState({ locale: 'en' });
    for (const message of Object.values(TIMETABLE_MESSAGES)) {
      const english = localizedMessage(message);
      expect(english, message).not.toBe(message);
      expect(english).not.toMatch(/[一-鿿]/);
    }
  });

  it('keeps the Chinese text in Chinese', () => {
    expect(errorMessage(new ApiClientError(409, 'id_taken', TIMETABLE_MESSAGES.id_taken))).toBe('这个编号已被使用');
  });

  it('translates a refusal the store reports', () => {
    useLocaleStore.setState({ locale: 'en' });
    expect(errorMessage(new ApiClientError(400, 'too_many_courses', TIMETABLE_MESSAGES.too_many_courses))).toBe('You can have at most 30 courses.');
  });
});
