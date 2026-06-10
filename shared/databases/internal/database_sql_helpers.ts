import {assert} from "~/shared/helpers/control/assert.js";

/**
 * Slugify a human-readable name into a SQL-safe identifier, then deduplicate
 * against `existing` by appending `_2`, `_3`, etc. as needed.
 *
 * The slug will never start with `_` (leading underscores are stripped during
 * slugification).
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
