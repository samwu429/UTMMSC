import { useRef } from 'react';
import { PRESET_AVATARS, presetAvatarKey, type PresetAvatarId } from '@utmmsc/shared';
import { Button } from '../../shared/ui/Button';

export function AvatarChooser({
  currentKey,
  busy,
  onPreset,
  onUpload,
  onRemove,
}: {
  currentKey: string | null;
  busy: boolean;
  onPreset: (id: PresetAvatarId) => void;
  onUpload: (file: File) => void;
  onRemove: () => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);

  return (
    <div>
      <div className="grid grid-cols-2 gap-x-3 gap-y-4">
        {PRESET_AVATARS.map((item) => {
          const selected = currentKey === presetAvatarKey(item.id);
          return (
            <button key={item.id} type="button" disabled={busy} onClick={() => onPreset(item.id)} className="flex flex-col items-center gap-2 disabled:opacity-50">
              <img
                src={`${import.meta.env.BASE_URL}avatars/${item.id}.gif`}
                alt=""
                className={`h-28 w-28 rounded-full object-cover ring-2 ${selected ? 'ring-gold' : 'ring-stone-200'}`}
              />
              <span className={`text-sm ${selected ? 'font-medium text-brand-800' : 'text-stone-600'}`}>{item.label}</span>
            </button>
          );
        })}
      </div>
      <Button type="button" variant="secondary" block className="mt-5" disabled={busy} onClick={() => fileRef.current?.click()}>
        从相册上传
      </Button>
      {currentKey ? (
        <button type="button" disabled={busy} onClick={onRemove} className="mt-3 min-h-11 w-full text-sm text-stone-400 disabled:opacity-50">
          去掉头像
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
