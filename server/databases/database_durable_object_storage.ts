import type {DatabaseServerStorage} from "~/server/databases/database_server_storage.js";
import {sqlitePageSize} from "~/shared/databases/sqlite_page_size.js";
import {assert} from "~/shared/helpers/control/assert.js";

/**
 * {@link DatabaseServerStorage} implementation backed by a
 * Cloudflare Durable Object's {@link SqlStorage}. Stores
 * versioned pages in a `pages` table keyed by
 * `(page_index, timestamp)`.
 */
export class DatabaseDurableObjectStorage implements DatabaseServerStorage {
    private readonly sql: SqlStorage;
    private _nextTimestamp: number;

    constructor(sql: SqlStorage) {
        this.sql = sql;
        this.sql.exec(
            `CREATE TABLE IF NOT EXISTS pages (
                page_index INTEGER NOT NULL,
                timestamp INTEGER NOT NULL,
                data BLOB NOT NULL,
                PRIMARY KEY (page_index, timestamp)
            ) WITHOUT ROWID`,
        );

        const maxResult = this.sql.exec<{ts: number | null}>(
            "SELECT MAX(timestamp) AS ts FROM pages",
        );
        const maxRow = maxResult.next();
        this._nextTimestamp = (maxRow.done || maxRow.value.ts === null ? 0 : maxRow.value.ts) + 1;
    }

    readPage(index: number): {data: Uint8Array; timestamp: number} {
        const result = this.sql.exec<{
            data: ArrayBuffer;
            timestamp: number;
        }>(
            "SELECT data, timestamp FROM pages WHERE page_index = ? ORDER BY timestamp DESC LIMIT 1",
            index,
        );
        const row = result.next();
        if (row.done) {
            return {data: new Uint8Array(sqlitePageSize), timestamp: 0};
        }

        assert(result.next().done);
        return {data: new Uint8Array(row.value.data), timestamp: row.value.timestamp};
    }

    writePages(pages: ReadonlyMap<number, Uint8Array>): number {
        const timestamp = Math.max(Date.now(), this._nextTimestamp);
        this._nextTimestamp = timestamp + 1;
        for (const [index, data] of pages) {
            this.sql.exec(
                "INSERT INTO pages (page_index, timestamp, data) VALUES (?, ?, ?)",
                index,
                timestamp,
                data.buffer,
            );
        }
        return timestamp;
    }

    getFileSize(): number {
        const result = this.sql.exec<{page_index: number}>(
            "SELECT page_index FROM pages ORDER BY page_index DESC LIMIT 1",
        );
        const row = result.next();
        if (row.done) {
            return 0;
        }
        assert(result.next().done);
        return (row.value.page_index + 1) * sqlitePageSize;
    }

    truncate(size: number): void {
        const maxPageIndex = Math.floor(size / sqlitePageSize);
        this.sql.exec("DELETE FROM pages WHERE page_index >= ?", maxPageIndex);
    }
}
