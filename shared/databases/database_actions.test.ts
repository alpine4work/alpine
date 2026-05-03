/* eslint-disable cyberworlds/string-quotes -- SQL literals */

import sqlite3InitModule from "~/external/sqlite/ext/wasm/jswasm/sqlite3.mjs";
import type {Database} from "~/external/sqlite/ext/wasm/jswasm/sqlite3.mjs";
import {databaseActions} from "~/shared/databases/database_actions.js";
import {DatabaseFieldConfigSqlSchema} from "~/shared/databases/fields/database_field_providers.js";
import {sql} from "~/shared/databases/sql.js";
import {databaseViewDefaultColumnWidth} from "~/shared/databases/sqlite_constants.js";
import {registerSqliteCustomFunctions} from "~/shared/databases/sqlite_custom_functions.js";
import {runSqliteMigrations} from "~/shared/databases/sqlite_migrations.js";
import type {OrderKey} from "~/shared/helpers/sort/order_key.js";
import {generateChronologicalId} from "~/shared/id/chronological_id.js";
import {isId} from "~/shared/id/id.js";
import type {
    DatabaseFieldId,
    DatabaseRowId,
    DatabaseTableId,
    DatabaseViewId,
} from "~/shared/id/types/id_types.js";
import {Schema} from "~/shared/schema/schema.js";

const sqlite3Promise = sqlite3InitModule();
let dbCounter = 0;

async function createDb(): Promise<Database> {
    const sqlite3 = await sqlite3Promise;
    const db = new sqlite3.oo1.DB(`/test-actions-${dbCounter++}.sqlite3`, "ct");
    registerSqliteCustomFunctions(sqlite3, db);
    runSqliteMigrations(db);
    return db;
}

