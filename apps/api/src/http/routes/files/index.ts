import { Hono } from 'hono';
import { FILE_MAX_BYTES, hasPermission, isFileCategory, type FileListResponse } from '@utmmsc/shared';
import { createFile, deleteFile, findFile, listFiles, toFileRecord } from '../../../infrastructure/d1/files';
import { viewedRole } from '../../../infrastructure/d1/members';
import { deleteObject, getObject, libraryObjectKey, putObject } from '../../../infrastructure/r2/objects';
import { requireBucket } from '../../bindings';
import type { AppEnv } from '../../context';
import { badRequest, forbidden, notFound } from '../../errors';
import { rateLimit } from '../../middleware/rate-limit';
import { requirePermission, requireSession } from '../../middleware/session';
import { decodeKeyPath } from '../../validation';

export const fileRoutes = new Hono<AppEnv>();

fileRoutes.use('*', requireSession);

function categoryParam(value: string) {
  if (!isFileCategory(value)) throw notFound('分类不存在');
  return value;
}

fileRoutes.get('/category/:category', requirePermission('files.view'), async (c) => {
  const category = categoryParam(c.req.param('category'));
  const rows = await listFiles(c.env.DB, category);
  const response: FileListResponse = { files: rows.map(toFileRecord) };
  return c.json(response);
});

/**
 * Upload is a raw body with the file name in a header; this avoids multipart parsing and keeps
 * the Worker's memory footprint flat.
 * 上传为原始请求体，文件名放在请求头；避免 multipart 解析并保持 Worker 内存平稳。
 */
fileRoutes.post('/category/:category', rateLimit(20, 60_000), requirePermission('files.upload'), async (c) => {
  const category = categoryParam(c.req.param('category'));
  const rawName = c.req.header('x-file-name');
  const fileName = rawName ? decodeKeyPath(rawName).trim() : '';
  if (!fileName || fileName.length > 200) throw badRequest('missing_file_name', '缺少文件名');
  const contentType = c.req.header('content-type') || 'application/octet-stream';
  const declared = Number(c.req.header('content-length') ?? '0');
  if (declared > FILE_MAX_BYTES) throw badRequest('too_large', '文件不能超过 25MB');

  const bucket = requireBucket(c.env);
  // The header can lie or be absent (chunked uploads), so the real body size is what counts.
  // 请求头可能不准或缺失（分块上传），以实际正文大小为准。
  const bytes = await c.req.arrayBuffer();
  const sizeBytes = bytes.byteLength;
  if (!sizeBytes) throw badRequest('empty_file', '文件为空');
  if (sizeBytes > FILE_MAX_BYTES) throw badRequest('too_large', '文件不能超过 25MB');
  const objectKey = libraryObjectKey(category, fileName);
  await putObject(bucket, objectKey, bytes, contentType);
  const row = await createFile(c.env.DB, { category, objectKey, fileName, contentType, sizeBytes, uploadedBy: c.get('member').id });
  return c.json({ file: toFileRecord(row) }, 201);
});

fileRoutes.get('/:id/download', requirePermission('files.view'), async (c) => {
  const row = await findFile(c.env.DB, c.req.param('id'));
  if (!row) throw notFound('文件不存在');
  const object = await getObject(requireBucket(c.env), row.object_key);
  if (!object) throw notFound('文件不存在');
  return new Response(object.body, {
    headers: {
      'content-type': row.content_type,
      'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(row.file_name)}`,
      'cache-control': 'private, no-store',
      'x-content-type-options': 'nosniff',
    },
  });
});

fileRoutes.delete('/:id', async (c) => {
  const member = c.get('member');
  const row = await findFile(c.env.DB, c.req.param('id'));
  if (!row) throw notFound('文件不存在');
  const ownFile = row.uploaded_by === member.id;
  if (!ownFile && !hasPermission(viewedRole(member), 'channels.manage')) throw forbidden('只能删除自己上传的文件');
  await deleteObject(requireBucket(c.env), row.object_key);
  await deleteFile(c.env.DB, row.id);
  return c.json({ ok: true });
});
