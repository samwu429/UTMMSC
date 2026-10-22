import type { StateStorage } from 'zustand/middleware';

type StorageBackend = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

/** StateStorage whose reads always return synchronously, so persisted stores hydrate during create. */
/** 读取总是同步返回的 StateStorage，持久化 store 在创建时即完成恢复。 */
export interface SyncStateStorage extends StateStorage<void> {
  getItem: (name: string) => string | null;
}

/**
 * Storage for zustand persist (via createJSONStorage) that never throws. Private browsing, blocked site
 * data, a full quota or a missing localStorage all read as null and drop the write, so chat keeps working
 * with in-memory state. The backend is looked up on every call, never at import time.
 * 供 zustand persist（通过 createJSONStorage）使用、永不抛错的存储。无痕模式、站点数据被禁用、空间已满或
 * 没有 localStorage 时，读取一律返回 null，写入被丢弃，聊天继续使用内存中的状态。每次调用时才获取底层存储，导入时不访问。
 */
export function createSafeStorage(backend: () => StorageBackend | null | undefined): SyncStateStorage {
  return {
    getItem(name) {
      try {
        return backend()?.getItem(name) ?? null;
      } catch {
        return null;
      }
    },
    setItem(name, value) {
      try {
        backend()?.setItem(name, value);
      } catch {
        // The value stays in memory only.
        // 该值只保留在内存中。
      }
    },
    removeItem(name) {
      try {
        backend()?.removeItem(name);
      } catch {
        // Nothing was stored, or storage is blocked.
        // 没有存过，或存储被禁用。
      }
    },
  };
}

export const safeLocalStorage: SyncStateStorage = createSafeStorage(() => globalThis.localStorage);
