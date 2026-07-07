import {assert} from "~/shared/helpers/control/assert.js";

/**
 * Slugify a human-readable name into a SQL-safe identifier: lowercase, `_`-
 * separated, never starting with `_`, a digit, or the reserved `sqlite_` prefix.
 *
 * Deduplication against existing names is the caller's job — see
 * `formatUniqueSqlName` (in-memory set) and `formatUniqueTableName` (registry hash
 * probe).
 */
export function slugifySqlName(name: string): string {
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

    return slug;
}
