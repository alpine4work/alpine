import * as Prettier from "prettier";
import sqlPrettierPlugin from "prettier-plugin-sql";
import type {Database} from "~/external/sqlite/ext/wasm/jswasm/sqlite3.mjs";
import sqlite3InitModule from "~/external/sqlite/ext/wasm/jswasm/sqlite3.mjs";
import {databaseTableSchemaName, sql} from "~/shared/databases/sql.js";
import {SqliteDatabase} from "~/shared/databases/sqlite.js";
import {registerSqliteCustomFunctions} from "~/shared/databases/sqlite_custom_functions.js";
import {
    joinTableSqliteMigrations,
    mainSqliteMigrations,
    runJoinTableMigrations,
    runMainMigrations,
    runTableMigrations,
    tableSqliteMigrations,
} from "~/shared/databases/sqlite_migrations.js";
import {generateId} from "~/shared/id/id.open_source.js";
import type {DatabaseTableId} from "~/shared/id/types/id_types.open_source.js";
import {Schema} from "~/shared/schema/schema.open_source.js";

const sqlite3Promise = sqlite3InitModule();
let dbCounter = 0;

// Deliberately does NOT run main migrations: the `main migration up to N` tests
// below apply them incrementally themselves.
async function createDb(): Promise<SqliteDatabase> {
    const sqlite3 = await sqlite3Promise;
    const db = new sqlite3.oo1.DB(`/test-migrations-${dbCounter++}.sqlite3`, "ct");
    registerSqliteCustomFunctions(sqlite3, db);
    return db;
}

function attachTableDb(db: SqliteDatabase, tableId: DatabaseTableId): void {
    sql` ATTACH DATABASE ':memory:' AS ${sql.identifier(databaseTableSchemaName(tableId))} `.exec(
        db,
    );
}

async function readSqliteSchema(db: Database, tableId: DatabaseTableId | null): Promise<string> {
    const sqliteSchema =
        tableId == null ? sql.identifier("sqlite_schema") : sql.tableRef(tableId, "sqlite_schema");
    const rows = sql`
        SELECT
            type,
            name,
            tbl_name,
            sql
        FROM
            ${sqliteSchema}
        WHERE
            sql IS NOT NULL
        ORDER BY
            type,
            name
    `.selectAll(db, {
        type: Schema.string,
        name: Schema.string,
        tbl_name: Schema.string,
        sql: Schema.string,
    });

    const formattedRows = [];
    for (const row of rows) {
        const formattedSql = await Prettier.format(row.sql, {
            plugins: [sqlPrettierPlugin],
            parser: "sql",
            printWidth: 100,
            tabWidth: 4,
            language: "sqlite",
            keywordCase: "upper",
            dataTypeCase: "upper",
            functionCase: "upper",
        });
        formattedRows.push(`// ${row.type} ${row.name} ${row.tbl_name}\n${formattedSql.trim()}`);
    }

    return formattedRows.join("\n\n");
}

function normalizeSchemaObjectIds(
    schema: string,
    replacements?: ReadonlyMap<string, string>,
): string {
    let normalized = schema;
    if (replacements) {
        for (const [id, replacement] of replacements) {
            normalized = normalized.split(id).join(replacement);
        }
    }
    return normalized.replace(/[0-9a-z]{26}/g, "<id>");
}

describe("sqlite migrations", () => {
    for (let i = 1; i <= mainSqliteMigrations.length; i++) {
        test(`main migration up to ${i}`, async () => {
            const db = await createDb();

            runMainMigrations(db, i);

            const schema = normalizeSchemaObjectIds(await readSqliteSchema(db, null));
            expect(schema).toMatchSnapshot();
            db.close();
        });
    }

    test("main migration converts table kinds to PascalCase", async () => {
        const db = await createDb();
        const tableId = generateId<DatabaseTableId>();
        runMainMigrations(db, 1);
        sql`
            INSERT INTO
                _alpine_tables (id, kind)
            VALUES
                (${tableId}, 'table')
        `.exec(db);

        runMainMigrations(db);

        expect(
            sql`
                SELECT
                    kind
                FROM
                    _alpine_tables
            `.selectValue(db, Schema.string),
        ).toBe("Table");
        db.close();
    });

    const tableId = generateId<DatabaseTableId>();
    const tableMigrations = tableSqliteMigrations(tableId);

    for (let i = 1; i <= tableMigrations.length; i++) {
        test(`table migration up to ${i}`, async () => {
            const db = await createDb();
            attachTableDb(db, tableId);
            runTableMigrations(db, tableId, i);

            const replacements = new Map([[tableId, "<tableId>"]]);

            const schema = normalizeSchemaObjectIds(
                await readSqliteSchema(db, tableId),
                replacements,
            );
            expect(schema).toMatchSnapshot();
            db.close();
        });
    }

    test("table migration converts field config values to PascalCase", async () => {
        const db = await createDb();
        const migrationTableId = generateId<DatabaseTableId>();
        const plainTextFieldId = generateId();
        const checkboxFieldId = generateId();
        const numberFieldId = generateId();
        const relationFieldId = generateId();
        attachTableDb(db, migrationTableId);
        runTableMigrations(db, migrationTableId, 1);
        const fields = sql.tableRef(migrationTableId, "_alpine_fields");
        sql`
            INSERT INTO
                ${fields} (id, name, column_name, config)
            VALUES
                (
                    ${plainTextFieldId},
                    'Text',
                    'a',
                    jsonb ('{"type":"plainText"}')
                ),
                (
                    ${checkboxFieldId},
                    'Done',
                    'b',
                    jsonb ('{"type":"checkbox"}')
                ),
                (
                    ${numberFieldId},
                    'Estimate',
                    'c',
                    jsonb ('{"type":"number"}')
                ),
                (
                    ${relationFieldId},
                    'Related',
                    'd',
                    jsonb (
                        '{"type":"relation","side":"source","cardinality":"many"}'
                    )
                )
        `.exec(db);

        runTableMigrations(db, migrationTableId);

        expect(
            sql`
                SELECT
                    config ->> 'type' AS type,
                    config ->> 'side' AS side,
                    config ->> 'cardinality' AS cardinality
                FROM
                    ${fields}
                ORDER BY
                    column_name
            `.selectAll(db, {
                type: Schema.string,
                side: Schema.string.nullable(),
                cardinality: Schema.string.nullable(),
            }),
        ).toEqual([
            {type: "PlainText", side: null, cardinality: null},
            {type: "Checkbox", side: null, cardinality: null},
            {type: "Number", side: null, cardinality: null},
            {type: "Relation", side: "Source", cardinality: "Many"},
        ]);
        db.close();
    });

    const joinTableId = generateId<DatabaseTableId>();
    const joinTableMigrations = joinTableSqliteMigrations(joinTableId);

    for (let i = 1; i <= joinTableMigrations.length; i++) {
        test(`join table migration up to ${i}`, async () => {
            const db = await createDb();
            attachTableDb(db, joinTableId);
            runJoinTableMigrations(db, joinTableId, i);

            const replacements = new Map([[joinTableId, "<joinTableId>"]]);

            const schema = normalizeSchemaObjectIds(
                await readSqliteSchema(db, joinTableId),
                replacements,
            );
            expect(schema).toMatchSnapshot();
            db.close();
        });
    }
});
