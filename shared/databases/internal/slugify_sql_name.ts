import {assert} from "~/shared/helpers/control/assert.open_source.js";
import {convertToUrlPathnameSlug} from "~/shared/helpers/string/convert_to_url_pathname_slug.open_source.js";

/**
 * Use {@link convertToUrlPathnameSlug} to make a lowercase, `_`-separated name.
 * Then, make the result a SQL-safe identifier that does not start with `_`, a
 * digit, or the reserved `sqlite_` prefix.
 *
 * Deduplication against existing names is the caller's job — see
 * `formatUniqueSqlName` (in-memory set) and `formatUniqueTableSqlName` (registry
 * hash probe).
 */
export function slugifySqlName(name: string): string {
    let slug = convertToUrlPathnameSlug(name, "_");

    if (slug.startsWith("sqlite_")) {
        slug = "x_" + slug;
    }

    if (/^[0-9]/.test(slug)) {
        slug = "x_" + slug;
    }

    if (slug === "") {
        slug = "x";
    }

    assert(!slug.startsWith("_"), "slugified SQL name should never start with _");

    return slug;
}
