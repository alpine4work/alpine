import sqlite3InitModule from "~/external/sqlite/ext/wasm/jswasm/sqlite3.mjs";
import type {Database} from "~/external/sqlite/ext/wasm/jswasm/sqlite3.mjs";
import {sql} from "~/shared/databases/sql.js";
import {registerSqliteCustomFunctions} from "~/shared/databases/sqlite_custom_functions.js";
import {runMainMigrations} from "~/shared/databases/sqlite_migrations.js";
import {isOrderKey} from "~/shared/helpers/sort/order_key.js";

const sqlite3Promise = sqlite3InitModule();
let dbCounter = 0;

const openDbs: Array<Database> = [];

afterEach(() => {
    while (openDbs.length > 0) {
        try {
            openDbs.pop()!.close();
        } catch {
            // ignore: tolerate already-closed dbs.
        }
    }
});

async function createDb(): Promise<Database> {
    const sqlite3 = await sqlite3Promise;
    const db = new sqlite3.oo1.DB(`/test-custom-fns-${dbCounter++}.sqlite3`, "ct");
    openDbs.push(db);
    registerSqliteCustomFunctions(sqlite3, db);
    runMainMigrations(db);
    return db;
}

describe("generate_order_key", () => {
    test("(NULL, NULL) returns a valid order key", async () => {
        const db = await createDb();
        const row = sql`
            SELECT
                generate_order_key (NULL, NULL) AS value
        `.selectAllUnknown(db);

        expect(row).toHaveLength(1);
        expect(isOrderKey(row[0]!.value as string)).toBe(true);
    });

    test("lower bound only returns a greater key", async () => {
        const db = await createDb();
        const row = sql`
            SELECT
                generate_order_key ('a0', NULL) AS value
        `.selectAllUnknown(db);

        expect((row[0]!.value as string) > "a0").toBe(true);
    });

    test("upper bound only returns a smaller key", async () => {
        const db = await createDb();
        const row = sql`
            SELECT
                generate_order_key (NULL, 'a0') AS value
        `.selectAllUnknown(db);

        expect((row[0]!.value as string) < "a0").toBe(true);
    });

    test("lower and upper bounds return a key between them", async () => {
        const db = await createDb();
        const row = sql`
            SELECT
                generate_order_key ('a0', 'a2') AS value
        `.selectAllUnknown(db);

        const key = row[0]!.value as string;
        expect(key > "a0").toBe(true);
        expect(key < "a2").toBe(true);
    });

    test("throws for invalid first argument", async () => {
        const db = await createDb();
        expect(() => {
            sql`
                SELECT
                    generate_order_key ('!!!', NULL) AS value
            `.selectAllUnknown(db);
        }).toThrow("generate_order_key(): argument \u2018a\u2019 is not a valid order key: !!!");
    });

    test("throws for invalid second argument", async () => {
        const db = await createDb();
        expect(() => {
            sql`
                SELECT
                    generate_order_key (NULL, '!!!') AS value
            `.selectAllUnknown(db);
        }).toThrow("generate_order_key(): argument \u2018b\u2019 is not a valid order key: !!!");
    });
});

describe("is_order_key", () => {
    test("returns 1 for a valid order key", async () => {
        const db = await createDb();
        const row = sql`
            SELECT
                is_order_key ('a0') AS result
        `.selectAllUnknown(db);

        expect(row[0]!.result).toBe(1);
    });

    test("returns 0 for an invalid string", async () => {
        const db = await createDb();
        const row = sql`
            SELECT
                is_order_key ('!!!') AS result
        `.selectAllUnknown(db);

        expect(row[0]!.result).toBe(0);
    });

    test("returns 0 for NULL", async () => {
        const db = await createDb();
        const row = sql`
            SELECT
                is_order_key (NULL) AS result
        `.selectAllUnknown(db);

        expect(row[0]!.result).toBe(0);
    });
});

describe("generate_order_keys", () => {
    test("returns n valid order keys", async () => {
        const db = await createDb();
        const rows = sql`
            SELECT
                value
            FROM
                generate_order_keys (NULL, NULL, 3)
        `.selectAllUnknown(db);

        expect(rows).toHaveLength(3);
        for (const row of rows) {
            expect(isOrderKey(row.value as string)).toBe(true);
        }
    });

    test("returns keys in sorted order", async () => {
        const db = await createDb();
        const rows = sql`
            SELECT
                value
            FROM
                generate_order_keys (NULL, NULL, 5)
        `.selectAllUnknown(db);

        const keys = rows.map(r => r.value as string);
        const sorted = [...keys].sort();
        expect(keys).toEqual(sorted);
    });

    test("returns zero rows for n=0", async () => {
        const db = await createDb();
        const rows = sql`
            SELECT
                value
            FROM
                generate_order_keys (NULL, NULL, 0)
        `.selectAllUnknown(db);

        expect(rows).toHaveLength(0);
    });

    test("with non-null bounds returns keys between them", async () => {
        const db = await createDb();
        const rows = sql`
            SELECT
                value
            FROM
                generate_order_keys ('a0', 'a2', 3)
        `.selectAllUnknown(db);

        expect(rows).toHaveLength(3);
        for (const row of rows) {
            const key = row.value as string;
            expect(isOrderKey(key)).toBe(true);
            expect(key > "a0").toBe(true);
            expect(key < "a2").toBe(true);
        }
    });

    test("throws for invalid bounds", async () => {
        const db = await createDb();
        expect(() => {
            sql`
                SELECT
                    value
                FROM
                    generate_order_keys ('!!!', NULL, 1)
            `.selectAllUnknown(db);
        }).toThrow("generate_order_keys(): argument \u2018a\u2019 is not a valid order key: !!!");
    });

    test("SELECT * excludes HIDDEN columns", async () => {
        const db = await createDb();
        const rows = sql`
            SELECT
                *
            FROM
                generate_order_keys (NULL, NULL, 2)
        `.selectAllUnknown(db);

        expect(rows).toHaveLength(2);
        for (const row of rows) {
            expect(Object.keys(row)).toEqual(["value"]);
        }
    });
});
