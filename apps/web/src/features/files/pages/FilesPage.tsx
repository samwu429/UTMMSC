import { useEffect, useRef, useState } from 'react';
import { FILE_CATEGORIES, FILE_MAX_BYTES, hasPermission, type FileCategory, type FileRecord } from '@utmmsc/shared';
import { errorMessage } from '../../../shared/api/errors';
import { useLabels } from '../../../shared/i18n/locale';
import { formatBytes, formatRelative } from '../../../shared/format/time';
import { saveFile } from '../../../shared/native/native';
import { useSessionStore } from '../../../shared/session/store';
import { BackHeader } from '../../../shared/ui/BackHeader';
import { Button } from '../../../shared/ui/Button';
import { EmptyState, List, Notice, Spinner } from '../../../shared/ui/Card';
import { useConfirm } from '../../../shared/ui/confirm';
import { toast } from '../../../shared/ui/toast';
import { filesApi } from '../api';

export function FilesPage() {
  const member = useSessionStore((s) => s.member);
  const canUpload = member ? hasPermission(member.role, 'files.upload') : false;
  const canManage = member ? hasPermission(member.role, 'channels.manage') : false;
  const [category, setCategory] = useState<FileCategory>('governance');
  const [files, setFiles] = useState<FileRecord[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const ask = useConfirm();
  const { tr, fileCategory } = useLabels();
  const inputRef = useRef<HTMLInputElement>(null);

  const categoryRef = useRef(category);
  categoryRef.current = category;

  useEffect(() => {
    let cancelled = false;
    setFiles(null);
    setError(null);
    filesApi
      .list(category)
      .then((res) => {
        if (!cancelled) setFiles(res.files);
      })
      .catch((err) => {
        if (!cancelled) setError(errorMessage(err));
      });
    return () => {
      cancelled = true;
    };
  }, [category]);

  async function upload(file: File) {
    if (file.size > FILE_MAX_BYTES) {
      setError(tr('文件不能超过 25MB', 'Files must be 25MB or smaller'));
      return;
    }
    setError(null);
    setUploading(true);
    try {
      const target = category;
      const res = await filesApi.upload(target, file);
      // The user may have switched tabs during the upload.
      // 上传期间用户可能已切换分类。
      if (categoryRef.current === target) setFiles((prev) => [res.file, ...(prev ?? [])]);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  // Downloads require the bearer token, so the blob is fetched first, then saved by the browser or, in
  // the Android app, handed to the share sheet. The row says 下载中… meanwhile, so a large file is not tapped again.
  // 下载需要 Bearer 令牌，因此先取回 blob，再由浏览器保存，安卓 App 内则交给分享面板。期间该行显示「下载中…」，大文件不会被重复点击。
  async function download(file: FileRecord) {
    if (downloadingId) return;
    setDownloadingId(file.id);
    try {
      const blob = await filesApi.download(file.id);
      const saved = await saveFile(blob, file.fileName, file.contentType).then(
        () => true,
        () => false,
      );
      if (!saved) toast(tr('保存失败', 'Couldn’t save the file'), { ms: 2500 });
    } catch (err) {
      toast(errorMessage(err), { ms: 2500 });
    } finally {
      setDownloadingId(null);
    }
  }

  async function remove(file: FileRecord) {
    const ok = await ask({ title: tr('删除这个文件？', 'Delete this file?'), body: file.fileName, confirmLabel: tr('删除', 'Delete'), danger: true });
    if (!ok) return;
    try {
      await filesApi.remove(file.id);
      setFiles((prev) => (prev ?? []).filter((f) => f.id !== file.id));
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return (
    <div className="space-y-4">
      <BackHeader
        to="/discover"
        label={tr('发现', 'Discover')}
        title={tr('文件', 'Files')}
        trailing={
          canUpload ? (
            <>
              <input ref={inputRef} type="file" className="hidden" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
              <Button variant="secondary" onClick={() => inputRef.current?.click()} loading={uploading} className="py-2">
                {tr('上传', 'Upload')}
              </Button>
            </>
          ) : null
        }
      />
      <div role="tablist" className="flex gap-5 overflow-x-auto border-b border-stone-200">
        {FILE_CATEGORIES.map((c) => (
          <button
            key={c}
            type="button"
            role="tab"
            aria-selected={category === c}
            onClick={() => setCategory(c)}
            className={`-mb-px min-h-11 shrink-0 border-b-[3px] pb-2 pt-3 text-[15px] ${category === c ? 'border-gold font-medium text-brand-800' : 'border-transparent text-stone-500'}`}
          >
            {fileCategory(c)}
          </button>
        ))}
      </div>
      {error ? <Notice tone="error">{error}</Notice> : null}
      {files === null ? <Spinner /> : files.length === 0 ? <EmptyState>{tr('这个分类还没有文件', 'Nothing in this category yet')}</EmptyState> : null}
      {files && files.length > 0 ? (
        <List>
          {files.map((file) => (
            <div key={file.id} className="flex items-center gap-3 py-2 pl-4 pr-2">
              <button
                type="button"
                onClick={() => void download(file)}
                disabled={downloadingId !== null}
                aria-busy={downloadingId === file.id}
                className={`flex min-w-0 flex-1 items-center gap-3 py-1 text-left ${downloadingId !== null && downloadingId !== file.id ? 'opacity-60' : ''}`}
              >
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-800">
                  <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden>
                    <path d="M7 3.5h7l5 5V20a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4.5a1 1 0 0 1 1-1Z" />
                    <path d="M14 3.5v5h5" />
                  </svg>
                </span>
                <span className="min-w-0">
                  <span className="block truncate font-medium">{file.fileName}</span>
                  <span className="block text-xs text-stone-500">
                    {downloadingId === file.id
                      ? tr(`下载中… ${formatBytes(file.sizeBytes)}`, `Downloading… ${formatBytes(file.sizeBytes)}`)
                      : `${formatBytes(file.sizeBytes)} · ${file.uploadedBy.displayName} · ${formatRelative(file.createdAt)}`}
                  </span>
                </span>
              </button>
              {canManage || file.uploadedBy.id === member?.id ? (
                <button onClick={() => remove(file)} aria-label={tr(`删除${file.fileName}`, `Delete ${file.fileName}`)} className="flex h-11 w-11 shrink-0 items-center justify-center text-stone-400">
                  <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" aria-hidden>
                    <path d="M5 7h14M9 7V5h6v2M8 7l.7 12h6.6L16 7" />
                  </svg>
                </button>
              ) : null}
            </div>
          ))}
        </List>
      ) : null}
    </div>
  );
}
