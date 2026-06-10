/* eslint-disable cyberworlds/string-quotes -- SQL literals */

import sqlite3InitModule from "~/external/sqlite/ext/wasm/jswasm/sqlite3.mjs";
import {installVfs} from "~/shared/databases/install_vfs.js";
import {VfsTempFile} from "~/shared/databases/vfs_temp_file.js";
import {InternalError} from "~/shared/error/error.js";

const sqlite3Promise = sqlite3InitModule();

let vfsCounter = 0;

function nextVfsName(): string {
    return `test-vfs-${vfsCounter++}`;
}

describe("installVfs", () => {
    test("basic database operations work through custom VFS", async () => {
        const sqlite3 = await sqlite3Promise;
        const file = new VfsTempFile();

        installVfs(sqlite3, nextVfsName(), {
            open: () => file,
            delete() {},
            access: () => false,
        });
    });

    test("database created with custom VFS can execute queries", async () => {
        const sqlite3 = await sqlite3Promise;
        const file = new VfsTempFile();
        const name = nextVfsName();

        installVfs(sqlite3, name, {
            open: () => file,
            delete() {},
            access: () => false,
        });

        const db = new sqlite3.oo1.DB("/test.db", "ct", name);
        db.exec("CREATE TABLE t (id INTEGER PRIMARY KEY, val TEXT)");

        db.exec("INSERT INTO t VALUES (1, 'hello')");

        expect(db.selectArray("SELECT val FROM t")).toEqual(["hello"]);
        db.close();
    });

    describe("error stashing", () => {
        test("takeError returns null when no error", async () => {
            const sqlite3 = await sqlite3Promise;
            const file = new VfsTempFile();

            const vfs = installVfs(sqlite3, nextVfsName(), {
                open: () => file,
                delete() {},
                access: () => false,
            });

            expect(vfs.takeError()).toBeNull();
        });

        test("error thrown in open is stashed", async () => {
            const sqlite3 = await sqlite3Promise;
            const name = nextVfsName();
            const testError = new InternalError("open failed");

            const vfs = installVfs(sqlite3, name, {
                open: () => {
                    throw testError;
                },
                delete() {},
                access: () => false,
            });

            expect(() => new sqlite3.oo1.DB("/fail.db", "ct", name)).toThrow();
            expect(vfs.takeError()).toBe(testError);
        });

        test("error thrown in VfsFile write is stashed", async () => {
            const sqlite3 = await sqlite3Promise;
            const name = nextVfsName();
            const testError = new InternalError("write failed");
            let shouldThrow = false;

            const vfs = installVfs(sqlite3, name, {
                open: () => {
                    const file = new VfsTempFile();
                    return {
                        read: (data, offset) => file.read(data, offset),
                        write(data, offset) {
                            if (shouldThrow) throw testError;
                            file.write(data, offset);
                        },
                        truncate: size => file.truncate(size),
                        sync: () => file.sync(),
                        fileSize: () => file.fileSize(),
                        close: () => file.close(),
                    };
                },
                delete() {},
                access: () => false,
            });

            const db = new sqlite3.oo1.DB("/test-err.db", "ct", name);

            // Normal operation — no error stashed.
            expect(vfs.takeError()).toBeNull();

            // Now make writes throw. CREATE TABLE triggers xWrite.
            shouldThrow = true;
            expect(() => db.exec("CREATE TABLE t (id INTEGER)")).toThrow();
            expect(vfs.takeError()).toBe(testError);

            db.close();
        });

        test("takeError clears the stashed error", async () => {
            const sqlite3 = await sqlite3Promise;
            const name = nextVfsName();
            let shouldThrow = false;

            const vfs = installVfs(sqlite3, name, {
                open: () => {
                    const file = new VfsTempFile();
                    return {
                        read: (data, offset) => file.read(data, offset),
                        write(data, offset) {
                            if (shouldThrow) throw new InternalError("fail");
                            file.write(data, offset);
                        },
                        truncate: size => file.truncate(size),
                        sync: () => file.sync(),
                        fileSize: () => file.fileSize(),
                        close: () => file.close(),
                    };
                },
                delete() {},
                access: () => false,
            });

            const db = new sqlite3.oo1.DB("/test-clear.db", "ct", name);

            shouldThrow = true;
            expect(() => db.exec("CREATE TABLE t (id INTEGER)")).toThrow();

            expect(vfs.takeError()).toBeInstanceOf(Error);
            expect(vfs.takeError()).toBeNull();

            db.close();
        });

        test("only first error is stashed", async () => {
            const sqlite3 = await sqlite3Promise;
            const name = nextVfsName();
            const firstError = new InternalError("first");
            let shouldThrow = false;
            let throwCount = 0;

            const vfs = installVfs(sqlite3, name, {
                open: () => {
                    const file = new VfsTempFile();
                    return {
                        read: (data, offset) => file.read(data, offset),
                        write(data, offset) {
                            if (shouldThrow) {
                                throwCount++;
                                if (throwCount === 1) throw firstError;
                                throw new InternalError("second");
                            }
                            file.write(data, offset);
                        },
                        truncate: size => file.truncate(size),
                        sync: () => file.sync(),
                        fileSize: () => file.fileSize(),
                        close: () => file.close(),
                    };
                },
                delete() {},
                access: () => false,
            });

            const db = new sqlite3.oo1.DB("/test-first.db", "ct", name);

            shouldThrow = true;
            expect(() => db.exec("CREATE TABLE t (id INTEGER)")).toThrow();

            expect(vfs.takeError()).toBe(firstError);
            db.close();
        });
    });

    describe("delete and access", () => {
        test("access callback is invoked on first read", async () => {
            const sqlite3 = await sqlite3Promise;
            const name = nextVfsName();
            const accessedFiles: Array<string> = [];

            installVfs(sqlite3, name, {
                open: () => new VfsTempFile(),
                delete() {},
                access(filename) {
                    accessedFiles.push(filename);
                    return false;
                },
            });

            const db = new sqlite3.oo1.DB("/test-access.db", "ct", name);
            // SQLite checks for hot journals when acquiring a shared lock for the first read.
            db.exec("SELECT * FROM sqlite_schema");
            expect(accessedFiles.length).toBeGreaterThan(0);
            db.close();
        });

        test("delete callback is invoked after write", async () => {
            const sqlite3 = await sqlite3Promise;
            const name = nextVfsName();
            const deletedFiles: Array<string> = [];

            installVfs(sqlite3, name, {
                open: () => new VfsTempFile(),
                delete(filename) {
                    deletedFiles.push(filename);
                },
                access: () => false,
            });

            const db = new sqlite3.oo1.DB("/test-delete.db", "ct", name);
            // A write transaction creates and then deletes the journal file on commit.
            db.exec("CREATE TABLE t (id INTEGER)");
            expect(deletedFiles.length).toBeGreaterThan(0);
            db.close();
        });
    });
});
