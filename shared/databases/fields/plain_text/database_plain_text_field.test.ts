import sqlite3InitModule from "~/external/sqlite/ext/wasm/jswasm/sqlite3.mjs";
import {getDatabaseFieldStrings} from "~/shared/databases/fields/database_field_test_helpers.js";
import {generateDatabaseFieldCheckConstraint} from "~/shared/databases/fields/generate_database_field_check_constraint.js";
import {parseDatabaseFieldValueString} from "~/shared/databases/fields/parse_database_field_value_string.js";
import {sql} from "~/shared/databases/sql.js";

const sqlite3Promise = sqlite3InitModule();
let dbCounter = 0;

async function createDbWithCheckedColumn() {
    const sqlite3 = await sqlite3Promise;
    const db = new sqlite3.oo1.DB(`/test-plain-text-${dbCounter++}.sqlite3`, "ct");
    const check = generateDatabaseFieldCheckConstraint("PlainText", sql.identifier("v"));
    sql`
        CREATE TABLE t (
            v TEXT NOT NULL DEFAULT '' ${check}
        )
    `.exec(db);
    return db;
}

describe("databasePlainTextField", () => {
    describe("parseString", () => {
        test("any input is ok", () => {
            expect(parseDatabaseFieldValueString({type: "PlainText"}, "hello")).toEqual({
                ok: true,
                value: "hello",
            });
            expect(parseDatabaseFieldValueString({type: "PlainText"}, "")).toEqual({
                ok: true,
                value: "",
            });
            expect(parseDatabaseFieldValueString({type: "PlainText"}, "  spaces  ")).toEqual({
                ok: true,
                value: "  spaces  ",
            });
        });
    });

    describe("formatString", () => {
        test.each([
            ["hello", "hello"],
            ["", ""],
        ])("formats %j as %j", async (value, expected) => {
            const db = await createDbWithCheckedColumn();
            expect(
                getDatabaseFieldStrings({
                    db,
                    value,
                    config: {type: "PlainText"},
                }),
            ).toEqual({valueToString: expected, selectColumnAsString: expected});
            db.close();
        });
    });

    describe("generateCheckConstraint", () => {
        test("accepts text", async () => {
            const db = await createDbWithCheckedColumn();
            sql`
                INSERT INTO
                    t (v)
                VALUES
                    ('hello')
            `.exec(db);
            db.close();
        });

        test("rejects blobs (which TEXT affinity does not coerce)", async () => {
            const db = await createDbWithCheckedColumn();
            expect(() =>
                sql`
                    INSERT INTO
                        t (v)
                    VALUES
                        (x'00')
                `.exec(db),
            ).toThrow("CHECK constraint failed");
            db.close();
        });
    });
});