describe("createTable", () => {
    test("inserts metadata into _alpine_tables and _alpine_fields", async () => {
        const db = await createDb();
        const {tableId, tableName} = databaseActions.createTable.run(db, {name: "Tasks"});

        expect(isId(tableId)).toBe(true);
        expect(tableName).toBe("tasks");

        const tables = sql`
            SELECT
                *
            FROM
                _alpine_tables
        `.selectAllUnknown(db);
        expect(tables).toMatchObject([{id: tableId, name: "Tasks", table_name: "tasks"}]);

        const fields = sql`
            SELECT
                *
            FROM
                _alpine_fields
        `.selectAllUnknown(db);
        expect(fields).toMatchObject([
            {
                table_id: tableId,
                name: "Name",
                column_name: "name",
                config: DatabaseFieldConfigSqlSchema.serialize({type: "plainText"}),
            },
        ]);
        db.close();
    });

    test("creates a queryable table with system columns", async () => {
        const db = await createDb();
        const {tableName} = databaseActions.createTable.run(db, {name: "Tasks"});

        sql`
            INSERT INTO
                ${sql.identifier(tableName)} (name)
            VALUES
                ('Do laundry')
        `.exec(db);
        const rows = sql`
            SELECT
                *
            FROM
                ${sql.identifier(tableName)}
        `.selectAllUnknown(db);

        expect(isId(rows[0]!._id as string)).toBe(true);
        expect(rows).toMatchObject([{name: "Do laundry"}]);
        expect(rows[0]!._created_at).toBeDefined();
    });

    test("_id auto-generates a ChronologicalId", async () => {
        const db = await createDb();
        const {tableName} = databaseActions.createTable.run(db, {name: "T"});

        sql`
            INSERT INTO
                ${sql.identifier(tableName)} (name)
            VALUES
                ('a')
        `.exec(db);
        sql`
            INSERT INTO
                ${sql.identifier(tableName)} (name)
            VALUES
                ('b')
        `.exec(db);
        const rows = sql`
            SELECT
                _id
            FROM
                ${sql.identifier(tableName)}
            ORDER BY
                _id
        `.selectAllUnknown(db);

        expect(rows).toHaveLength(2);
        expect(isId(rows[0]!._id as string)).toBe(true);
        expect(isId(rows[1]!._id as string)).toBe(true);
        expect(rows[0]!._id).not.toBe(rows[1]!._id);
    });

    test("_created_at auto-populates with datetime", async () => {
        const db = await createDb();
        const {tableName} = databaseActions.createTable.run(db, {name: "T"});

        sql`
            INSERT INTO
                ${sql.identifier(tableName)} (name)
            VALUES
                ('x')
        `.exec(db);
        const createdAt = sql`
            SELECT
                _created_at
            FROM
                ${sql.identifier(tableName)}
        `.selectOne(db, {
            createdAt: Schema.string.originalPropertyKey("_created_at"),
        }).createdAt;

        // Matches YYYY-MM-DD HH:MM:SS format.
        expect(createdAt).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
    });

    test("_created_at CHECK rejects unparseable values", async () => {
        const db = await createDb();
        const {tableName} = databaseActions.createTable.run(db, {name: "T"});

        expect(() => {
            sql`
                INSERT INTO
                    ${sql.identifier(tableName)} (_created_at, name)
                VALUES
                    ('not-a-date', 'x')
            `.exec(db);
        }).toThrow("CHECK");
    });

    test("name column defaults to empty string", async () => {
        const db = await createDb();
        const {tableName} = databaseActions.createTable.run(db, {name: "T"});

        sql`
            INSERT INTO
                ${sql.identifier(tableName)} DEFAULT
            VALUES
        `.exec(db);
        const name = sql`
            SELECT
                name
            FROM
                ${sql.identifier(tableName)}
        `.selectOne(db, {
            name: Schema.string,
        }).name;
        expect(name).toBe("");
    });

    test("name column CHECK rejects blobs", async () => {
        const db = await createDb();
        const {tableName} = databaseActions.createTable.run(db, {name: "T"});

        expect(() => {
            sql`
                INSERT INTO
                    ${sql.identifier(tableName)} (name)
                VALUES
                    (${sql.raw("x'00'")})
            `.exec(db);
        }).toThrow("CHECK");
    });

    test("column type is encoded in type name", async () => {
        const db = await createDb();
        const {tableName} = databaseActions.createTable.run(db, {name: "T"});

        const colInfo = sql`PRAGMA table_info (${sql.identifier(tableName)})`.selectAllUnknown(db);

        const nameCol = colInfo.find(c => c.name === "name");
        expect(nameCol!.type).toMatch(/^TEXT_alpine_[0-9a-z]{26}$/);
    });

    test("duplicate name gets unique suffix", async () => {
        const db = await createDb();
        const first = databaseActions.createTable.run(db, {name: "Tasks"});
        const second = databaseActions.createTable.run(db, {name: "Tasks"});

        expect(first.tableName).toBe("tasks");
        expect(second.tableName).toBe("tasks_2");
    });

    test("index exists on _created_at", async () => {
        const db = await createDb();
        const {tableName} = databaseActions.createTable.run(db, {name: "T"});

        const indexes = sql`PRAGMA index_list (${sql.identifier(tableName)})`.selectAllUnknown(db);

        expect(indexes.some(idx => (idx.name as string).includes("_created_at"))).toBe(true);
        db.close();
    });

    test("creates a default view", async () => {
        const db = await createDb();
        const {tableId} = databaseActions.createTable.run(db, {name: "Tasks"});

        const views = sql`
            SELECT
                *
            FROM
                _alpine_views
            WHERE
                table_id = ${tableId}
        `.selectAllUnknown(db);

        expect(views).toMatchObject([{table_id: tableId, name: "Grid view"}]);
        db.close();
    });

    test("returns viewId", async () => {
        const db = await createDb();
        const {viewId} = databaseActions.createTable.run(db, {name: "Tasks"});

        expect(isId(viewId)).toBe(true);
        db.close();
    });

    test("default view contains the Name field", async () => {
        const db = await createDb();
        const {viewId} = databaseActions.createTable.run(db, {name: "Tasks"});

        const viewFields = sql`
            SELECT
                *
            FROM
                _alpine_view_fields
            WHERE
                view_id = ${viewId}
        `.selectAllUnknown(db);

        expect(viewFields).toMatchObject([
            {view_id: viewId, width: databaseViewDefaultColumnWidth},
        ]);
        expect(typeof viewFields[0]!.position).toBe("string");
        db.close();
    });

    test("multiple tables get independent views", async () => {
        const db = await createDb();
        const first = databaseActions.createTable.run(db, {name: "Tasks"});
        const second = databaseActions.createTable.run(db, {name: "Projects"});

        const views = sql`
            SELECT
                *
            FROM
                _alpine_views
            ORDER BY
                id
        `.selectAllUnknown(db);

        expect(views).toMatchObject([
            {table_id: first.tableId, name: "Grid view"},
            {table_id: second.tableId, name: "Grid view"},
        ]);

        const firstFields = sql`
            SELECT
                *
            FROM
                _alpine_view_fields
            WHERE
                view_id = ${first.viewId}
        `.selectAllUnknown(db);
        const secondFields = sql`
            SELECT
                *
            FROM
                _alpine_view_fields
            WHERE
                view_id = ${second.viewId}
        `.selectAllUnknown(db);

        expect(firstFields).toHaveLength(1);
        expect(secondFields).toHaveLength(1);
        expect(firstFields[0]!.field_id).not.toBe(secondFields[0]!.field_id);
        db.close();
    });
});

