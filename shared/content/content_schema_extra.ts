import {NodeSpec} from "prosemirror-model";
import {clamp} from "~/shared/helpers/number/clamp.js";
import {Schema} from "~/shared/schema/schema.js";
import {contentSchemaStyles} from "~/shared/styles/styles.js";

const {dividerClassName, headingLevel1ClassName, headingLevel2ClassName, headingLevel3ClassName} =
    contentSchemaStyles;

/**
 * TypeScript convenience function for creating a `NodeSpec`. Forces us to
 * adhere to the `NodeSpec` format while allowing the return type to be an
 * instance of `NodeSpec`. (So node keys are preserved, for instance.)
 */
function createProsemirrorNodesSpec<Nodes extends {[key: string]: NodeSpec}>(nodes: Nodes): Nodes {
    return nodes;
}

export function clampHeadingLevel(level: unknown): number {
    return typeof level === "number" ? clamp(1, Math.floor(level), 3) : 1;
}

/**
 * ProseMirror nodes that allow users to create structure in longer form content
 * like posts and documents.
 *
 * Includes headings and dividers.
 */
export const contentStructuralProsemirrorNodeSpecs = createProsemirrorNodesSpec({
    /*
     * Crucial for adding structure to the document. Can be extended in the
     * future with an outline feature.
     *
     * Can only be levels 1, 2, and 3.
     *
     * The element used for a heading is its level plus 1. For example, a
     * heading with level 1 will use an `<h2>` instead of an `<h1>`. This is
     * because our support for titles usually lives outside content (e.g.
     * tasks). This also prevents users from confusing screen readers by
     * creating a bunch of level 1 headings.
     */
    heading: {
        group: "block",
        content: "inline*",
        attrs: {
            level: {
                schema: Schema.integer.min(1).max(3),
                default: 1,
            },
        },
        toDOM: node => {
            const level = clampHeadingLevel(node.attrs.level);

            return [
                `h${level + 1}`,
                {
                    class:
                        level === 3
                            ? headingLevel3ClassName
                            : level === 2
                            ? headingLevel2ClassName
                            : headingLevel1ClassName,
                },
                0,
            ];
        },
        parseDOM: [
            {tag: "h1", priority: 50, attrs: {level: 1}},
            {tag: "h2", priority: 50, attrs: {level: 1}},
            {tag: "h3", priority: 50, attrs: {level: 2}},
            {tag: "h4", priority: 50, attrs: {level: 3}},
            {tag: "h5", priority: 50, attrs: {level: 3}},
            {tag: "h6", priority: 50, attrs: {level: 3}},
        ],
    },

    /**
     * Also known as a horizontal rule. Another way to organize documents
     * alongside headers. Allows the writer to specify an unnamed break in
     * content.
     */
    divider: {
        group: "block",
        toDOM: () => ["hr", {class: dividerClassName}],
        parseDOM: [{tag: "hr"}],
    },
});
