import { afterEach, describe, expect, it } from 'vitest';
import { useLocaleStore } from '../../i18n/locale';
import { ApiClientError, errorMessage, localizedMessage } from '../errors';
import { ENGLISH } from './channelIcons';

afterEach(() => {
  useLocaleStore.setState({ locale: 'zh' });
});

/** CHANNEL_ICON_MESSAGES of apps/api/src/http/routes/channels/index.ts, copied here so a rename shows up. */
/** apps/api/src/http/routes/channels/index.ts 中的 CHANNEL_ICON_MESSAGES，复制到这里，改名时能发现。 */
const SERVER_ICON_MESSAGES = ['图标只支持 WebP 或 JPEG', '图标尺寸不对，请重新选择', '图标不能超过 256KB', '没有这个预设图标', '频道图标暂不可用', '图标刚被别人修改，请重试'];

describe('channel message English', () => {
  it('has plain English for every message in the map', () => {
    useLocaleStore.setState({ locale: 'en' });
    for (const message of Object.keys(ENGLISH)) {
      const english = localizedMessage(message);
      expect(english, message).not.toBe(message);
      expect(english).not.toMatch(/[一-鿿]/);
    }
  });

  it('covers every message of the icon routes', () => {
    useLocaleStore.setState({ locale: 'en' });
    for (const message of SERVER_ICON_MESSAGES) expect(ENGLISH[message], message).toBeTruthy();
    expect(errorMessage(new ApiClientError(409, 'icon_conflict', '图标刚被别人修改，请重试'))).toBe('Someone else just changed the icon. Try again.');
    expect(errorMessage(new ApiClientError(503, 'schema_pending', '频道图标暂不可用'))).toBe("Channel icons aren't available yet.");
  });

  it('names the channel fields in the generic checks', () => {
    useLocaleStore.setState({ locale: 'en' });
    expect(localizedMessage('缺少 频道名称')).toBe('Channel name is missing.');
    expect(localizedMessage('缺少 缩略图')).toBe('Thumbnail is missing.');
    expect(localizedMessage('频道名称 过长')).toBe('The channel name is too long.');
    expect(localizedMessage('频道简介 过长')).toBe('The channel description is too long.');
    expect(localizedMessage('受众 取值无效')).toBe("That audience isn't valid.");
    expect(localizedMessage('发言规则 取值无效')).toBe("That posting rule isn't valid.");
    // Other routes' fields still reach their own maps or the fallback.
    // 其他接口的字段仍交给各自的对照或兜底处理。
    expect(localizedMessage('缺少 标题')).toBe('Title is missing.');
    expect(localizedMessage('缺少 某字段')).toBe('A required field is missing.');
  });

  it('keeps Chinese in Chinese', () => {
    expect(localizedMessage('图标不能超过 256KB')).toBe('图标不能超过 256KB');
  });
});
