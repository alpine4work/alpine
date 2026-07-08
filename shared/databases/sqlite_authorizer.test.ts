import sqlite3InitModule from "~/external/sqlite/ext/wasm/jswasm/sqlite3.mjs";
import type {
    Database,
    Sqlite3Static,
    WasmPointer,
} from "~/external/sqlite/ext/wasm/jswasm/sqlite3.mjs";
import {SqlQuery, sql} from "~/shared/databases/sql.js";
import {
    type InternalSqliteWriteLevel,
    type SqliteSchemaAccessResolver,
    type SqliteTableAccess,
    type SqliteWriteLevel,
    isSqliteActionAllowed,
    isSqliteActionAllowedForSchemaAccess,
    sqliteAuthorizerActionName,
} from "~/shared/databases/sqlite_authorizer.js";

const sqlite3Promise = sqlite3InitModule();

let dbCounter = 0;
let sqlite3: Sqlite3Static;
let db: Database;
let writeLevel: InternalSqliteWriteLevel | null = null;
let schemaAccessResolver: SqliteSchemaAccessResolver | null = null;

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
        (
            _cbArg: WasmPointer,
            actionCode: number,
            actionArg: string | 0,
            actionArg2: string | 0,
            schemaArg: string | 0,
        ) => {
            const action = sqliteAuthorizerActionName(actionCode);
            if (action === undefined) return sqlite3.capi.SQLITE_DENY;
            const arg = typeof actionArg === "string" ? actionArg : null;
            if (!isSqliteActionAllowed(action, arg, writeLevel)) {
                return sqlite3.capi.SQLITE_DENY;
            }
            // Mirrors `Database`'s skip conditions: the per-table layer never sees internal
            // SQL running at the "attach" level.
            if (schemaAccessResolver !== null && writeLevel !== "attach") {
                const allowed = isSqliteActionAllowedForSchemaAccess({
                    action,
                    arg1: arg,
                    arg2: typeof actionArg2 === "string" ? actionArg2 : null,
                    schemaName: typeof schemaArg === "string" ? schemaArg : null,
                    resolveSchemaAccess: schemaAccessResolver,
                });
                if (!allowed) return sqlite3.capi.SQLITE_DENY;
            }
            return sqlite3.capi.SQLITE_OK;
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
    schemaAccessResolver = null;
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

// -- Per-table schema access ---------------------------------------------------

const fullTableAccess: SqliteTableAccess = {
    read: true,
    write: true,
    schema: true,
};

/**
 * Attach an in-memory `_t1` schema and seed a data table plus a reserved
 * `_`-prefixed metadata table inside it.
 */
function attachTestSchema(): void {
    writeLevel = "attach";
    try {
        db.exec(sql`ATTACH ':memory:' AS _t1`.query);
    } finally {
        writeLevel = null;
    }
    db.exec(sql`CREATE TABLE _t1.things (id INTEGER PRIMARY KEY, name TEXT)`.query);
    db.exec(sql`
        INSERT INTO
            _t1.things
        VALUES
            (1, 'a')
    `.query);
    db.exec(sql`CREATE TABLE _t1._alpine_fields (id TEXT PRIMARY KEY, name TEXT)`.query);
    db.exec(sql`
        INSERT INTO
            _t1._alpine_fields
        VALUES
            ('f1', 'Name')
    `.query);
}

/**
 * Run `query` at `schema+data` with `access` installed for the `_t1` schema.
 */
function runWithTableAccess(query: SqlQuery, access: SqliteTableAccess): void {
    schemaAccessResolver = schemaName => (schemaName === "_t1" ? access : "unrestricted");
    writeLevel = "schema+data";
    try {
        db.exec(query.query);
    } finally {
        schemaAccessResolver = null;
        writeLevel = null;
    }
}

describe("per-table schema access matrix (real SQLite)", () => {
    // Each operation must pass with full access and fail when only its required
    // capability is withdrawn. Running against real SQLite also pins the authorizer
    // argument mapping (e.g. `alter-table` reporting the schema in arg1, everything
    // else in the 5th callback parameter).
    const matrix: ReadonlyArray<{
        name: string;
        query: SqlQuery;
        needed: keyof SqliteTableAccess;
    }> = [
        {
            name: "SELECT",
            query: sql`
                SELECT
                    *
                FROM
                    _t1.things
            `,
            needed: "read",
        },
        {
            name: "INSERT",
            query: sql`
                INSERT INTO
                    _t1.things
                VALUES
                    (2, 'b')
            `,
            needed: "write",
        },
        {
            name: "UPDATE",
            query: sql`
                UPDATE _t1.things
                SET
                    name = 'x'
                WHERE
                    id = 1
            `,
            needed: "write",
        },
        {
            name: "DELETE",
            query: sql`
                DELETE FROM _t1.things
                WHERE
                    id = 1
            `,
            needed: "write",
        },
        // DML against reserved `_`-prefixed metadata tables is a schema change: those rows
        // _are_ the table's structure (fields, views, layout).
        {
            name: "INSERT into _alpine metadata",
            query: sql`
                INSERT INTO
                    _t1._alpine_fields
                VALUES
                    ('f2', 'Status')
            `,
            needed: "schema",
        },
        {
            name: "UPDATE of _alpine metadata",
            query: sql`
                UPDATE _t1._alpine_fields
                SET
                    name = 'Title'
                WHERE
                    id = 'f1'
            `,
            needed: "schema",
        },
        {
            name: "DELETE of _alpine metadata",
            query: sql`
                DELETE FROM _t1._alpine_fields
                WHERE
                    id = 'f1'
            `,
            needed: "schema",
        },
        {
            name: "CREATE INDEX",
            query: sql`CREATE INDEX _t1.idx_things_name ON things (name)`,
            needed: "schema",
        },
        {
            name: "ALTER TABLE",
            query: sql`
                ALTER TABLE _t1.things
                ADD COLUMN extra TEXT
            `,
            needed: "schema",
        },
        {
            name: "DROP TABLE",
            query: sql`DROP TABLE _t1.things`,
            needed: "schema",
        },
        {
            name: "PRAGMA",
            query: sql`PRAGMA _t1.user_version`,
            needed: "schema",
        },
    ];

    for (const row of matrix) {
        test(`${row.name} passes with full access`, () => {
            attachTestSchema();
            expect(() => runWithTableAccess(row.query, fullTableAccess)).not.toThrow();
        });

        test(`${row.name} is denied without ${row.needed}`, () => {
            attachTestSchema();
            // Read denials surface at prepare time as "access to X is prohibited"; everything
            // else as "not authorized".
            expect(() =>
                runWithTableAccess(row.query, {...fullTableAccess, [row.needed]: false}),
            ).toThrow(/not authorized|is prohibited/);
        });
    }

    test("metadata DML needs schema, not write", () => {
        attachTestSchema();
        expect(() =>
            runWithTableAccess(
                sql`
                    UPDATE _t1._alpine_fields
                    SET
                        name = 'Title'
                    WHERE
                        id = 'f1'
                `,
                {...fullTableAccess, write: false},
            ),
        ).not.toThrow();
    });

    test("main stays readable while _t1 is denied", () => {
        attachTestSchema();
        expect(() =>
            runWithTableAccess(
                sql`
                    SELECT
                        *
                    FROM
                        items
                `,
                {...fullTableAccess, read: false},
            ),
        ).not.toThrow();
    });

    test("a cross-schema join into a denied table is rejected", () => {
        attachTestSchema();
        expect(() =>
            runWithTableAccess(
                sql`
                    SELECT
                        *
                    FROM
                        items
                        JOIN _t1.things ON _t1.things.id = items.id
                `,
                {...fullTableAccess, read: false},
            ),
        ).toThrow(/not authorized|is prohibited/);
    });
});

describe("replicated metadata guards (real SQLite)", () => {
    /** Seed simplified `_alpine_table` / `_alpine_join_table` rows inside `_t1`. */
    function createMetadataTables(): void {
        attachTestSchema();
        db.exec(sql`
            CREATE TABLE _t1._alpine_table (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                access_policy BLOB NOT NULL
            )
        `.query);
        db.exec(sql`
            INSERT INTO
                _t1._alpine_table
            VALUES
                ('t1', 'Table', x'00')
        `.query);
        db.exec(sql`
            CREATE TABLE _t1._alpine_join_table (
                id TEXT PRIMARY KEY,
                table_name TEXT NOT NULL,
                source_table_id TEXT NOT NULL,
                target_table_id TEXT NOT NULL
            )
        `.query);
        db.exec(sql`
            INSERT INTO
                _t1._alpine_join_table
            VALUES
                ('j1', 'join', 'a', 'b')
        `.query);
    }

    test("_alpine_table name updates are allowed with full access", () => {
        createMetadataTables();
        expect(() =>
            runWithTableAccess(
                sql`
                    UPDATE _t1._alpine_table
                    SET
                        name = 'renamed'
                `,
                fullTableAccess,
            ),
        ).not.toThrow();
    });

    test("_alpine_table access_policy updates are denied even with full access", () => {
        createMetadataTables();
        expect(() =>
            runWithTableAccess(
                sql`
                    UPDATE _t1._alpine_table
                    SET
                        access_policy = x'01'
                `,
                fullTableAccess,
            ),
        ).toThrow("not authorized");
    });

    test("_alpine_table row inserts are denied even with full access", () => {
        createMetadataTables();
        expect(() =>
            runWithTableAccess(
                sql`
                    INSERT INTO
                        _t1._alpine_table
                    VALUES
                        ('t2', 'Bogus', x'00')
                `,
                fullTableAccess,
            ),
        ).toThrow("not authorized");
    });

    test("_alpine_table row deletes are denied even with full access", () => {
        createMetadataTables();
        expect(() =>
            runWithTableAccess(sql`DELETE FROM _t1._alpine_table`, fullTableAccess),
        ).toThrow("not authorized");
    });

    test("_alpine_join_table name updates are allowed with full access", () => {
        createMetadataTables();
        expect(() =>
            runWithTableAccess(
                sql`
                    UPDATE _t1._alpine_join_table
                    SET
                        table_name = 'renamed'
                `,
                fullTableAccess,
            ),
        ).not.toThrow();
    });

    test("_alpine_join_table id column updates are denied even with full access", () => {
        createMetadataTables();
        expect(() =>
            runWithTableAccess(
                sql`
                    UPDATE _t1._alpine_join_table
                    SET
                        source_table_id = 'hijacked'
                `,
                fullTableAccess,
            ),
        ).toThrow("not authorized");
    });

    test("_alpine_join_table row inserts are allowed with full access", () => {
        createMetadataTables();
        // `createRelationField` is a user action and must be able to register a fresh join
        // file's metadata row.
        expect(() =>
            runWithTableAccess(
                sql`
                    INSERT INTO
                        _t1._alpine_join_table
                    VALUES
                        ('j2', 'join2', 'a', 'b')
                `,
                fullTableAccess,
            ),
        ).not.toThrow();
    });

    test("_alpine_join_table row deletes are denied even with full access", () => {
        createMetadataTables();
        expect(() =>
            runWithTableAccess(sql`DELETE FROM _t1._alpine_join_table`, fullTableAccess),
        ).toThrow("not authorized");
    });
});
