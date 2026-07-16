/**
 * The anchor id for a heading. Used both when rendering authored MDX headings and
 * when extracting the "On this page" items from raw MDX source, so the two always
 * agree.
 */
export function createDocumentationHeadingId(text: string): string {
    return text
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");
}
