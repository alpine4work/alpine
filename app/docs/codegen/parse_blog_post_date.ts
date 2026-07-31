import {assert} from "~/shared/helpers/control/assert.js";

/** Parse a real authored calendar date in the blog frontmatter format. */
export function parseBlogPostDate({
    value,
    fieldName,
    sourceName,
}: {
    value: unknown;
    fieldName: string;
    sourceName: string;
}): string {
    const expectedMessage = `Expected ${fieldName} YYYY-MM-DD for ${sourceName}`;
    assert(typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value), expectedMessage);
    assert(
        new Date(`${value}T00:00:00.000Z`).toISOString() === `${value}T00:00:00.000Z`,
        expectedMessage,
    );
    return value;
}
