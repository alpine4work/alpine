/* eslint-disable cyberworlds/string-quotes -- SQL literals */

import type {Database} from "~/external/sqlite/ext/wasm/jswasm/sqlite3.mjs";
import type {DatabaseFieldType} from "~/shared/databases/database_field_type.js";
import {assert} from "~/shared/helpers/control/assert.js";

/**
 * Derive a unique, SQL-safe table name from a
 * human-readable name.
 */
export function toSqlName(db: Database, name: string): string {
    // Slugify: lowercase, replace non-alphanumeric
    // with `_`, collapse runs.
    let slug = name
        .toLowerCase()
        .replace(/[^a-z0-9]/g, "_")
        .replace(/_+/g, "_");

    // Strip leading underscores.
    slug = slug.replace(/^_+/, "");

    // Rewrite sqlite_ prefix.
    if (slug.startsWith("sqlite_")) {
        slug = "x_" + slug;
    }

    // If empty or starts with digit, prefix x_.
    if (slug === "" || /^[0-9]/.test(slug)) {
        slug = "x_" + slug;
    }

    // Strip trailing underscores.
    slug = slug.replace(/_+$/, "");

    // Ensure uniqueness against existing table names.
    const existing = new Set(
        (
            db.exec("SELECT table_name FROM _alpine_tables", {
                returnValue: "resultRows",
                rowMode: "array",
            }) as Array<[string]>
        ).map(row => row[0]),
    );

    if (!existing.has(slug)) return slug;

    for (let i = 2; ; i++) {
        const candidate = `${slug}_${i}`;
        if (!existing.has(candidate)) return candidate;
    }
}

/**
 * Map a {@link DatabaseFieldType} type name to a SQLite
 * column type affinity.
 */
export function alpineFieldTypeToSqliteType(type: DatabaseFieldType["type"]): string {
    switch (type) {
        case "plainText":
            return "TEXT";
        case "number":
            return "REAL";
        case "boolean":
            return "INTEGER";
        default:
            assert(false, `unknown Alpine field type: ${type}`);
    }
}

/**
 * Generate a CHECK constraint for a column based on its
 * SQLite type affinity and nullability.
 */
export function checkConstraintForColumn(
    columnName: string,
    sqliteType: string,
    notNull: boolean,
): string {
    switch (sqliteType) {
        case "TEXT":
            return notNull
                ? `CHECK(typeof(${columnName}) = 'text')`
                : `CHECK(typeof(${columnName}) = 'text' OR ${columnName} IS NULL)`;
        case "REAL":
            return notNull
                ? `CHECK(typeof(${columnName}) IN ('real', 'integer'))`
                : `CHECK(typeof(${columnName}) IN ('real', 'integer') OR ${columnName} IS NULL)`;
        case "INTEGER":
            return notNull
                ? `CHECK(typeof(${columnName}) = 'integer')`
                : `CHECK(typeof(${columnName}) = 'integer' OR ${columnName} IS NULL)`;
        default:
            assert(false, `unsupported SQLite type: ${sqliteType}`);
    }
}
