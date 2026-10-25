import { afterEach, describe, expect, it } from 'vitest';
import { useLocaleStore } from '../i18n/locale';
import { ApiClientError, errorMessage, localizedMessage } from './errors';

afterEach(() => {
  useLocaleStore.setState({ locale: 'zh' });
});

describe('server message English', () => {
  it('keeps Chinese as it is', () => {
    expect(localizedMessage('课表提醒 格式错误')).toBe('课表提醒 格式错误');
  });

  it('translates exact messages, the 课表提醒 switch included', () => {
    useLocaleStore.setState({ locale: 'en' });
    expect(localizedMessage('课表提醒 格式错误')).toBe('The timetable reminder setting was not valid.');
    expect(localizedMessage('好友动态互动通知 格式错误')).toBe('The friend update activity setting was not valid.');
    expect(errorMessage(new ApiClientError(400, 'invalid_field', '频道不存在'))).toBe('That channel does not exist.');
  });

  it('tries the specific patterns before the catch-all ones', () => {
    useLocaleStore.setState({ locale: 'en' });
    expect(localizedMessage('你已被禁言 5 分钟')).toBe('You have been muted for 5 minutes.');
    expect(localizedMessage('某个字段 格式错误')).toBe('A field is not valid.');
    expect(localizedMessage('没有对照的消息')).toBe('没有对照的消息');
  });

  it('falls back for errors that are not from the API', () => {
    useLocaleStore.setState({ locale: 'en' });
    expect(errorMessage(new TypeError('Failed to fetch'))).toBe('The network request failed. Check your connection and try again.');
    expect(errorMessage(new Error('boom'))).toBe('Something went wrong. Try again in a moment.');
  });
});
