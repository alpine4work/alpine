import type {DatabaseServerStorage} from "~/server/databases/database_server_storage.js";
import {sqlitePageSize} from "~/shared/databases/sqlite_constants.js";
import {assert} from "~/shared/helpers/control/assert.js";

/**
 * {@link DatabaseServerStorage} implementation backed by a
 * Cloudflare Durable Object's {@link SqlStorage}. Stores
 * versioned pages in a `pages` table keyed by
 * `(page_index, version)`.
 */
export class DatabaseDurableObjectStorage implements DatabaseServerStorage {
    private readonly sql: SqlStorage;
    private lastWriteVersion: number | null = null;
    private _fileSize: number | null = null;

    constructor(sql: SqlStorage) {
        this.sql = sql;
        this.sql.exec(
            `CREATE TABLE IF NOT EXISTS pages (
                page_index INTEGER NOT NULL,
                version INTEGER NOT NULL,
                data BLOB,
                PRIMARY KEY (page_index, version)
            ) WITHOUT ROWID`,
        );
    }

    readPage(index: number): {data: Uint8Array | null; version: number} | null {
        const result = this.sql.exec<{
            data: ArrayBuffer | null;
            version: number;
        }>(
            "SELECT data, version FROM pages WHERE page_index = ? ORDER BY version DESC LIMIT 1",
            index,
        );
        const row = result.next();
        if (row.done) {
            return null;
        }

        assert(result.next().done);
        return {
            data: row.value.data !== null ? new Uint8Array(row.value.data) : null,
            version: row.value.version,
        };
    }

    writePages(pages: ReadonlyMap<number, Uint8Array>): number {
        const version = this.nextVersion();
        for (const [index, data] of pages) {
            this.sql.exec(
                "INSERT INTO pages (page_index, version, data) VALUES (?, ?, ?)",
                index,
                version,
                data.buffer,
            );
            const end = (index + 1) * sqlitePageSize;
            if (end > this.getFileSize()) {
                this._fileSize = end;
            }
        }
        return version;
    }

    private nextVersion(): number {
        const prev = this.getLastWriteVersion();
        const version = prev + 1;
        this.lastWriteVersion = version;
        return version;
    }

    private getLastWriteVersion(): number {
        if (this.lastWriteVersion !== null) {
            return this.lastWriteVersion;
        }
        const result = this.sql.exec<{v: number | null}>("SELECT MAX(version) AS v FROM pages");
        const row = result.next();
        const v = row.done || row.value.v === null ? 0 : row.value.v;
        this.lastWriteVersion = v;
        return v;
    }

    getFileSize(): number {
        if (this._fileSize !== null) {
            return this._fileSize;
        }
        const result = this.sql.exec<{page_index: number}>(
            `SELECT p.page_index FROM pages p
             WHERE p.version = (SELECT MAX(p2.version) FROM pages p2 WHERE p2.page_index = p.page_index)
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
        const version = this.nextVersion();
        for (const {page_index} of this.sql.exec<{page_index: number}>(
            "SELECT DISTINCT page_index FROM pages WHERE page_index >= ?",
            maxPageIndex,
        )) {
            this.sql.exec(
                "INSERT INTO pages (page_index, version, data) VALUES (?, ?, NULL)",
                page_index,
                version,
            );
        }
        this._fileSize = size;
    }
}
