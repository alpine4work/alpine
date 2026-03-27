/* eslint-disable cyberworlds/string-quotes -- SQL literals */

import type {DatabaseFieldType} from "~/shared/databases/database_field_type.js";
import {assert} from "~/shared/helpers/control/assert.js";

/**
 * Slugify a human-readable name into a SQL-safe
 * identifier, then deduplicate against `existing` by
 * appending `_2`, `_3`, etc. as needed.
 *
 * The slug will never start with `_` (leading
 * underscores are stripped during slugification).
 */
export function formatUniqueSqlName(name: string, existing: ReadonlySet<string>): string {
    let slug = name
        .toLowerCase()
        .replace(/[^a-z0-9]/g, "_")
        .replace(/_+/g, "_");

    slug = slug.replace(/^_+/, "");

    if (slug.startsWith("sqlite_")) {
        slug = "x_" + slug;
    }

    if (slug === "" || /^[0-9]/.test(slug)) {
        slug = "x_" + slug;
    }

    slug = slug.replace(/_+$/, "");

    assert(!slug.startsWith("_"), "slugified SQL name should never start with _");

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
