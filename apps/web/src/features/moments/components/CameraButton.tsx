import type { RefObject } from 'react';
import { useTr } from '../../../shared/i18n/locale';
import { ActionSheet } from '../../../shared/ui/ActionSheet';
import { useLongPress, type LongPressInfo } from '../../../shared/ui/useLongPress';
import type { MediaPickerHandle } from '../composer/MediaPicker';
import { useOpenOnRelease } from '../hooks/useOpenOnRelease';
import { CameraIcon } from '../icons';

export interface CameraButtonProps {
  /** Tap: the post sheet. */
  /** 轻触：打开发表菜单。 */
  onOpenSheet(): void;
  /** Long press, or ContextMenu / Shift+F10: a text-only post. Called inside a user gesture. */
  /** 长按，或 ContextMenu / Shift+F10：发纯文字。在用户手势中调用。 */
  onTextOnly(): void;
}

/**
 * The header camera. A tap opens the post sheet; a long press opens the text composer, as in WeChat. The
 * long press fires while the finger is still down, from a timer, where iOS will not raise the keyboard, so
 * the composer opens on that press's release instead, which is a user gesture.
 * 顶栏的相机。轻触打开发表菜单；与微信一样，长按直接打开纯文字编辑器。长按是在手指仍按着时由计时器触发的，iOS 在那时不会弹出键盘，
 * 因此改为在这次按压松开时打开编辑器，松开属于用户手势。
 */
export function CameraButton({ onOpenSheet, onTextOnly }: CameraButtonProps) {
  const tr = useTr();
  const openOnRelease = useOpenOnRelease(onTextOnly);

  const { handlers, pressed } = useLongPress({
    onLongPress: (info: LongPressInfo) => {
      if (info.held) openOnRelease();
      else onTextOnly();
    },
  });

  return (
    <button
      type="button"
      {...handlers}
      onClick={onOpenSheet}
      aria-label={tr('发表动态', 'Post an update')}
      aria-haspopup="dialog"
      className={`flex h-11 w-11 select-none items-center justify-center [-webkit-touch-callout:none] ${pressed ? 'opacity-60' : ''}`}
    >
      <CameraIcon className="h-6 w-6" />
    </button>
  );
}

export interface PostSheetProps {
  /** The page's hidden inputs; each option clicks one inside the sheet's own click, keeping the user gesture. */
  /** 页面上的隐藏输入框；每个选项都在菜单自身的点击中触发其中一个，从而保留用户手势。 */
  picker: RefObject<MediaPickerHandle>;
  onTextOnly(): void;
  onClose(): void;
}

/** Take photo, record video, choose from library, or text only. */
/** 拍照 · 录像 · 从相册选择 · 只发文字。 */
export function PostSheet({ picker, onTextOnly, onClose }: PostSheetProps) {
  const tr = useTr();
  return (
    <ActionSheet
      onClose={onClose}
      options={[
        { label: tr('拍照', 'Take photo'), onSelect: () => picker.current?.takePhoto() },
        { label: tr('录像', 'Record video'), onSelect: () => picker.current?.recordVideo() },
        { label: tr('从相册选择', 'Choose from library'), onSelect: () => picker.current?.chooseFromLibrary() },
        { label: tr('只发文字', 'Text only'), onSelect: onTextOnly },
      ]}
    />
  );
}
