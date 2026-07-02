import type {Database} from "~/external/sqlite/ext/wasm/jswasm/sqlite3.mjs";
import sqlite3InitModule from "~/external/sqlite/ext/wasm/jswasm/sqlite3.mjs";
import {DatabaseFieldConfigSqlSchema} from "~/shared/databases/fields/all_database_field_providers.js";
import {databaseTableSchemaName, sql} from "~/shared/databases/sql.js";
import {SqliteDatabase} from "~/shared/databases/sqlite.js";
import {registerSqliteCustomFunctions} from "~/shared/databases/sqlite_custom_functions.js";
import {
    runJoinTableMigrations,
    runMainMigrations,
    runTableMigrations,
} from "~/shared/databases/sqlite_migrations.js";
import {generateChronologicalId} from "~/shared/id/chronological_id.js";
import type {DatabaseFieldId, DatabaseTableId} from "~/shared/id/types/id_types.js";

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

    test("main migration creates the table kind registry", async () => {
        const db = await createDb();
        const tableId = generateChronologicalId<DatabaseTableId>();

        sql`
            INSERT INTO
                _alpine_tables (id, kind)
            VALUES
                (${tableId}, 'table')
        `.exec(db);

        const rows = sql`
            SELECT
                *
            FROM
                _alpine_tables
        `.selectAllUnknown(db);
        expect(rows).toEqual([{id: tableId, kind: "table"}]);
        db.close();
    });

    test("table migration stores JSONB field config and enforces the singleton table id", async () => {
        const db = await createDb();
        const tableId = generateChronologicalId<DatabaseTableId>();
        const firstFieldId = generateChronologicalId<DatabaseFieldId>();
        attachTableDb(db, tableId);
        runTableMigrations(db, tableId);
        sql`
            INSERT INTO
                ${sql.tableRef(tableId, "_alpine_fields")} (id, name, column_name, config)
            VALUES
                (
                    ${firstFieldId},
                    'First',
                    'first',
                    jsonb (${DatabaseFieldConfigSqlSchema.serialize({type: "plainText"})})
                )
        `.exec(db);
        sql`
            INSERT INTO
                ${sql.tableRef(tableId, "_alpine_table")} (id, name, table_name, name_field_id)
            VALUES
                (
                    ${tableId},
                    'Tasks',
                    'tasks',
                    ${firstFieldId}
                )
        `.exec(db);

        const row = sql`
            SELECT
                JSON(config) AS config
            FROM
                ${sql.tableRef(tableId, "_alpine_fields")}
        `.selectOne(db, {
            config: DatabaseFieldConfigSqlSchema,
        });
        expect(row.config).toEqual({type: "plainText"});

        expect(() =>
            sql`
                INSERT INTO
                    ${sql.tableRef(tableId, "_alpine_table")} (id, name, table_name, name_field_id)
                VALUES
                    (
                        ${generateChronologicalId<DatabaseTableId>()},
                        'Other',
                        'other',
                        ${firstFieldId}
                    )
            `.exec(db),
        ).toThrow("CHECK");
        db.close();
    });

    test("join table migration creates metadata and enforces the singleton table id", async () => {
        const db = await createDb();
        const joinTableId = generateChronologicalId<DatabaseTableId>();
        const sourceTableId = generateChronologicalId<DatabaseTableId>();
        const sourceFieldId = generateChronologicalId<DatabaseFieldId>();
        const targetTableId = generateChronologicalId<DatabaseTableId>();
        const targetFieldId = generateChronologicalId<DatabaseFieldId>();
        attachTableDb(db, joinTableId);

        runJoinTableMigrations(db, joinTableId);
        sql`
            INSERT INTO
                ${sql.tableRef(joinTableId, "_alpine_join_table")} (
                    id,
                    table_name,
                    source_table_id,
                    source_field_id,
                    target_table_id,
                    target_field_id,
                    source_row_id_column_name,
                    source_position_column_name,
                    target_row_id_column_name,
                    target_position_column_name
                )
            VALUES
                (
                    ${joinTableId},
                    'project_tasks',
                    ${sourceTableId},
                    ${sourceFieldId},
                    ${targetTableId},
                    ${targetFieldId},
                    'tasks_id',
                    'tasks_position',
                    'projects_id',
                    'projects_position'
                )
        `.exec(db);

        expect(() =>
            sql`
                INSERT INTO
                    ${sql.tableRef(joinTableId, "_alpine_join_table")} (
                        id,
                        table_name,
                        source_table_id,
                        source_field_id,
                        target_table_id,
                        target_field_id,
                        source_row_id_column_name,
                        source_position_column_name,
                        target_row_id_column_name,
                        target_position_column_name
                    )
                VALUES
                    (
                        ${generateChronologicalId<DatabaseTableId>()},
                        'other',
                        ${sourceTableId},
                        ${sourceFieldId},
                        ${targetTableId},
                        ${targetFieldId},
                        'tasks_id',
                        'tasks_position',
                        'projects_id',
                        'projects_position'
                    )
            `.exec(db),
        ).toThrow("CHECK");
        db.close();
    });
});
