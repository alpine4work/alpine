import {getDatabaseFieldStrings} from "~/shared/databases/fields/database_field_test_helpers.js";
import {generateDatabaseFieldCheckConstraint} from "~/shared/databases/fields/generate_database_field_check_constraint.js";
import {parseDatabaseFieldValueString} from "~/shared/databases/fields/parse_database_field_value_string.js";
import {sql} from "~/shared/databases/sql.js";
import {loadSqlite3} from "~/shared/databases/sqlite.js";

const sqlite3Promise = loadSqlite3();
let dbCounter = 0;

/**
 * Creates a checkbox table with the production storage constraint. The tests use
 * this table to compare application formatting with SQLite formatting.
 */
async function createDbWithCheckedColumn() {
    const sqlite3 = await sqlite3Promise;
    const db = new sqlite3.oo1.DB(`/test-checkbox-${dbCounter++}.sqlite3`, "ct");
    const check = generateDatabaseFieldCheckConstraint("Checkbox", sql.identifier("v"));
    sql`
        CREATE TABLE t (
            v INTEGER NOT NULL DEFAULT 0 ${check}
        )
    `.exec(db);
    return db;
}

describe("databaseCheckboxField", () => {
    describe("parseString", () => {
        test.each([
            ["", false],
            ["   ", false],
            ["false", false],
            ["FALSE", false],
            ["False", false],
            ["0", false],
            ["no", false],
            ["No", false],
            ["n", false],
            ["off", false],
            ["unchecked", false],
            ["f", false],
            ["F", false],
            ["✗", false],
            ["✘", false],
            ["☐", false],
            ["  false  ", false],
            ["true", true],
            ["TRUE", true],
            ["1", true],
            ["yes", true],
            ["y", true],
            ["on", true],
            ["checked", true],
            ["t", true],
            ["x", true],
            ["X", true],
            ["✓", true],
            ["✔", true],
            ["☑", true],
            ["2", true],
            ["arbitrary text", true],
            ["  yes  ", true],
        ])("parses %j as %s", (input, expected) => {
            expect(parseDatabaseFieldValueString({type: "Checkbox"}, input)).toEqual({
                ok: true,
                value: expected,
            });
        });
    });

    describe("formatString", () => {
        test.each([
            [true, "true"],
            [false, "false"],
        ])("formats %s as %s", async (value, expected) => {
            const db = await createDbWithCheckedColumn();
            expect(
                getDatabaseFieldStrings({
                    db,
                    value,
                    config: {type: "Checkbox"},
                }),
            ).toEqual({valueToString: expected, selectColumnAsString: expected});
            db.close();
        });
    });

    describe("generateCheckConstraint", () => {
        test("accepts zero and one", async () => {
            const db = await createDbWithCheckedColumn();
            sql`
                INSERT INTO
                    t (v)
                VALUES
                    (1)
            `.exec(db);
            sql`
                INSERT INTO
                    t (v)
                VALUES
                    (0)
            `.exec(db);
            db.close();
        });

        test.each([-1, 2])("rejects integer %i", async value => {
            const db = await createDbWithCheckedColumn();
            expect(() =>
                sql`
                    INSERT INTO
                        t (v)
                    VALUES
                        (${value})
                `.exec(db),
            ).toThrow("CHECK constraint failed");
            db.close();
        });

        test("rejects text", async () => {
            const db = await createDbWithCheckedColumn();
            expect(() =>
                sql`
                    INSERT INTO
                        t (v)
                    VALUES
                        ('true')
                `.exec(db),
            ).toThrow("CHECK constraint failed");
            db.close();
        });
    });
});