describe("getViewSchema", () => {
    test("returns position and hidden in field output", async () => {
        const db = await createDb();
        const {viewId} = databaseActions.createTable.run(db, {name: "T"});
        const result = databaseActions.getViewSchema.run(db, {tableOrViewId: viewId});

        expect(result.fields).toHaveLength(1);
        expect(typeof result.fields[0]!.position).toBe("string");
        expect(result.fields[0]!.hidden).toBe(false);
        db.close();
    });

    test("hidden field is included with hidden=true", async () => {
        const db = await createDb();
        const {tableId, viewId} = databaseActions.createTable.run(db, {name: "T"});

        const {fieldId: secondFieldId} = addFieldAndGetId(db, tableId, viewId, "Status");
        databaseActions.updateFieldViewVisibility.run(db, {
            viewId,
            fieldId: secondFieldId,
            position: "a1" as OrderKey,
            isHidden: true,
        });

        const result = databaseActions.getViewSchema.run(db, {tableOrViewId: viewId});
        expect(result.fields).toHaveLength(2);

        const hidden = result.fields.find(f => f.id === secondFieldId)!;
        expect(hidden.hidden).toBe(true);

        const visible = result.fields.find(f => f.id !== secondFieldId)!;
        expect(visible.hidden).toBe(false);
        db.close();
    });
});

describe("updateFieldViewVisibility", () => {
    test("updates position and hidden flag", async () => {
        const db = await createDb();
        const {tableId, viewId} = databaseActions.createTable.run(db, {name: "T"});
        const {fieldId} = addFieldAndGetId(db, tableId, viewId, "Status");

        databaseActions.updateFieldViewVisibility.run(db, {
            viewId,
            fieldId,
            position: "a1" as OrderKey,
            isHidden: true,
        });

        const row = sql`
            SELECT
                *
            FROM
                _alpine_view_fields
            WHERE
                view_id = ${viewId}
                AND field_id = ${fieldId}
        `.selectAllUnknown(db);
        expect(row).toMatchObject([{position: "a1", hidden: 1}]);
        db.close();
    });

    test("can toggle back to visible", async () => {
        const db = await createDb();
        const {tableId, viewId} = databaseActions.createTable.run(db, {name: "T"});
        const {fieldId} = addFieldAndGetId(db, tableId, viewId, "Status");

        databaseActions.updateFieldViewVisibility.run(db, {
            viewId,
            fieldId,
            position: "a1" as OrderKey,
            isHidden: true,
        });
        databaseActions.updateFieldViewVisibility.run(db, {
            viewId,
            fieldId,
            position: "a2" as OrderKey,
            isHidden: false,
        });

        const row = sql`
            SELECT
                *
            FROM
                _alpine_view_fields
            WHERE
                view_id = ${viewId}
                AND field_id = ${fieldId}
        `.selectAllUnknown(db);
        expect(row).toMatchObject([{position: "a2", hidden: 0}]);
        db.close();
    });
});

/** Helper: creates a field via the action and returns its id. */
function addFieldAndGetId(
    db: Awaited<ReturnType<typeof createDb>>,
    tableId: DatabaseTableId,
    viewId: DatabaseViewId,
    name: string,
    type: "plainText" | "checkbox" = "plainText",
) {
    const fieldId = generateChronologicalId<DatabaseFieldId>();
    databaseActions.createField.run(db, {fieldId, tableId, viewId, name, type});
    return {fieldId};
}

