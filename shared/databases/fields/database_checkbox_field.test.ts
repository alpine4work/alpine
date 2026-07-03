import sqlite3InitModule from "~/external/sqlite/ext/wasm/jswasm/sqlite3.mjs";
import {databaseCheckboxFieldProvider} from "~/shared/databases/fields/database_checkbox_field.js";
import {databaseFieldProviderStrings} from "~/shared/databases/fields/database_field_provider_test_helpers.js";
import {sql} from "~/shared/databases/sql.js";

const sqlite3Promise = sqlite3InitModule();
let dbCounter = 0;

async function createDbWithCheckedColumn() {
    const sqlite3 = await sqlite3Promise;
    const db = new sqlite3.oo1.DB(`/test-checkbox-${dbCounter++}.sqlite3`, "ct");
    const check = databaseCheckboxFieldProvider.generateCheckConstraint(sql.identifier("v"));
    sql`
        CREATE TABLE t (
            v INTEGER NOT NULL DEFAULT 0 ${check}
        )
    `.exec(db);
    return db;
}

describe("databaseCheckboxFieldProvider", () => {
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
            expect(databaseCheckboxFieldProvider.parseValueString(input)).toEqual({
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
                databaseFieldProviderStrings({
                    db,
                    provider: databaseCheckboxFieldProvider,
                    value,
                    config: {type: "checkbox"},
                }),
            ).toEqual({valueToString: expected, selectColumnAsString: expected});
            db.close();
        });
    });

    describe("generateCheckConstraint", () => {
        test("accepts integers", async () => {
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
