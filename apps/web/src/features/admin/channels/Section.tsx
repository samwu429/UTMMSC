import { Navigate, useLocation, useMatch } from 'react-router-dom';
import { SplitView } from '../layout/SplitView';
import { sectionPath } from '../sections';
import { ChannelCreate } from './ChannelCreate';
import { AudiencePicker, ChannelTextEditor, PostPolicyPicker } from './ChannelEditors';
import { NEW_CHANNEL, channelsPath, isChannelScreen } from './channelForm';
import { ChannelList } from './ChannelList';
import { ChannelMemberPicker } from './ChannelMemberPicker';
import { ChannelSettings } from './ChannelSettings';

/**
 * /admin/channels/*: the list, 新建 at /admin/channels/new, a channel's settings at /admin/channels/:id and its
 * editors at /admin/channels/:id/{name,description,audience,post,members}, side by side with the list from 1280px.
 * Any other address under it goes back to the list. Chat info's /admin?tab=channels&channel=<id> lands here through
 * the shell's redirect.
 * /admin/channels/*：列表、位于 /admin/channels/new 的「新建」、位于 /admin/channels/:id 的频道设置，以及
 * /admin/channels/:id/{name,description,audience,post,members} 下的各编辑界面，从 1280px 起与列表并排显示。其下的其他地址回到列表。
 * 聊天信息中的 /admin?tab=channels&channel=<id> 经框架的跳转到达这里。
 */
export function ChannelsSection() {
  const { pathname, search } = useLocation();
  const base = sectionPath('channels');
  const item = useMatch(`${base}/:id`);
  const nested = useMatch(`${base}/:id/:screen`);
  const atList = pathname === base || pathname === `${base}/`;
  const creating = item?.params.id === NEW_CHANNEL;
  const screen = nested && nested.params.id !== NEW_CHANNEL && isChannelScreen(nested.params.screen) ? nested.params.screen : null;
  const id = creating ? null : (item?.params.id ?? (screen ? (nested?.params.id ?? null) : null));
  if (!atList && !creating && !id) return <Navigate to={channelsPath(null, null, search)} replace />;

  let detail = null;
  if (creating) detail = <ChannelCreate />;
  else if (id) {
    if (screen === 'name' || screen === 'description') detail = <ChannelTextEditor key={`${screen}:${id}`} id={id} field={screen} />;
    else if (screen === 'audience') detail = <AudiencePicker key={`audience:${id}`} id={id} />;
    else if (screen === 'post') detail = <PostPolicyPicker key={`post:${id}`} id={id} />;
    else if (screen === 'members') detail = <ChannelMemberPicker key={`members:${id}`} id={id} />;
    else detail = <ChannelSettings key={id} id={id} />;
  }
  return <SplitView detailOpen={creating || id !== null} list={<ChannelList selectedId={id} />} detail={detail} />;
}
