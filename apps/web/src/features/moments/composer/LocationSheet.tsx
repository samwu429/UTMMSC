import { useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { LOCATION_MAX } from '@utmmsc/shared';
import { useTr } from '../../../shared/i18n/locale';
import { useSessionStore } from '../../../shared/session/store';
import { LocationIcon } from '../icons';
import { CheckMark, ComposerSheet } from './AudienceSheet';
import { composeDrafts, normalizePlace } from './drafts';

export interface LocationSheetProps {
  value: string | null;
  onChange(location: string | null): void;
  onClose(): void;
}

function Row({ label, detail, selected, onSelect }: { label: string; detail?: string; selected: boolean; onSelect: () => void }) {
  return (
    <li>
      <button type="button" onClick={onSelect} aria-pressed={selected} className="flex w-full items-center bg-white pl-4 text-left active:bg-wx-pressed">
        <span className="flex min-h-14 min-w-0 flex-1 items-center gap-3 border-b-[0.5px] border-wx-line py-2 pr-4">
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[17px] leading-snug text-wx-ink">{label}</span>
            {detail ? <span className="mt-0.5 block text-[13px] leading-snug text-wx-meta">{detail}</span> : null}
          </span>
          {selected ? <CheckMark /> : null}
        </span>
      </button>
    </li>
  );
}

/**
 * 所在位置: free text of at most 40 characters, the last five places published from this device, the place on
 * the member's profile as a suggestion, and 不显示位置. GPS is never requested. With nothing to suggest, the
 * field takes focus at once (open the sheet inside the tap, with flushSync, so the keyboard rises).
 * 所在位置：最多 40 个字的自由文本、本设备最近发表时用过的五个地点、成员资料中的所在地作为建议，以及「不显示位置」。从不请求 GPS。
 * 没有可建议的内容时输入框立即获得焦点（在点击中以 flushSync 打开面板，键盘才会弹出）。
 */
export function LocationSheet({ value, onChange, onClose }: LocationSheetProps) {
  const tr = useTr();
  const member = useSessionStore((s) => s.member);
  const inputRef = useRef<HTMLInputElement>(null);
  const [recent] = useState<string[]>(() => (member ? composeDrafts.recentPlaces(member.id) : []));
  const [input, setInput] = useState(value ?? '');
  const profilePlace = normalizePlace(member?.location ?? '') || null;
  const sameAs = (a: string | null, b: string | null) => a !== null && b !== null && a.toLocaleLowerCase() === b.toLocaleLowerCase();
  const suggestion = profilePlace && !recent.some((place) => sameAs(place, profilePlace)) ? profilePlace : null;
  const typed = normalizePlace(input);
  const nothingToSuggest = !suggestion && recent.length === 0;

  useLayoutEffect(() => {
    if (nothingToSuggest) inputRef.current?.focus({ preventScroll: true });
    // Only when the sheet opens.
    // 只在面板打开时执行。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function choose(place: string | null) {
    onChange(place ? normalizePlace(place) || null : null);
    onClose();
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== 'Enter' || event.nativeEvent.isComposing || event.keyCode === 229) return;
    event.preventDefault();
    if (typed) choose(typed);
  }

  return (
    <ComposerSheet
      title={tr('所在位置', 'Location')}
      onClose={onClose}
      trailing={
        <button type="button" disabled={!typed} onClick={() => choose(typed)} className="group flex h-11 items-center px-2">
          <span className="flex h-8 items-center rounded-[4px] bg-brand-800 px-3 text-[15px] font-medium text-white group-active:bg-brand-900 group-disabled:bg-wx-pressed group-disabled:text-wx-meta">
            {tr('完成', 'Done')}
          </span>
        </button>
      }
    >
      <div className="bg-white px-4 py-3">
        <label className="flex h-10 items-center gap-2 rounded-md bg-wx-canvas px-3 text-wx-meta">
          <LocationIcon className="h-5 w-5 shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={input}
            maxLength={LOCATION_MAX}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={onKeyDown}
            placeholder={tr('输入所在位置', 'Enter a place')}
            aria-label={tr('所在位置', 'Location')}
            enterKeyHint="done"
            autoComplete="off"
            className="min-w-0 flex-1 bg-transparent text-[16px] text-wx-ink outline-none placeholder:text-wx-meta focus-visible:outline-none"
          />
        </label>
      </div>
      <ul className="border-t-[0.5px] border-wx-line">
        <Row label={tr('不显示位置', "Don't show location")} selected={value === null} onSelect={() => choose(null)} />
        {suggestion ? <Row label={suggestion} detail={tr('来自你的资料', 'From your profile')} selected={sameAs(value, suggestion)} onSelect={() => choose(suggestion)} /> : null}
      </ul>
      {recent.length ? (
        <>
          <p className="bg-wx-canvas px-4 pb-1.5 pt-3 text-[13px] text-wx-meta">{tr('最近使用', 'Recent')}</p>
          <ul>
            {recent.map((place) => (
              <Row key={place} label={place} selected={sameAs(value, place)} onSelect={() => choose(place)} />
            ))}
          </ul>
        </>
      ) : null}
    </ComposerSheet>
  );
}
