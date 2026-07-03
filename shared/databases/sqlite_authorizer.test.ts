import sqlite3InitModule from "~/external/sqlite/ext/wasm/jswasm/sqlite3.mjs";
import type {
    Database,
    Sqlite3Static,
    WasmPointer,
} from "~/external/sqlite/ext/wasm/jswasm/sqlite3.mjs";
import {SqlQuery, sql} from "~/shared/databases/sql.js";
import {
    type SqliteWriteLevel,
    isSqliteActionAllowed,
    sqliteAuthorizerActionName,
} from "~/shared/databases/sqlite_authorizer.js";

const sqlite3Promise = sqlite3InitModule();

let dbCounter = 0;
let sqlite3: Sqlite3Static;
let db: Database;
let writeLevel: SqliteWriteLevel | null = null;

beforeAll(async () => {
    sqlite3 = await sqlite3Promise;
});

beforeEach(() => {
    db = new sqlite3.oo1.DB(`/test-authorizer-${dbCounter++}.sqlite3`, "ct");
    // Install the same authorizer wiring that DatabaseServer and DatabaseClient use,
    // so the test exercises the real code path rather than the pure function in
    // isolation.
    sqlite3.capi.sqlite3_set_authorizer(
        db.pointer!,
        (_cbArg: WasmPointer, actionCode: number, actionArg: string | 0) => {
            const action = sqliteAuthorizerActionName(actionCode);
            if (action === undefined) return sqlite3.capi.SQLITE_DENY;
            const arg = typeof actionArg === "string" ? actionArg : null;
            return isSqliteActionAllowed(action, arg, writeLevel)
                ? sqlite3.capi.SQLITE_OK
                : sqlite3.capi.SQLITE_DENY;
        },
        0,
    );

    // Seed schema with the authorizer disabled so setup doesn't depend on what we're
    // about to test.
    writeLevel = null;
    db.exec(sql`CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT)`.query);
    db.exec(sql`
        INSERT INTO
            items
        VALUES
            (1, 'a')
    `.query);
});

afterEach(() => {
    writeLevel = null;
    db.close();
});

function run(query: SqlQuery, level: SqliteWriteLevel): void {
    writeLevel = level;
    try {
        db.exec(query.query);
    } finally {
        writeLevel = null;
    }
}

// -- Authorizer matrix --------------------------------------------------------

// Per writeLevel, the SQL operations we expect to permit vs reject. Each row is
// run through the real SQLite authorizer so a regression in
// `isSqliteActionAllowed` or in the action-code mapping shows up as a failure.
const matrix: ReadonlyArray<{
    name: string;
    query: SqlQuery;
    none: "allow" | "reject";
    data: "allow" | "reject";
    schemaData: "allow" | "reject";
}> = [
    {
        name: "SELECT",
        query: sql`
            SELECT
                *
            FROM
                items
        `,
        none: "allow",
        data: "allow",
        schemaData: "allow",
    },
    {
        name: "INSERT",
        query: sql`
            INSERT INTO
                items
            VALUES
                (2, 'b')
        `,
        none: "reject",
        data: "allow",
        schemaData: "allow",
    },
    {
        name: "UPDATE",
        query: sql`
            UPDATE items
            SET
                name = 'x'
            WHERE
                id = 1
        `,
        none: "reject",
        data: "allow",
        schemaData: "allow",
    },
    {
        name: "DELETE",
        query: sql`
            DELETE FROM items
            WHERE
                id = 1
        `,
        none: "reject",
        data: "allow",
        schemaData: "allow",
    },
    {
        name: "CREATE TABLE",
        query: sql`CREATE TABLE other (id INTEGER)`,
        none: "reject",
        data: "reject",
        schemaData: "allow",
    },
    {
        name: "DROP TABLE",
        query: sql`DROP TABLE items`,
        none: "reject",
        data: "reject",
        schemaData: "allow",
    },
    {
        name: "ALTER TABLE",
        query: sql`
            ALTER TABLE items
            ADD COLUMN extra TEXT
        `,
        none: "reject",
        data: "reject",
        schemaData: "allow",
    },
    {
        name: "CREATE INDEX",
        query: sql`CREATE INDEX idx_name ON items (name)`,
        none: "reject",
        data: "reject",
        schemaData: "allow",
    },
    {
        name: "PRAGMA",
        query: sql`PRAGMA table_list`,
        none: "reject",
        data: "reject",
        schemaData: "allow",
    },
];

describe("authorizer matrix (real SQLite)", () => {
    for (const row of matrix) {
        for (const level of ["none", "data", "schema+data"] as const) {
            const expectation =
                level === "none" ? row.none : level === "data" ? row.data : row.schemaData;
            test(`${row.name} is ${expectation}ed at writeLevel=${level}`, () => {
                if (expectation === "allow") {
                    expect(() => run(row.query, level)).not.toThrow();
                } else {
                    expect(() => run(row.query, level)).toThrow();
                }
            });
        }
    }
});

// -- Recovery / interaction --------------------------------------------------

describe("authorizer interaction", () => {
    test("rejected statement leaves the database queryable", () => {
        expect(() =>
            run(
                sql`
                    INSERT INTO
                        items
                    VALUES
                        (2, 'b')
                `,
                "none",
            ),
        ).toThrow();
        const rows = db.exec(
            sql`
                SELECT
                    id
                FROM
                    items
            `.query,
            {
                returnValue: "resultRows",
                rowMode: "array",
            },
        );
        expect(rows).toEqual([[1]]);
    });

    test("writeLevel=null (idle) allows everything", () => {
        // The pure function returns true unconditionally when level is null. Verified via
        // the seed in beforeEach already, but pin it directly so a regression here
        // surfaces clearly.
        writeLevel = null;
        expect(() => db.exec(sql`CREATE TABLE x (id INTEGER)`.query)).not.toThrow();
        expect(() =>
            db.exec(sql`
                INSERT INTO
                    x
                VALUES
                    (1)
            `.query),
        ).not.toThrow();
        expect(() => db.exec(sql`PRAGMA table_list`.query)).not.toThrow();
    });

    test("transitioning writeLevel between statements is honored", () => {
        run(
            sql`
                INSERT INTO
                    items
                VALUES
                    (2, 'b')
            `,
            "data",
        );
        expect(() =>
            run(
                sql`
                    INSERT INTO
                        items
                    VALUES
                        (3, 'c')
                `,
                "none",
            ),
        ).toThrow();
        run(
            sql`
                INSERT INTO
                    items
                VALUES
                    (4, 'd')
            `,
            "data",
        );

        const rows = db.exec(
            sql`
                SELECT
                    id
                FROM
                    items
                ORDER BY
                    id
            `.query,
            {
                returnValue: "resultRows",
                rowMode: "array",
            },
        );
        expect(rows).toEqual([[1], [2], [4]]);
    });

    test("unknown action codes are denied", () => {
        // The action-name table has 34 entries (codes 0..33). Codes outside that range
        // should map to undefined, which the wiring treats as DENY. Code 0 is the only
        // in-range undefined slot; verify it's classified as unrecognized.
        expect(sqliteAuthorizerActionName(0)).toBeUndefined();
        expect(sqliteAuthorizerActionName(99)).toBeUndefined();
    });
});
