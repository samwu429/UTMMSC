import { useEffect, useRef, useState } from 'react';
import { FILE_CATEGORIES, FILE_CATEGORY_LABELS, FILE_MAX_BYTES, hasPermission, type FileCategory, type FileRecord } from '@utmmsc/shared';
import { errorMessage } from '../../../shared/api/errors';
import { formatBytes, formatRelative } from '../../../shared/format/time';
import { useSessionStore } from '../../../shared/session/store';
import { BackHeader } from '../../../shared/ui/BackHeader';
import { Button } from '../../../shared/ui/Button';
import { EmptyState, List, Notice, Spinner } from '../../../shared/ui/Card';
import { useConfirm } from '../../../shared/ui/confirm';
import { filesApi } from '../api';

export function FilesPage() {
  const member = useSessionStore((s) => s.member);
  const canUpload = member ? hasPermission(member.role, 'files.upload') : false;
  const canManage = member ? hasPermission(member.role, 'channels.manage') : false;
  const [category, setCategory] = useState<FileCategory>('governance');
  const [files, setFiles] = useState<FileRecord[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const ask = useConfirm();
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setFiles(null);
    filesApi
      .list(category)
      .then((res) => setFiles(res.files))
      .catch((err) => setError(errorMessage(err)));
  }, [category]);

  async function upload(file: File) {
    if (file.size > FILE_MAX_BYTES) {
      setError('文件不能超过 25MB');
      return;
    }
    setError(null);
    setUploading(true);
    try {
      const res = await filesApi.upload(category, file);
      setFiles((prev) => [res.file, ...(prev ?? [])]);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  // Downloads require the bearer token, so the blob is fetched then handed to a temporary link.
  // 下载需要 Bearer 令牌，因此先取回 blob 再交给临时链接。
  async function download(file: FileRecord) {
    try {
      const blob = await filesApi.download(file.id);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = file.fileName;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  async function remove(file: FileRecord) {
    const ok = await ask({ title: '删除这个文件？', body: file.fileName, confirmLabel: '删除', danger: true });
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
        label="发现"
        title="文件"
        trailing={
          canUpload ? (
            <>
              <input ref={inputRef} type="file" className="hidden" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
              <Button variant="secondary" onClick={() => inputRef.current?.click()} loading={uploading} className="py-2">
                上传
              </Button>
            </>
          ) : null
        }
      />
      <div className="flex gap-5 overflow-x-auto border-b border-stone-200">
        {FILE_CATEGORIES.map((c) => (
          <button
            key={c}
            onClick={() => setCategory(c)}
            className={`-mb-px shrink-0 border-b-[3px] pb-2 text-[15px] ${category === c ? 'border-gold font-medium text-brand-800' : 'border-transparent text-stone-500'}`}
          >
            {FILE_CATEGORY_LABELS[c]}
          </button>
        ))}
      </div>
      {error ? <Notice tone="error">{error}</Notice> : null}
      {files === null ? <Spinner /> : files.length === 0 ? <EmptyState>这个分类还没有文件</EmptyState> : null}
      {files && files.length > 0 ? (
        <List>
          {files.map((file) => (
            <div key={file.id} className="flex items-center gap-3 py-2 pl-4 pr-2">
              <button onClick={() => download(file)} className="flex min-w-0 flex-1 items-center gap-3 py-1 text-left">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-800">
                  <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden>
                    <path d="M7 3.5h7l5 5V20a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4.5a1 1 0 0 1 1-1Z" />
                    <path d="M14 3.5v5h5" />
                  </svg>
                </span>
                <span className="min-w-0">
                  <span className="block truncate font-medium">{file.fileName}</span>
                  <span className="block text-xs text-stone-500">
                    {formatBytes(file.sizeBytes)} · {file.uploadedBy.displayName} · {formatRelative(file.createdAt)}
                  </span>
                </span>
              </button>
              {canManage || file.uploadedBy.id === member?.id ? (
                <button onClick={() => remove(file)} aria-label={`删除${file.fileName}`} className="flex h-11 w-11 shrink-0 items-center justify-center text-stone-400">
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
