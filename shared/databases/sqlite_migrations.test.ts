import type {Database} from "~/external/sqlite/ext/wasm/jswasm/sqlite3.mjs";
import sqlite3InitModule from "~/external/sqlite/ext/wasm/jswasm/sqlite3.mjs";
import {DatabaseFieldConfigSqlSchema} from "~/shared/databases/fields/database_field_providers.js";
import {databaseTableSchemaName, sql} from "~/shared/databases/sql.js";
import {SqliteDatabase} from "~/shared/databases/sqlite.js";
import {registerSqliteCustomFunctions} from "~/shared/databases/sqlite_custom_functions.js";
import {
    runJoinTableMigrations,
    runMainMigrations,
    runTableMigrations,
    tableSqliteMigrations,
} from "~/shared/databases/sqlite_migrations.js";
import {generateChronologicalId} from "~/shared/id/chronological_id.js";
import type {DatabaseFieldId, DatabaseRowId, DatabaseTableId} from "~/shared/id/types/id_types.js";
import {Schema} from "~/shared/schema/schema.js";

const sqlite3Promise = sqlite3InitModule();
let dbCounter = 0;

async function createDb(): Promise<SqliteDatabase> {
    const sqlite3 = await sqlite3Promise;
    const db = new sqlite3.oo1.DB(`/test-migrations-${dbCounter++}.sqlite3`, "ct");
    registerSqliteCustomFunctions(sqlite3, db);
    runMainMigrations(db);
    return db;
}

function attachTableDb(db: SqliteDatabase, tableId: DatabaseTableId): void {
    sql` ATTACH DATABASE ':memory:' AS ${sql.identifier(databaseTableSchemaName(tableId))} `.exec(
        db,
    );
}

function readSqliteSchemaObjects(
    db: Database,
    tableId: DatabaseTableId | null,
): Array<Record<string, unknown>> {
    const sqliteSchema =
        tableId == null ? sql.identifier("sqlite_schema") : sql.tableRef(tableId, "sqlite_schema");
    return sql`
        SELECT
            type,
            name,
            tbl_name,
            sql
        FROM
            ${sqliteSchema}
        ORDER BY
            type,
            name
    `.selectAllUnknown(db);
}

function normalizeSchemaObjectIds(
    schemaObjects: Array<Record<string, unknown>>,
    replacements: ReadonlyMap<string, string>,
): Array<Record<string, unknown>> {
    return schemaObjects.map(schemaObject =>
        Object.fromEntries(
            Object.entries(schemaObject).map(([key, value]) => {
                if (typeof value !== "string") return [key, value];
                const normalized = normalizeGeneratedIds(value, replacements);
                return [key, key === "sql" ? compactSql(normalized) : normalized];
            }),
        ),
    );
}

function normalizeGeneratedIds(value: string, replacements: ReadonlyMap<string, string>): string {
    let normalized = value;
    for (const [id, replacement] of replacements) {
        normalized = normalized.split(id).join(replacement);
    }
    return normalized.replace(/[0-9a-z]{26}/g, "<id>");
}

function compactSql(value: string): string {
    return value.replace(/\s+/g, " ").trim();
}

