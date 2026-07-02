import * as Prettier from "prettier";
import * as sqlPrettierPlugin from "prettier-plugin-sql";
import * as estreePrettierPlugin from "prettier/plugins/estree";
import * as typescriptPrettierPlugin from "prettier/plugins/typescript";
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
import {generateChronologicalId} from "~/shared/id/chronological_id.js";
import type {DatabaseTableId} from "~/shared/id/types/id_types.js";
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

async function readSqliteSchema(db: Database, tableId: DatabaseTableId | null): string {
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

    const source = rows
        .map(row => {
            return `// ${row.type} ${row.name} ${row.tbl_name}\nsql\`${row.sql}\``;
        })
        .join("\n\n");

    return await Prettier.format(source, {
        plugins: [estreePrettierPlugin, typescriptPrettierPlugin, sqlPrettierPlugin],
        parser: "typescript",
        printWidth: 100,
        tabWidth: 4,
        embeddedSqlTags: ["sql"],
        language: "sqlite",
        keywordCase: "upper",
        dataTypeCase: "upper",
        functionCase: "upper",
    });
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

    const tableId = generateChronologicalId<DatabaseTableId>();
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

    const joinTableId = generateChronologicalId<DatabaseTableId>();
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
