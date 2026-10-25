import { afterEach, describe, expect, it } from 'vitest';
import { useLocaleStore } from '../../i18n/locale';
import { ApiClientError, errorMessage, localizedMessage } from '../errors';
import { ENGLISH } from './admin';

afterEach(() => {
  useLocaleStore.setState({ locale: 'zh' });
});

const HAN = /[一-鿿]/;

describe('admin message English', () => {
  it('has English for every refusal of the admin routes', () => {
    useLocaleStore.setState({ locale: 'en' });
    const refusals = [
      '不能修改自己的身份',
      '不能停用自己',
      '无权分配该身份',
      '无权修改该成员',
      '只有系统管理员可以指定荣誉顾问',
      '只有系统管理员可以修改荣誉顾问',
      '只有系统管理员可以切换测试身份',
      '只有系统管理员可以更正入学年份',
      '只有系统管理员可以查看入学年份申请',
      '只有系统管理员可以处理入学年份申请',
      '只有系统管理员可以邀请校外荣誉顾问',
      '校外荣誉顾问没有入学年份',
      // Already in the core map, and still expected to be covered.
      // 已在核心对照中，仍应有英文。
      '申请不存在或已处理',
      '这个职位已经有人担任',
      '入学已满五年，只能是毕业生',
      '荣誉顾问只能是毕业生',
    ];
    for (const message of refusals) {
      const english = localizedMessage(message);
      expect(english, message).not.toBe(message);
      expect(english, message).not.toMatch(HAN);
    }
    for (const english of Object.values(ENGLISH)) expect(english).not.toMatch(HAN);
  });

  it('names the admin fields in the generic checks, and leaves other fields to the fallback', () => {
    useLocaleStore.setState({ locale: 'en' });
    expect(localizedMessage('身份 取值无效')).toBe('That role is not valid.');
    expect(localizedMessage('决定 取值无效')).toBe('That decision is not valid.');
    expect(localizedMessage('入学年份 必须是整数')).toBe('The enrollment year must be a whole number.');
    expect(localizedMessage('缺少 标题')).toBe('Title is missing.');
    expect(localizedMessage('活动名称 过长')).toBe('The event name is too long.');
    expect(localizedMessage('课程 过长')).toBe('A field is too long.');
  });

  it('keeps Chinese in Chinese', () => {
    expect(errorMessage(new ApiClientError(403, 'forbidden', '无权修改该成员'))).toBe('无权修改该成员');
    useLocaleStore.setState({ locale: 'en' });
    expect(errorMessage(new ApiClientError(403, 'forbidden', '无权修改该成员'))).toBe("You can't change members at or above your level.");
  });
});
