import type { ReactNode } from 'react';
import { useTr } from '../../../shared/i18n/locale';
import { CameraIcon, PhotoIcon } from './composerIcons';

function Tile({ label, icon, onClick }: { label: string; icon: ReactNode; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="group flex flex-col items-center gap-1.5 outline-none">
      <span className="flex h-[60px] w-[60px] items-center justify-center rounded-xl bg-white text-wx-ink group-active:bg-wx-pressed group-focus-visible:outline group-focus-visible:outline-2 group-focus-visible:outline-brand-700">
        {icon}
      </span>
      <span className="text-[12px] leading-tight text-wx-meta">{label}</span>
    </button>
  );
}

/**
 * The more-functions panel that takes the keyboard's place. The file inputs live in the composer, so a
 * pick still arrives if the panel closes while the system picker is open.
 * 取代键盘位置的更多功能面板。文件选择框放在输入栏里，即使系统选择器打开期间面板被关闭，选中的图片也不会丢失。
 */
export function PlusPanel({ height, onChoosePhotos, onTakePhoto }: { height: number; onChoosePhotos: () => void; onTakePhoto: () => void }) {
  const tr = useTr();
  return (
    <div
      role="group"
      aria-label={tr('更多功能', 'More')}
      className="box-border shrink-0 overflow-hidden border-t-[0.5px] border-wx-line bg-wx-bar"
      style={{ height, paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      <div className="grid grid-cols-4 gap-y-5 px-5 pt-6">
        <Tile label={tr('相册', 'Photos')} icon={<PhotoIcon />} onClick={onChoosePhotos} />
        <Tile label={tr('拍摄', 'Camera')} icon={<CameraIcon />} onClick={onTakePhoto} />
      </div>
    </div>
  );
}
