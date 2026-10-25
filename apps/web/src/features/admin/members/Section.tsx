import { Navigate, useLocation, useMatch } from 'react-router-dom';
import { SplitView } from '../layout/SplitView';
import { sectionPath } from '../sections';
import { MemberDetail } from './MemberDetail';
import { MemberList } from './MemberList';
import { membersPath } from './memberRules';
import { RolePicker, StatusPicker, YearPicker } from './Pickers';

/** The screens under a member: /admin/members/:id/<screen>. */
/** 成员之下的界面：/admin/members/:id/<界面>。 */
const MEMBER_SCREENS = ['role', 'year', 'status'] as const;
type MemberScreen = (typeof MEMBER_SCREENS)[number];

function isMemberScreen(value: string | undefined): value is MemberScreen {
  return MEMBER_SCREENS.some((screen) => screen === value);
}

/**
 * /admin/members/*: the list, a member at /admin/members/:id and its pickers (role, year, status), side by side with
 * the list from 1280px. Any other address under it goes back to the list.
 * /admin/members/*：列表、位于 /admin/members/:id 的成员及其选择界面（身份、年份、状态），从 1280px 起与列表并排显示。其下的其他地址
 * 回到列表。
 */
export function MembersSection() {
  const { pathname, search } = useLocation();
  const base = sectionPath('members');
  const member = useMatch(`${base}/:id`);
  const nested = useMatch(`${base}/:id/:screen`);
  const screen = isMemberScreen(nested?.params.screen) ? nested?.params.screen : null;
  const id = member?.params.id ?? (screen ? (nested?.params.id ?? null) : null);
  const atList = pathname === base || pathname === `${base}/`;
  if (!atList && !id) return <Navigate to={membersPath(undefined, search)} replace />;

  let detail = null;
  if (id) {
    if (screen === 'role') detail = <RolePicker key={`role:${id}`} id={id} />;
    else if (screen === 'year') detail = <YearPicker key={`year:${id}`} id={id} />;
    else if (screen === 'status') detail = <StatusPicker key={`status:${id}`} id={id} />;
    else detail = <MemberDetail key={id} id={id} />;
  }
  return <SplitView detailOpen={id !== null} list={<MemberList selectedId={id} />} detail={detail} />;
}
