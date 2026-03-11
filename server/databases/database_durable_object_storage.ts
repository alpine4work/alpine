import type {DatabaseServerStorage} from "~/server/databases/database_server_storage.js";
import {sqlitePageSize} from "~/shared/databases/sqlite_constants.js";
import {assert} from "~/shared/helpers/control/assert.js";

/**
 * {@link DatabaseServerStorage} implementation backed by a
 * Cloudflare Durable Object's {@link SqlStorage}. Stores
 * versioned pages in a `pages` table keyed by
 * `(page_index, timestamp)`.
 */
export class DatabaseDurableObjectStorage implements DatabaseServerStorage {
    private readonly sql: SqlStorage;
    private lastWriteTimestamp: number | null = null;
    private _fileSize: number | null = null;

    constructor(sql: SqlStorage) {
        this.sql = sql;
        this.sql.exec(
            `CREATE TABLE IF NOT EXISTS pages (
                page_index INTEGER NOT NULL,
                timestamp INTEGER NOT NULL,
                data BLOB,
                PRIMARY KEY (page_index, timestamp)
            ) WITHOUT ROWID`,
        );
    }

    readPage(index: number): {data: Uint8Array | null; timestamp: number} | null {
        const result = this.sql.exec<{
            data: ArrayBuffer | null;
            timestamp: number;
        }>(
            "SELECT data, timestamp FROM pages WHERE page_index = ? ORDER BY timestamp DESC LIMIT 1",
            index,
        );
        const row = result.next();
        if (row.done) {
            return null;
        }

        assert(result.next().done);
        return {
            data: row.value.data !== null ? new Uint8Array(row.value.data) : null,
            timestamp: row.value.timestamp,
        };
    }

    writePages(pages: ReadonlyMap<number, Uint8Array>): number {
        const timestamp = this.nextTimestamp();
        for (const [index, data] of pages) {
            this.sql.exec(
                "INSERT INTO pages (page_index, timestamp, data) VALUES (?, ?, ?)",
                index,
                timestamp,
                data.buffer,
            );
            const end = (index + 1) * sqlitePageSize;
            if (end > this.getFileSize()) {
                this._fileSize = end;
            }
        }
        return timestamp;
    }

    private nextTimestamp(): number {
        const prev = this.getLastWriteTimestamp();
        const timestamp = Math.max(Date.now(), prev + 1);
        this.lastWriteTimestamp = timestamp;
        return timestamp;
    }

    private getLastWriteTimestamp(): number {
        if (this.lastWriteTimestamp !== null) {
            return this.lastWriteTimestamp;
        }
        const result = this.sql.exec<{ts: number | null}>("SELECT MAX(timestamp) AS ts FROM pages");
        const row = result.next();
        const ts = row.done || row.value.ts === null ? 0 : row.value.ts;
        this.lastWriteTimestamp = ts;
        return ts;
    }

    getFileSize(): number {
        if (this._fileSize !== null) {
            return this._fileSize;
        }
        const result = this.sql.exec<{page_index: number}>(
            `SELECT p.page_index FROM pages p
             WHERE p.timestamp = (SELECT MAX(p2.timestamp) FROM pages p2 WHERE p2.page_index = p.page_index)
               AND p.data IS NOT NULL
             ORDER BY p.page_index DESC
             LIMIT 1`,
        );
        const row = result.next();
        if (row.done) {
            this._fileSize = 0;
            return 0;
        }
        assert(result.next().done);
        this._fileSize = (row.value.page_index + 1) * sqlitePageSize;
        return this._fileSize;
    }

    truncate(size: number): void {
        const maxPageIndex = Math.floor(size / sqlitePageSize);
        const timestamp = this.nextTimestamp();
        for (const {page_index} of this.sql.exec<{page_index: number}>(
            "SELECT DISTINCT page_index FROM pages WHERE page_index >= ?",
            maxPageIndex,
        )) {
            this.sql.exec(
                "INSERT INTO pages (page_index, timestamp, data) VALUES (?, ?, NULL)",
                page_index,
                timestamp,
            );
        }
        this._fileSize = size;
    }
}
