import { useEffect, useRef, useState } from 'react';
import { FILE_CATEGORIES, FILE_CATEGORY_LABELS, FILE_MAX_BYTES, hasPermission, type FileCategory, type FileRecord } from '@utmmsc/shared';
import { errorMessage } from '../../../shared/api/errors';
import { formatBytes, formatRelative } from '../../../shared/format/time';
import { useSessionStore } from '../../../shared/session/store';
import { Button } from '../../../shared/ui/Button';
import { EmptyState, Notice, PageTitle, Spinner } from '../../../shared/ui/Card';
import { filesApi } from '../api';

export function FilesPage() {
  const member = useSessionStore((s) => s.member);
  const canUpload = member ? hasPermission(member.role, 'files.upload') : false;
  const canManage = member ? hasPermission(member.role, 'channels.manage') : false;
  const [category, setCategory] = useState<FileCategory>('governance');
  const [files, setFiles] = useState<FileRecord[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
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
    if (!window.confirm(`删除「${file.fileName}」？`)) return;
    try {
      await filesApi.remove(file.id);
      setFiles((prev) => (prev ?? []).filter((f) => f.id !== file.id));
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return (
    <div className="space-y-4">
      <PageTitle
        action={
          canUpload ? (
            <>
              <input ref={inputRef} type="file" className="hidden" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
              <Button variant="secondary" onClick={() => inputRef.current?.click()} loading={uploading} className="py-2">
                上传
              </Button>
            </>
          ) : undefined
        }
      >
        文件
      </PageTitle>
      <div className="flex gap-2 overflow-x-auto">
        {FILE_CATEGORIES.map((c) => (
          <button
            key={c}
            onClick={() => setCategory(c)}
            className={`shrink-0 rounded-full px-4 py-2 text-sm font-medium ${category === c ? 'bg-brand-700 text-white' : 'bg-white text-slate-700'}`}
          >
            {FILE_CATEGORY_LABELS[c]}
          </button>
        ))}
      </div>
      {error ? <Notice tone="error">{error}</Notice> : null}
      {files === null ? <Spinner /> : files.length === 0 ? <EmptyState>这个分类还没有文件</EmptyState> : null}
      {files ? (
        <div className="space-y-2">
          {files.map((file) => (
            <div key={file.id} className="flex items-center gap-3 rounded-2xl bg-white p-3 shadow-sm">
              <button onClick={() => download(file)} className="min-w-0 flex-1 text-left">
                <p className="truncate font-medium">{file.fileName}</p>
                <p className="text-xs text-slate-500">
                  {formatBytes(file.sizeBytes)} · {file.uploadedBy.displayName} · {formatRelative(file.createdAt)}
                </p>
              </button>
              {canManage || file.uploadedBy.id === member?.id ? (
                <button onClick={() => remove(file)} className="text-sm text-red-600">
                  删除
                </button>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