describe("sqlite migrations", () => {
    test("preserves the current migrated SQLite schema contract", async () => {
        const db = await createDb();
        const sourceTableId = generateChronologicalId<DatabaseTableId>();
        const targetTableId = generateChronologicalId<DatabaseTableId>();
        const joinTableId = generateChronologicalId<DatabaseTableId>();
        attachTableDb(db, sourceTableId);
        attachTableDb(db, targetTableId);
        attachTableDb(db, joinTableId);

        runTableMigrations(db, sourceTableId);
        runTableMigrations(db, targetTableId);
        runJoinTableMigrations(db, joinTableId);
        const replacements = new Map([
            [sourceTableId, "<sourceTableId>"],
            [targetTableId, "<targetTableId>"],
            [joinTableId, "<joinTableId>"],
        ]);

        const currentSchema = {
            main: normalizeSchemaObjectIds(readSqliteSchemaObjects(db, null), replacements),
            sourceTable: normalizeSchemaObjectIds(
                readSqliteSchemaObjects(db, sourceTableId),
                replacements,
            ),
            targetTable: normalizeSchemaObjectIds(
                readSqliteSchemaObjects(db, targetTableId),
                replacements,
            ),
            joinTable: normalizeSchemaObjectIds(
                readSqliteSchemaObjects(db, joinTableId),
                replacements,
            ),
        };

        expect(currentSchema).toMatchSnapshot();
        db.close();
    });

    test("main migration backfills existing table rows as user tables", async () => {
        const sqlite3 = await sqlite3Promise;
        const db = new sqlite3.oo1.DB(`/test-main-migration-${dbCounter++}.sqlite3`, "ct");
        registerSqliteCustomFunctions(sqlite3, db);
        const tableId = generateChronologicalId<DatabaseTableId>();

        db.exec(`CREATE TABLE _alpine_tables (
            id TEXT PRIMARY KEY,
            CHECK(is_id(id))
        ) STRICT, WITHOUT ROWID`);
        db.exec(`CREATE TABLE _alpine_views (
            id TEXT PRIMARY KEY,
            table_id TEXT NOT NULL REFERENCES _alpine_tables(id),
            CHECK(is_id(id)),
            CHECK(is_id(table_id))
        ) STRICT, WITHOUT ROWID`);
        db.exec(`CREATE INDEX _alpine_views_table_id ON _alpine_views(table_id)`);
        sql`
            INSERT INTO
                _alpine_tables (id)
            VALUES
                (${tableId})
        `.exec(db);
        db.exec("PRAGMA user_version = 1");

        runMainMigrations(db);

        const rows = sql`
            SELECT
                *
            FROM
                _alpine_tables
        `.selectAllUnknown(db);
        expect(rows).toEqual([{id: tableId, kind: "table"}]);
        db.close();
    });

    test("table migration backfills name_field_id from the first field id", async () => {
        const db = await createDb();
        const tableId = generateChronologicalId<DatabaseTableId>();
        const firstFieldId = generateChronologicalId<DatabaseFieldId>();
        const secondFieldId = generateChronologicalId<DatabaseFieldId>();
        attachTableDb(db, tableId);
        tableSqliteMigrations[0]!(db, tableId);
        sql`
            INSERT INTO
                ${sql.tableRef(tableId, "_alpine_table")} (id, name, table_name)
            VALUES
                (
                    ${tableId},
                    'Tasks',
                    'tasks'
                )
        `.exec(db);
        sql`
            INSERT INTO
                ${sql.tableRef(tableId, "_alpine_fields")} (id, table_id, name, column_name, config)
            VALUES
                (
                    ${secondFieldId},
                    ${tableId},
                    'Second',
                    'second',
                    ${DatabaseFieldConfigSqlSchema.serialize({type: "plainText"})}
                ),
                (
                    ${firstFieldId},
                    ${tableId},
                    'First',
                    'first',
                    ${DatabaseFieldConfigSqlSchema.serialize({type: "plainText"})}
                )
        `.exec(db);
        sql` PRAGMA ${sql.identifier(databaseTableSchemaName(tableId))}.user_version = 1 `.exec(db);

        runTableMigrations(db, tableId);

        const row = sql`
            SELECT
                name_field_id
            FROM
                ${sql.tableRef(tableId, "_alpine_table")}
        `.selectOne(db, {
            nameFieldId: Schema.id<DatabaseFieldId>().originalPropertyKey("name_field_id"),
        });
        expect(row.nameFieldId).toBe(firstFieldId);
        db.close();
    });

    test("join table migration creates metadata, links, and unique link pairs", async () => {
        const db = await createDb();
        const joinTableId = generateChronologicalId<DatabaseTableId>();
        const sourceTableId = generateChronologicalId<DatabaseTableId>();
        const sourceFieldId = generateChronologicalId<DatabaseFieldId>();
        const targetTableId = generateChronologicalId<DatabaseTableId>();
        const targetFieldId = generateChronologicalId<DatabaseFieldId>();
        const sourceRowId = generateChronologicalId<DatabaseRowId>();
        const targetRowId = generateChronologicalId<DatabaseRowId>();
        attachTableDb(db, joinTableId);

        runJoinTableMigrations(db, joinTableId);
        sql`
            INSERT INTO
                ${sql.tableRef(joinTableId, "_alpine_join_table")} (
                    id,
                    source_table_id,
                    source_field_id,
                    target_table_id,
                    target_field_id
                )
            VALUES
                (
                    ${joinTableId},
                    ${sourceTableId},
                    ${sourceFieldId},
                    ${targetTableId},
                    ${targetFieldId}
                )
        `.exec(db);
        sql`
            INSERT INTO
                ${sql.tableRef(joinTableId, "_alpine_links")} (source_row_id, target_row_id)
            VALUES
                (
                    ${sourceRowId},
                    ${targetRowId}
                )
        `.exec(db);
        expect(() =>
            sql`
                INSERT INTO
                    ${sql.tableRef(joinTableId, "_alpine_links")} (source_row_id, target_row_id)
                VALUES
                    (
                        ${sourceRowId},
                        ${targetRowId}
                    )
            `.exec(db),
        ).toThrow("UNIQUE constraint failed: _alpine_links.source_row_id");

        const linkCount = sql`
            SELECT
                COUNT(*)
            FROM
                ${sql.tableRef(joinTableId, "_alpine_links")}
        `.selectValue(db, Schema.integer);
        const indexes = sql`
            PRAGMA ${sql.tableRef(joinTableId, "index_list")} (${sql.identifier("_alpine_links")})
        `.selectAllUnknown(db);

        expect({
            linkCount,
            nonUniqueIndexNames: indexes
                .filter(index => index.unique === 0)
                .map(index => index.name)
                .sort(),
            hasUniqueLinkPairIndex: indexes.some(index => index.unique === 1),
        }).toMatchObject({
            linkCount: 1,
            nonUniqueIndexNames: ["_alpine_links_source", "_alpine_links_target"],
            hasUniqueLinkPairIndex: true,
        });
        db.close();
    });
});
