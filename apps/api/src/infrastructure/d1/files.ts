import type { FileCategory, FileRecord } from '@utmmsc/shared';
import { randomId } from '../../domain/crypto/encoding';
import { nowIso } from './time';

export interface FileRow {
  id: string;
  category: FileCategory;
  object_key: string;
  file_name: string;
  content_type: string;
  size_bytes: number;
  uploaded_by: string;
  created_at: string;
  uploader_name: string;
}

export function toFileRecord(row: FileRow): FileRecord {
  return {
    id: row.id,
    category: row.category,
    fileName: row.file_name,
    contentType: row.content_type,
    sizeBytes: row.size_bytes,
    uploadedBy: { id: row.uploaded_by, displayName: row.uploader_name },
    createdAt: row.created_at,
  };
}

const SELECT = `SELECT f.*, m.display_name AS uploader_name FROM files f JOIN members m ON m.id = f.uploaded_by`;

export async function listFiles(db: D1Database, category: FileCategory): Promise<FileRow[]> {
  const result = await db.prepare(`${SELECT} WHERE f.category = ? ORDER BY f.created_at DESC LIMIT 500`).bind(category).all<FileRow>();
  return result.results;
}

export async function findFile(db: D1Database, id: string): Promise<FileRow | null> {
  return db.prepare(`${SELECT} WHERE f.id = ?`).bind(id).first<FileRow>();
}

export interface CreateFileInput {
  category: FileCategory;
  objectKey: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  uploadedBy: string;
}

export async function createFile(db: D1Database, input: CreateFileInput): Promise<FileRow> {
  const id = randomId('file');
  await db
    .prepare(
      `INSERT INTO files (id, category, object_key, file_name, content_type, size_bytes, uploaded_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(id, input.category, input.objectKey, input.fileName, input.contentType, input.sizeBytes, input.uploadedBy, nowIso())
    .run();
  const row = await findFile(db, id);
  if (!row) throw new Error('file insert did not persist');
  return row;
}

export async function deleteFile(db: D1Database, id: string): Promise<void> {
  await db.prepare('DELETE FROM files WHERE id = ?').bind(id).run();
}
