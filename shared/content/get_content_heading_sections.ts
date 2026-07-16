import {Node} from "prosemirror-model";
import {clampHeadingLevel} from "~/shared/content/content_schema.js";
import {convertToUrlPathnameSlug} from "~/shared/helpers/string/convert_to_url_pathname_slug.js";

/**
 * A section of content rooted at a top-level heading node. A heading's section
 * spans all of the blocks following the heading up to (but not including) the next
 * heading with the same or a higher level, or the end of the doc.
 */
export type ContentHeadingSection = {
    /** The position of the heading node in the doc. */
    readonly headingPos: number;

    /** The heading node itself. */
    readonly headingNode: Node;

    /** The clamped heading level (1–3). */
    readonly level: number;

    /**
     * URL slug derived from the heading's text, like a Markdown heading anchor.
     * Duplicate slugs in the same doc get a numeric suffix (`slug`, `slug-1`,
     * `slug-2`, …) in document order. Null when the heading has no sluggable text.
     *
     * Slugs are derived, not stored, so a slug in a URL is not guaranteed to still
     * exist in the doc it points to.
     */
    readonly slug: string | null;

    /**
     * The start of the section's content: the position right after the heading node.
     * Equal to `sectionTo` when the section has no content.
     */
    readonly sectionFrom: number;

    /** The end of the section's content. */
    readonly sectionTo: number;
};

// Same shape as `ContentHeadingSection` but `sectionTo` stays writable while the
// section is still open during the walk.
type ContentHeadingOpenSection = {
    readonly headingPos: number;
    readonly headingNode: Node;
    readonly level: number;
    readonly slug: string | null;
    readonly sectionFrom: number;
    sectionTo: number;
};

/**
 * Collect the heading sections of a doc, in document order. Only top-level
 * headings (direct children of the doc) are considered.
 *
 * This runs on every editor transaction while a section is collapsed (see
 * `contentEditorHeadingCollapsePlugin()`), so it's built to stay cheap: a single
 * pass over the doc's top-level children where non-heading children are skipped
 * with a type check and the only per-heading work is slugifying its (short) text.
 */
export function getContentHeadingSections(doc: Node): ReadonlyArray<ContentHeadingSection> {
    const sections: Array<ContentHeadingOpenSection> = [];
    const countBySlug = new Map<string, number>();

    // Sections whose end we haven't seen yet. The stack holds strictly increasing
    // levels (a level-2 heading inside a level-1 section, …) so it's at most as deep
    // as the number of heading levels.
    const openSections: Array<ContentHeadingOpenSection> = [];

    doc.forEach((node, offset) => {
        if (node.type.name !== "heading") return;

        const level = clampHeadingLevel(node.attrs.level);

        // This heading ends every open section with the same or a lower level.
        while (openSections.length > 0 && openSections[openSections.length - 1]!.level >= level) {
            openSections.pop()!.sectionTo = offset;
        }

        const baseSlug = convertToUrlPathnameSlug(node.textContent);
        let slug: string | null = null;
        if (baseSlug !== "") {
            const count = countBySlug.get(baseSlug) ?? 0;
            countBySlug.set(baseSlug, count + 1);
            slug = count === 0 ? baseSlug : `${baseSlug}-${count}`;
        }

        const section: ContentHeadingOpenSection = {
            headingPos: offset,
            headingNode: node,
            level,
            slug,
            sectionFrom: offset + node.nodeSize,
            // Sections that are still open when the walk finishes extend to the end of the
            // doc, so that's the default.
            sectionTo: doc.content.size,
        };
        sections.push(section);
        openSections.push(section);
    });

    return sections;
}
