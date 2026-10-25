import { useLayoutEffect, useRef, useState, type ChangeEvent, type ReactNode } from 'react';
import { channelIconPresetId, isChannelIconUploadKey, type AdminChannelRow, type ChannelIconPresetId, type ChannelIconResponse } from '@utmmsc/shared';
import { errorMessage } from '../../../shared/api/errors';
import { useTr } from '../../../shared/i18n/locale';
import type { SquareIconFiles } from '../../../shared/media/encodeSquareIcon';
import { ICON_PICK_ACCEPT, IconImageError, iconProblemText, isIconPickType } from '../../../shared/media/squareIcon';
import { ActionSheet, type ActionSheetOption } from '../../../shared/ui/ActionSheet';
import { useConfirm } from '../../../shared/ui/confirm';
import { toast } from '../../../shared/ui/toast';
import { WxSpinner } from '../../../shared/ui/WxSpinner';
import { ChannelIcon } from '../list/ChannelIcon';
import { applyIconResponse, channelIconApi } from './channelIconApi';
import { IconCropScreen } from './IconCropScreen';
import { PresetIconSheet } from './PresetIconSheet';

/**
 * Owner: A-sections, channel icon editing. The 频道图标 row of chat info and of the admin channel settings: static for
 * members who cannot manage the channel, and for managers an ActionSheet to upload, pick a preset or restore the
 * default (admin-design.md 2.8). The same chooser, without saving, serves the optional icon of a new channel.
 * 维护者：A-sections，频道图标编辑。聊天信息和管理后台频道设置中的「频道图标」一行：不能管理频道的成员看到静态的一行；管理者点按后弹出
 * 操作菜单，可上传图片、选择预设或恢复默认图标（见 admin-design.md 2.8）。同一个选择流程（不保存）也用于新频道的可选图标。
 */

type Ask = ReturnType<typeof useConfirm>;

export interface ChannelIconChooserOptions {
  /** Whether there is an icon to give up, which offers 恢复默认图标. */
  /** 是否已有图标可以放弃，有时提供「恢复默认图标」。 */
  hasIcon: boolean;
  /** The preset in use, ringed in the preset sheet. */
  /** 正在使用的预设，在预设弹出层中带外圈。 */
  selectedPreset: ChannelIconPresetId | null;
  /** The cropped image. The crop screen stays open (正在上传…) until it settles and closes on success. */
  /** 裁剪好的图片。裁剪界面保持打开（「正在上传…」）直到完成，成功后关闭。 */
  onFiles: (files: SquareIconFiles) => Promise<void>;
  /** A preset tapped. The sheet closes on success and stays open with the error otherwise. */
  /** 点按了某个预设。成功后弹出层关闭，失败时保持打开并显示错误。 */
  onPreset: (id: ChannelIconPresetId) => Promise<void>;
  onClear: () => void;
  /** The crop screen's wait after encoding; 正在上传… by default. */
  /** 裁剪界面在编码之后等待阶段的文字；默认为「正在上传…」。 */
  waitingLabel?: string;
}

/**
 * The chooser behind a channel icon: 更换频道图标 with 上传图片 (从相册选择 on touch screens), 选择预设图标 and, when an
 * icon is set, 恢复默认图标. The file input lives outside the sheet and is clicked inside the tap that chose the option,
 * so the browser keeps the user gesture (the MediaPicker pattern). Render `elements` once, anywhere.
 * 频道图标背后的选择流程：「更换频道图标」，含「上传图片」（触屏上为「从相册选择」）、「选择预设图标」，以及已有图标时的「恢复默认图标」。
 * 文件输入框位于菜单之外，并在选择该选项的同一次点按中被点击，浏览器因此保留用户手势（MediaPicker 的做法）。`elements` 渲染一次即可，
 * 位置不限。
 */
export function useChannelIconChooser(options: ChannelIconChooserOptions): { open: () => void; elements: ReactNode } {
  const tr = useTr();
  const inputRef = useRef<HTMLInputElement>(null);
  const [menu, setMenu] = useState<{ fine: boolean } | null>(null);
  const [cropFile, setCropFile] = useState<File | null>(null);
  const [presetsOpen, setPresetsOpen] = useState(false);
  const [presetBusy, setPresetBusy] = useState<ChannelIconPresetId | null>(null);
  const latest = useRef(options);
  useLayoutEffect(() => {
    latest.current = options;
  });

  function open() {
    // A fine pointer means a desktop with files to upload; a touch screen picks from its photos.
    // 精确指针意味着桌面电脑上传文件；触屏从相册中选择。
    const fine = typeof window !== 'undefined' && window.matchMedia?.('(pointer: fine)').matches === true;
    setMenu({ fine });
  }

  function onPicked(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null;
    // Emptied after each pick, so the same file can be picked again.
    // 每次选择后清空，同一个文件可以再次选择。
    event.target.value = '';
    if (!file) return;
    if (!isIconPickType(file.type)) {
      toast(iconProblemText(new IconImageError('type'), tr));
      return;
    }
    setCropFile(file);
  }

  async function pickPreset(id: ChannelIconPresetId) {
    if (presetBusy) return;
    setPresetBusy(id);
    try {
      await latest.current.onPreset(id);
      setPresetsOpen(false);
    } catch (err) {
      toast(errorMessage(err));
    } finally {
      setPresetBusy(null);
    }
  }

  const sheetOptions: ActionSheetOption[] = menu
    ? [
        { label: menu.fine ? tr('上传图片', 'Upload an image') : tr('从相册选择', 'Choose from photos'), onSelect: () => inputRef.current?.click() },
        { label: tr('选择预设图标', 'Choose a preset'), onSelect: () => setPresetsOpen(true) },
        ...(options.hasIcon ? [{ label: tr('恢复默认图标', 'Use the default icon'), onSelect: () => latest.current.onClear() }] : []),
      ]
    : [];

  const elements = (
    <>
      <input ref={inputRef} type="file" accept={ICON_PICK_ACCEPT} tabIndex={-1} aria-hidden className="hidden" onChange={onPicked} />
      {menu ? <ActionSheet title={tr('更换频道图标', 'Change channel icon')} options={sheetOptions} onClose={() => setMenu(null)} /> : null}
      {presetsOpen ? (
        <PresetIconSheet
          selected={options.selectedPreset}
          busy={presetBusy}
          onPick={(id) => void pickPreset(id)}
          onClose={() => {
            if (!presetBusy) setPresetsOpen(false);
          }}
        />
      ) : null}
      {cropFile ? (
        <IconCropScreen
          file={cropFile}
          waitingLabel={options.waitingLabel}
          onCancel={() => setCropFile(null)}
          onDone={async (files) => {
            await latest.current.onFiles(files);
            setCropFile(null);
          }}
        />
      ) : null}
    </>
  );

  return { open, elements };
}

