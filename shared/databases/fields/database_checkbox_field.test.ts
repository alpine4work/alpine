/* eslint-disable cyberworlds/string-quotes -- SQL literals */

import sqlite3InitModule from "~/external/sqlite/ext/wasm/jswasm/sqlite3.mjs";
import {databaseCheckboxFieldProvider} from "~/shared/databases/fields/database_checkbox_field.js";
import {sql} from "~/shared/databases/sql.js";

const sqlite3Promise = sqlite3InitModule();
let dbCounter = 0;

async function createDbWithCheckedColumn() {
    const sqlite3 = await sqlite3Promise;
    const db = new sqlite3.oo1.DB(`/test-checkbox-${dbCounter++}.sqlite3`, "ct");
    const check = databaseCheckboxFieldProvider.generateCheckConstraint("v");
    sql`
        CREATE TABLE t (
            v INTEGER NOT NULL DEFAULT 0 ${check}
        )
    `.exec(db);
    return db;
}

describe("databaseCheckboxFieldProvider", () => {
    test("getDefaultConfig returns just the type discriminant", () => {
        expect(databaseCheckboxFieldProvider.getDefaultConfig()).toEqual({type: "checkbox"});
    });

    describe("parseString", () => {
        const config = {type: "checkbox" as const};

        test("'true' and '1' parse to true", () => {
            expect(databaseCheckboxFieldProvider.parseString("true", config)).toEqual({
                ok: true,
                value: true,
            });
            expect(databaseCheckboxFieldProvider.parseString("1", config)).toEqual({
                ok: true,
                value: true,
            });
        });

        test("'false', '0', and empty parse to false", () => {
            expect(databaseCheckboxFieldProvider.parseString("false", config)).toEqual({
                ok: true,
                value: false,
            });
            expect(databaseCheckboxFieldProvider.parseString("0", config)).toEqual({
                ok: true,
                value: false,
            });
            expect(databaseCheckboxFieldProvider.parseString("", config)).toEqual({
                ok: true,
                value: false,
            });
        });

        test("anything else is not ok", () => {
            expect(databaseCheckboxFieldProvider.parseString("yes", config).ok).toBe(false);
            expect(databaseCheckboxFieldProvider.parseString("2", config).ok).toBe(false);
            expect(databaseCheckboxFieldProvider.parseString("True", config).ok).toBe(false);
        });
    });

    describe("formatString", () => {
        const config = {type: "checkbox" as const};

        test("true → 'true', false → 'false'", () => {
            expect(databaseCheckboxFieldProvider.formatString(true, config)).toBe("true");
            expect(databaseCheckboxFieldProvider.formatString(false, config)).toBe("false");
        });
    });

    describe("toSqlValue / fromSqlValue", () => {
        test("true ↔ 1, false ↔ 0", () => {
            expect(databaseCheckboxFieldProvider.toSqlValue(true)).toBe(1);
            expect(databaseCheckboxFieldProvider.toSqlValue(false)).toBe(0);
            expect(databaseCheckboxFieldProvider.fromSqlValue(1)).toBe(true);
            expect(databaseCheckboxFieldProvider.fromSqlValue(0)).toBe(false);
        });

        test("non-1 integers and null deserialize to false", () => {
            expect(databaseCheckboxFieldProvider.fromSqlValue(2)).toBe(false);
            expect(databaseCheckboxFieldProvider.fromSqlValue(null)).toBe(false);
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