describe("rawSql", () => {
    test("SELECT passes rows through", async () => {
        const db = await createDb();
        const {tableName} = databaseActions.createTable.run(db, {name: "T"});
        sql`
            INSERT INTO
                ${sql.identifier(tableName)} (name)
            VALUES
                ('a'),
                ('b')
        `.exec(db);

        const {rows} = databaseActions.rawSql.run(db, {
            sql: `SELECT name FROM ${tableName} ORDER BY name`,
        });

        expect(rows).toMatchObject([{name: "a"}, {name: "b"}]);
        db.close();
    });

    test("INSERT goes through (writeLevel: data)", async () => {
        const db = await createDb();
        const {tableName} = databaseActions.createTable.run(db, {name: "T"});

        databaseActions.rawSql.run(db, {
            sql: `INSERT INTO ${tableName} (name) VALUES ('inserted')`,
        });

        const rows = sql`
            SELECT
                name
            FROM
                ${sql.identifier(tableName)}
        `.selectAllUnknown(db);
        expect(rows).toMatchObject([{name: "inserted"}]);
        db.close();
    });
});

describe("readonlyRawSql", () => {
    test("SELECT passes rows through", async () => {
        const db = await createDb();
        const {tableName} = databaseActions.createTable.run(db, {name: "T"});
        sql`
            INSERT INTO
                ${sql.identifier(tableName)} (name)
            VALUES
                ('hello')
        `.exec(db);

        const {rows} = databaseActions.readonlyRawSql.run(db, {
            sql: `SELECT name FROM ${tableName}`,
        });

        expect(rows).toMatchObject([{name: "hello"}]);
        db.close();
    });

    test("returns empty array for empty result set", async () => {
        const db = await createDb();
        const {tableName} = databaseActions.createTable.run(db, {name: "T"});

        const {rows} = databaseActions.readonlyRawSql.run(db, {
            sql: `SELECT * FROM ${tableName}`,
        });

        expect(rows).toEqual([]);
        db.close();
    });
});

describe("ensureSchemaPagesLoaded", () => {
    test("returns empty object and does not throw on a fresh database", async () => {
        const db = await createDb();

        expect(databaseActions.ensureSchemaPagesLoaded.run(db, {})).toEqual({});
        db.close();
    });

    test("returns empty object after tables exist", async () => {
        const db = await createDb();
        databaseActions.createTable.run(db, {name: "T"});

        expect(databaseActions.ensureSchemaPagesLoaded.run(db, {})).toEqual({});
        db.close();
    });
});

describe("renameTable", () => {
    test("relabels without changing tableName when slug is unchanged", async () => {
        const db = await createDb();
        const {tableId, tableName: original} = databaseActions.createTable.run(db, {name: "Tasks"});

        // "Tasks" and "Tasks!" both slugify to "tasks", so the
        // SQL table name should not change — only the label.
        const {tableName} = databaseActions.renameTable.run(db, {tableId, name: "Tasks!"});

        expect(tableName).toBe(original);
        const rows = sql`
            SELECT
                name,
                table_name
            FROM
                _alpine_tables
            WHERE
                id = ${tableId}
        `.selectAllUnknown(db);
        expect(rows).toMatchObject([{name: "Tasks!", table_name: original}]);
        db.close();
    });

    test("renames the SQL table when the slug changes and recreates the index", async () => {
        const db = await createDb();
        const {tableId} = databaseActions.createTable.run(db, {name: "Tasks"});
        sql`
            INSERT INTO
                tasks (name)
            VALUES
                ('keep me')
        `.exec(db);

        const {tableName} = databaseActions.renameTable.run(db, {tableId, name: "Projects"});

        expect(tableName).toBe("projects");
        // Data survives the rename.
        const rows = sql`
            SELECT
                name
            FROM
                projects
        `.selectAllUnknown(db);
        expect(rows).toMatchObject([{name: "keep me"}]);
        // The created_at index follows the rename.
        const indexes = sql`PRAGMA index_list ("projects")`.selectAllUnknown(db);
        expect(indexes.some(idx => (idx.name as string).includes("_created_at"))).toBe(true);
        db.close();
    });

    test("rename to an existing label dedups the SQL table name", async () => {
        const db = await createDb();
        databaseActions.createTable.run(db, {name: "Tasks"});
        const {tableId} = databaseActions.createTable.run(db, {name: "Projects"});

        const {tableName} = databaseActions.renameTable.run(db, {tableId, name: "Tasks"});

        // The other table already owns "tasks", so the rename
        // gets a "_2" suffix instead of clobbering it.
        expect(tableName).toBe("tasks_2");
        db.close();
    });
});

