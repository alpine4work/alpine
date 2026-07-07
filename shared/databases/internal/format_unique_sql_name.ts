import {slugifySqlName} from "~/shared/databases/internal/slugify_sql_name.js";

/**
 * Slugify a human-readable name into a SQL-safe identifier (see {@link
 * slugifySqlName}), then deduplicate against `existing` by appending `_2`, `_3`,
 * etc. as needed.
 */
export function formatUniqueSqlName(name: string, existing: ReadonlySet<string>): string {
    const slug = slugifySqlName(name);

    if (!existing.has(slug)) return slug;

    for (let i = 2; ; i++) {
        const candidate = `${slug}_${i}`;
        if (!existing.has(candidate)) return candidate;
    }
}
