import type {VfsFile} from "~/shared/databases/install_vfs.js";

/**
 * A {@link VfsFile} backed by a single contiguous buffer in memory. Suitable for
 * temp databases and journals.
 */
export class VfsTempFile implements VfsFile {
    private buffer = new Uint8Array(0);
    private size = 0;

    read(data: Uint8Array, offset: number): boolean {
        if (offset >= this.size) {
            data.fill(0);
            return false;
        }
        const available = Math.min(data.byteLength, this.size - offset);
        data.set(this.buffer.subarray(offset, offset + available));
        if (available < data.byteLength) {
            data.fill(0, available);
            return false;
        }
        return true;
    }

    write(data: Uint8Array, offset: number): void {
        const end = offset + data.byteLength;
        this.ensureCapacity(end);
        this.buffer.set(data, offset);
        if (end > this.size) {
            this.size = end;
        }
    }

    truncate(size: number): void {
        if (size > this.size) {
            this.ensureCapacity(size);
        } else if (size < this.size) {
            this.buffer.fill(0, size, this.size);
        }
        this.size = size;
    }

    sync(): void {}

    fileSize(): number {
        return this.size;
    }

    close(): void {}

    private ensureCapacity(needed: number): void {
        if (needed <= this.buffer.byteLength) return;
        const newBuffer = new Uint8Array(Math.max(this.buffer.byteLength * 2, needed));
        newBuffer.set(this.buffer);
        this.buffer = newBuffer;
    }
}