describe("getTables", () => {
    test("returns each table's name and tableName keyed by id in id order", async () => {
        const db = await createDb();
        const first = databaseActions.createTable.run(db, {name: "Tasks"});
        const second = databaseActions.createTable.run(db, {name: "Projects"});

        const {tables} = databaseActions.getTables.run(db, {});

        expect([...tables]).toEqual([
            [first.tableId, {name: "Tasks", tableName: "tasks"}],
            [second.tableId, {name: "Projects", tableName: "projects"}],
        ]);
        db.close();
    });

    test("returns empty map on a fresh database", async () => {
        const db = await createDb();

        const {tables} = databaseActions.getTables.run(db, {});

        expect(tables.size).toBe(0);
        db.close();
    });
});

describe("getViewRowsPageCursor", () => {
    test("returns null endCursor when fewer rows than limit exist", async () => {
        const db = await createDb();
        const {tableId, viewId, tableName} = databaseActions.createTable.run(db, {name: "T"});
        sql`
            INSERT INTO
                ${sql.identifier(tableName)} (name)
            VALUES
                ('a'),
                ('b')
        `.exec(db);

        const result = databaseActions.getViewRowsPageCursor.run(db, {
            tableOrViewId: viewId,
            afterCursor: null,
            limit: 5,
        });

        expect(result).toMatchObject({tableId, viewId, tableName, endCursor: null});
    });

    test("returns endCursor when row count equals limit", async () => {
        const db = await createDb();
        const {viewId, tableName} = databaseActions.createTable.run(db, {name: "T"});
        const ids: Array<string> = [];
        for (let i = 0; i < 3; i++) {
            const id = generateChronologicalId<DatabaseRowId>();
            ids.push(id);
            sql`
                INSERT INTO
                    ${sql.identifier(tableName)} (_id, name)
                VALUES
                    (
                        ${id},
                        ${`row-${i}`}
                    )
            `.exec(db);
        }

        const result = databaseActions.getViewRowsPageCursor.run(db, {
            tableOrViewId: viewId,
            afterCursor: null,
            limit: 3,
        });

        // Last id since we inserted in order.
        expect(result.endCursor).toBe(ids[ids.length - 1]);
    });

    test("after-cursor pagination skips earlier rows", async () => {
        const db = await createDb();
        const {viewId, tableName} = databaseActions.createTable.run(db, {name: "T"});
        const ids: Array<DatabaseRowId> = [];
        for (let i = 0; i < 5; i++) {
            const id = generateChronologicalId<DatabaseRowId>();
            ids.push(id);
            sql`
                INSERT INTO
                    ${sql.identifier(tableName)} (_id)
                VALUES
                    (${id})
            `.exec(db);
        }

        const result = databaseActions.getViewRowsPageCursor.run(db, {
            tableOrViewId: viewId,
            afterCursor: ids[1]!,
            limit: 2,
        });

        // Rows 2 and 3 fit, row 3's id is the cursor.
        expect(result.endCursor).toBe(ids[3]);
    });
});

