import { useRef } from 'react';
import { PRESET_AVATARS, presetAvatarKey, type PresetAvatarId, type PresetAvatarMotion } from '@utmmsc/shared';
import { useTr } from '../../shared/i18n/locale';
import { useReducedMotion } from '../../shared/media/reducedMotion';
import { Button } from '../../shared/ui/Button';
import { presetAvatarSrc } from './media';

const AVATAR_EN: Record<PresetAvatarId, string> = {
  'woman-cute-gold': 'Woman · Cute · Gold',
  'woman-cool-purple': 'Woman · Cool · Purple',
  'man-cute-purple': 'Man · Cute · Purple',
  'man-cool-gold': 'Man · Cool · Gold',
};

export function AvatarChooser({
  currentKey,
  busy,
  onPreset,
  onUpload,
  onRemove,
}: {
  currentKey: string | null;
  busy: boolean;
  onPreset: (id: PresetAvatarId, motion: PresetAvatarMotion) => void;
  onUpload: (file: File) => void;
  onRemove: () => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const tr = useTr();
  // The 256 px files: the chooser draws them at 96 px. With reduced motion the animated choice previews as its still.
  // 使用 256px 文件：头像选择以 96px 显示。减弱动态效果时，动态选项以静态图预览。
  const reducedMotion = useReducedMotion();

  return (
    <div>
      <div className="space-y-4">
        {PRESET_AVATARS.map((item) => (
          <div key={item.id}>
            <p className="mb-2 text-sm font-medium text-brand-800">{tr(item.label, AVATAR_EN[item.id])}</p>
            <div className="grid grid-cols-2 gap-3">
              {(['animated', 'still'] as const).map((motion) => {
                const selected = currentKey === presetAvatarKey(item.id, motion);
                return (
                  <button key={motion} type="button" disabled={busy} onClick={() => onPreset(item.id, motion)} className="flex flex-col items-center gap-1.5 disabled:opacity-50">
                    <img
                      src={presetAvatarSrc(item.id, motion, 256, reducedMotion)}
                      alt=""
                      width={96}
                      height={96}
                      decoding="async"
                      className={`h-24 w-24 rounded-full object-cover ring-2 ${selected ? 'ring-gold' : 'ring-stone-200'}`}
                    />
                    <span className={`text-sm ${selected ? 'font-medium text-brand-800' : 'text-stone-500'}`}>{motion === 'animated' ? tr('动态', 'Animated') : tr('静态', 'Still')}</span>
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
      <Button type="button" variant="secondary" block className="mt-5" disabled={busy} onClick={() => fileRef.current?.click()}>
        {tr('从相册上传', 'Upload a photo')}
      </Button>
      {currentKey ? (
        <button type="button" disabled={busy} onClick={onRemove} className="mt-3 min-h-11 w-full text-sm text-stone-400 disabled:opacity-50">
          {tr('去掉头像', 'Remove profile photo')}
        </button>
      ) : null}
      <input
        ref={fileRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/gif"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (file) onUpload(file);
        }}
      />
    </div>
  );
}
