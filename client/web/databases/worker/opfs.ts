/**
 * Minimal OPFS type declarations covering only the subset of the File System
 * Access API that we use.
 *
 * TypeScript's DOM lib doesn't include these yet, so we declare our own interfaces
 * with an `Opfs` prefix to avoid collisions if they're ever added.
 */

export interface OpfsDirectoryHandle {
    getDirectoryHandle(name: string, options?: {create?: boolean}): Promise<OpfsDirectoryHandle>;
    getFileHandle(name: string, options?: {create?: boolean}): Promise<OpfsFileHandle>;
    removeEntry(name: string, options?: {recursive?: boolean}): Promise<void>;
}

export interface OpfsFileHandle {
    createSyncAccessHandle(): Promise<OpfsSyncAccessHandle>;
}

/**
 * Synchronous access handle for OPFS files. Only available in dedicated workers
 * via `FileSystemFileHandle.createSyncAccessHandle()`.
 */
export interface OpfsSyncAccessHandle {
    read(buffer: Uint8Array, options?: {at?: number}): number;
    write(buffer: Uint8Array, options?: {at?: number}): number;
    truncate(size: number): void;
    flush(): void;
    close(): void;
    getSize(): number;
}