describe("getViewRowsPage", () => {
    test("returns rows in id order with _id at position 0 and view fields at positions 1..n", async () => {
        const db = await createDb();
        const {viewId, tableName} = databaseActions.createTable.run(db, {name: "T"});
        const id1 = generateChronologicalId<DatabaseRowId>();
        const id2 = generateChronologicalId<DatabaseRowId>();
        sql`
            INSERT INTO
                ${sql.identifier(tableName)} (_id, name)
            VALUES
                (
                    ${id1},
                    ${"alpha"}
                )
        `.exec(db);
        sql`
            INSERT INTO
                ${sql.identifier(tableName)} (_id, name)
            VALUES
                (
                    ${id2},
                    ${"beta"}
                )
        `.exec(db);

        const {fieldIndexes, rows} = databaseActions.getViewRowsPage.run(db, {
            tableOrViewId: viewId,
            afterCursor: null,
            endCursor: null,
        });

        expect(fieldIndexes.size).toBe(1);
        const nameIndex = [...fieldIndexes.values()][0]!;
        expect(nameIndex).toBe(1);
        expect(rows).toEqual([
            [id1, "alpha"],
            [id2, "beta"],
        ]);
    });

    test("filters by both afterCursor and endCursor when both are set", async () => {
        const db = await createDb();
        const {viewId, tableName} = databaseActions.createTable.run(db, {name: "T"});
        const ids: Array<DatabaseRowId> = [];
        for (let i = 0; i < 4; i++) {
            const id = generateChronologicalId<DatabaseRowId>();
            ids.push(id);
            sql`
                INSERT INTO
                    ${sql.identifier(tableName)} (_id)
                VALUES
                    (${id})
            `.exec(db);
        }

        const {rows} = databaseActions.getViewRowsPage.run(db, {
            tableOrViewId: viewId,
            afterCursor: ids[0]!,
            endCursor: ids[2]!,
        });

        expect(rows.map(r => r[0])).toEqual([ids[1], ids[2]]);
    });

    test("after-only and end-only cursor branches return the expected slices", async () => {
        const db = await createDb();
        const {viewId, tableName} = databaseActions.createTable.run(db, {name: "T"});
        const ids: Array<DatabaseRowId> = [];
        for (let i = 0; i < 3; i++) {
            const id = generateChronologicalId<DatabaseRowId>();
            ids.push(id);
            sql`
                INSERT INTO
                    ${sql.identifier(tableName)} (_id)
                VALUES
                    (${id})
            `.exec(db);
        }

        const afterOnly = databaseActions.getViewRowsPage.run(db, {
            tableOrViewId: viewId,
            afterCursor: ids[0]!,
            endCursor: null,
        });
        expect(afterOnly.rows.map(r => r[0])).toEqual([ids[1], ids[2]]);

        const endOnly = databaseActions.getViewRowsPage.run(db, {
            tableOrViewId: viewId,
            afterCursor: null,
            endCursor: ids[1]!,
        });
        expect(endOnly.rows.map(r => r[0])).toEqual([ids[0], ids[1]]);
    });

    test("checkbox values are deserialized via the field provider's sqlValueSchema", async () => {
        const db = await createDb();
        const {tableId, viewId, tableName} = databaseActions.createTable.run(db, {name: "T"});
        const {fieldId} = addFieldAndGetId(db, tableId, viewId, "Done", "checkbox");
        const rowId = generateChronologicalId<DatabaseRowId>();
        sql`
            INSERT INTO
                ${sql.identifier(tableName)} (_id)
            VALUES
                (${rowId})
        `.exec(db);
        databaseActions.updateCellValue.run(db, {fieldId, rowId, value: true});

        const {fieldIndexes, rows} = databaseActions.getViewRowsPage.run(db, {
            tableOrViewId: viewId,
            afterCursor: null,
            endCursor: null,
        });

        const checkboxIndex = fieldIndexes.get(fieldId)!;
        expect(rows[0]![checkboxIndex]).toBe(true);
    });
});

describe("updateCellValue", () => {
    test("writes the value to the table after serializing through the provider", async () => {
        const db = await createDb();
        const {tableId, viewId, tableName} = databaseActions.createTable.run(db, {name: "T"});
        const {fieldId: nameFieldId} = sql`
            SELECT
                id
            FROM
                _alpine_fields
            WHERE
                table_id = ${tableId}
        `.selectOne(db, {
            fieldId: Schema.id<DatabaseFieldId>().originalPropertyKey("id"),
        });
        const rowId = generateChronologicalId<DatabaseRowId>();
        sql`
            INSERT INTO
                ${sql.identifier(tableName)} (_id)
            VALUES
                (${rowId})
        `.exec(db);

        databaseActions.updateCellValue.run(db, {
            fieldId: nameFieldId,
            rowId,
            value: "updated",
        });

        // Use the view to confirm the value flows through
        // serialize and deserialize correctly.
        const {fieldIndexes, rows} = databaseActions.getViewRowsPage.run(db, {
            tableOrViewId: viewId,
            afterCursor: null,
            endCursor: null,
        });
        expect(rows[0]![fieldIndexes.get(nameFieldId)!]).toBe("updated");
        db.close();
    });
});