export interface ChannelIconEditorProps {
  channelId: string;
  /** channel-icon/ upload, preset:<id>, or null for the text tile. */
  /** channel-icon/ 下的上传图标、preset:<id>，或 null 表示文字头像。 */
  iconKey: string | null;
  canManage: boolean;
  /** Called with the new key after the server saved it, and the channel as the server now has it. */
  /** 服务器保存后，以新的键以及服务器当前的频道数据调用。 */
  onChange: (iconKey: string | null, channel: AdminChannelRow) => void;
  /** The channel name, whose first character the text tile shows. */
  /** 频道名称，文字头像显示其首字。 */
  name?: string;
  /** The confirmation sheet to ask with; admin passes the one its desktop keys know about. */
  /** 用于询问的确认层；管理后台传入其桌面快捷键能识别的那一个。 */
  ask?: Ask;
}

function Chevron() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0 text-stone-400" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="m9 5 7 7-7 7" />
    </svg>
  );
}

/**
 * The 频道图标 row with a 32 px icon at the end. For managers a tap opens the chooser; every change is saved at once,
 * then the chat list refreshes and `onChange` reports the new key. Replacing an uploaded image with the default
 * asks first, since the image is deleted.
 * 末尾带 32px 图标的「频道图标」一行。管理者点按后打开选择流程；每次修改都立即保存，之后聊天列表刷新，`onChange` 回报新的键。
 * 把上传的图片换回默认图标前会先询问，因为图片会被删除。
 */
export function ChannelIconEditor({ channelId, iconKey, canManage, onChange, name = '', ask }: ChannelIconEditorProps): JSX.Element {
  const tr = useTr();
  const appConfirm = useConfirm();
  const confirm = ask ?? appConfirm;
  const [clearing, setClearing] = useState(false);

  function saved(response: ChannelIconResponse, message: string) {
    applyIconResponse(response);
    onChange(response.channel.iconKey ?? null, response.channel);
    toast(message);
  }

  async function clear() {
    if (clearing || !iconKey) return;
    if (isChannelIconUploadKey(iconKey)) {
      const ok = await confirm({
        title: tr('恢复默认图标？', 'Use the default icon?'),
        body: tr('上传的图片会被删除。', 'The uploaded image will be deleted.'),
        confirmLabel: tr('恢复', 'Use default'),
        danger: true,
      });
      if (!ok) return;
    }
    setClearing(true);
    try {
      saved(await channelIconApi.clear(channelId), tr('已恢复默认图标', 'Default icon restored'));
    } catch (err) {
      toast(errorMessage(err));
    } finally {
      setClearing(false);
    }
  }

  const chooser = useChannelIconChooser({
    hasIcon: iconKey !== null,
    selectedPreset: channelIconPresetId(iconKey),
    onFiles: async (files) => saved(await channelIconApi.upload(channelId, files), tr('频道图标已更新', 'Channel icon updated')),
    onPreset: async (id) => saved(await channelIconApi.preset(channelId, id), tr('频道图标已更新', 'Channel icon updated')),
    onClear: () => void clear(),
  });

  const content = (
    <span className="flex min-h-14 w-full items-center gap-3 px-4 py-2.5">
      <span className="min-w-0 flex-1 truncate text-[17px] leading-6 text-wx-ink">{tr('频道图标', 'Channel icon')}</span>
      {clearing ? <WxSpinner label={tr('正在保存', 'Saving')} /> : <ChannelIcon name={name} iconKey={iconKey} size={32} />}
      {canManage ? <Chevron /> : null}
    </span>
  );

  if (!canManage) return <div>{content}</div>;
  return (
    <>
      <button type="button" onClick={chooser.open} disabled={clearing} aria-haspopup="dialog" className="block w-full text-left outline-offset-[-2px] active:bg-wx-pressed">
        {content}
      </button>
      {chooser.elements}
    </>
  );
}