describe("createRow", () => {
    test("inserts a row with the given _id and uses column defaults for the rest", async () => {
        const db = await createDb();
        const {tableId, tableName} = databaseActions.createTable.run(db, {name: "T"});
        const rowId = generateChronologicalId<DatabaseRowId>();

        databaseActions.createRow.run(db, {tableId, rowId});

        const rows = sql`
            SELECT
                *
            FROM
                ${sql.identifier(tableName)}
        `.selectAllUnknown(db);
        expect(rows).toMatchObject([{_id: rowId, name: ""}]);
        expect(rows[0]!._created_at).toBeDefined();
        db.close();
    });
});

describe("resizeField", () => {
    test("updates only the width of the targeted view+field row", async () => {
        const db = await createDb();
        const {tableId, viewId} = databaseActions.createTable.run(db, {name: "T"});
        const {fieldId} = addFieldAndGetId(db, tableId, viewId, "Status");

        databaseActions.resizeField.run(db, {viewId, fieldId, width: 321});

        const row = sql`
            SELECT
                width
            FROM
                _alpine_view_fields
            WHERE
                view_id = ${viewId}
                AND field_id = ${fieldId}
        `.selectOne(db, {width: Schema.integer});
        expect(row.width).toBe(321);
        db.close();
    });
});

describe("renameField", () => {
    test("renames both the metadata row and the underlying SQL column", async () => {
        const db = await createDb();
        const {tableId, viewId, tableName} = databaseActions.createTable.run(db, {name: "T"});
        const {fieldId} = addFieldAndGetId(db, tableId, viewId, "Status");

        databaseActions.renameField.run(db, {fieldId, name: "Priority"});

        const meta = sql`
            SELECT
                name,
                column_name
            FROM
                _alpine_fields
            WHERE
                id = ${fieldId}
        `.selectOne(db, {
            name: Schema.string,
            columnName: Schema.string.originalPropertyKey("column_name"),
        });
        expect(meta).toMatchObject({name: "Priority", columnName: "priority"});

        // Ensure the SQL column was renamed by querying it
        // (would throw if the column didn't exist).
        sql`
            SELECT
                priority
            FROM
                ${sql.identifier(tableName)}
        `.selectAllUnknown(db);
        db.close();
    });

    test("dedups against existing column names but excludes the field being renamed", async () => {
        const db = await createDb();
        const {tableId, viewId} = databaseActions.createTable.run(db, {name: "T"});
        const {fieldId: statusId} = addFieldAndGetId(db, tableId, viewId, "Status");
        addFieldAndGetId(db, tableId, viewId, "Priority");

        // Rename Status → Priority. The "priority" column is
        // taken by the other field, so a suffix should be added.
        databaseActions.renameField.run(db, {fieldId: statusId, name: "Priority"});

        const meta = sql`
            SELECT
                column_name
            FROM
                _alpine_fields
            WHERE
                id = ${statusId}
        `.selectOne(db, {columnName: Schema.string.originalPropertyKey("column_name")});
        expect(meta.columnName).toBe("priority_2");
        db.close();
    });

    test("can rename to a label whose slug equals the existing column (idempotent)", async () => {
        const db = await createDb();
        const {tableId, viewId} = databaseActions.createTable.run(db, {name: "T"});
        const {fieldId} = addFieldAndGetId(db, tableId, viewId, "Status");

        // The existing field's column is "status"; renaming to
        // "Status!" still slugifies to "status" — but the
        // dedup loop excludes the field being renamed
        // (`AND id != ${fieldId}`) so no suffix is added.
        databaseActions.renameField.run(db, {fieldId, name: "Status!"});

        const meta = sql`
            SELECT
                column_name
            FROM
                _alpine_fields
            WHERE
                id = ${fieldId}
        `.selectOne(db, {columnName: Schema.string.originalPropertyKey("column_name")});
        expect(meta.columnName).toBe("status");
        db.close();
    });
});
