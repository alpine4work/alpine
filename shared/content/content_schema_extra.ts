import {NodeSpec} from "prosemirror-model";
import {paragraphParseRulePriority, paragraphParseRules} from "~/shared/content/content_schema.js";
import {
    dividerClassName,
    fileClassName,
    fileFloatClassName,
    fileFloatLeftClassName,
    fileFloatRightClassName,
    fileRowLikeClassName,
    headingLevel1ClassName,
    headingLevel2ClassName,
    headingLevel3ClassName,
} from "~/shared/content/content_styles.js";
import {FileIdOrFileEntityIdSchema, isFileEntityId} from "~/shared/files/file_entity_id.js";
import {clamp} from "~/shared/helpers/number/clamp.js";
import {isId} from "~/shared/id/id.js";
import {FileId, SpaceId} from "~/shared/id/types/id_types.js";
import {Schema} from "~/shared/schema/schema.js";
import {parseSearchEntityIdFromUrl} from "~/shared/search/parse_search_entity_id_from_url.js";

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
        // Don't allow selecting with a `NodeSelection`. The default is `true` but
        // there's only a small number of nodes (e.g. `divider`) we actually want to
        // let be selectable.
        selectable: false,
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
        selectable: true,
        toDOM: () => ["hr", {class: dividerClassName}],
        parseDOM: [{tag: "hr"}],
    },
});

/**
 * ProseMirror nodes that allow users to create content with files.
 */
export const createContentFileProsemirrorNodeSpecs = ({
    fileMarks,
    withTable,
}: {fileMarks?: string; withTable?: boolean} = {}) => {
    const baseNodes: {[key: string]: NodeSpec} = {
        /**
         * Renders one or more files in content in a horizontal row. When the user
         * first adds a file to a document it'll be in a `fileRow`. A single, centered,
         * file is a `fileRow`.
         *
         * Up to three files may be rendered horizontally next to each other. File rows
         * may be stacked vertically to create an image gallery. All images in a file
         * row have the same height and we try our best to fill the entire width of the
         * document with each file row. See `layoutContentFileRow()` for more
         * information on how we layout a file row.
         */
        fileRow: {
            group: "block fileRowLike",
            content: "file{1,3}",
            defining: true,
            isolating: true,
            // Don't allow selecting with a `NodeSelection`. The default is `true` but
            // there's only a small number of nodes (e.g. `divider`) we actually want to
            // let be selectable.
            selectable: false,
            // Allow any marks available on `file` nodes on `fileRow`s (e.g. comment marks
            // in documents). Comments should never appear on `fileRow`. Only on `file`. We
            // validate this is the case in `get_collaboratively_update_content_result.ts`.
            marks: fileMarks,
            // same class `fileRowLikeClassName` being used for fileRow and fileRowTable
            toDOM: () => ["div", {class: fileRowLikeClassName}, 0],
            // A `<div>` or `<p>` with a direct child that has a `data-cy-tmp-file`
            // attribute is parsed as a `fileRow`.
            //
            // The clipboard serializer converts files into `<img>`, `<video>`, `<audio>`,
            // or `<object>` tags on copy. Then on paste `<ContentEditor>`'s
            // `transformPastedDOM` converts those elements into a `<div>` with a
            // `data-cy-tmp-file` attribute.
            parseDOM: paragraphParseRules.map(paragraphParseRule => ({
                ...paragraphParseRule,
                // Make sure this is higher priority than our paragraph `div` parse rule.
                priority: paragraphParseRule.priority + 50,
                getAttrs: node => {
                    if (!(node instanceof HTMLElement)) return false;
                    let hasDirectFileChildNode = false;
                    for (const childNode of node.childNodes) {
                        if (
                            (childNode instanceof HTMLElement &&
                                childNode.hasAttribute("data-cy-tmp-file")) ||
                            (childNode instanceof HTMLIFrameElement &&
                                childNode.src.match(/^[a-zA-Z0-9]+:\/\/[^/]+\/s\/[^/]+/))
                        ) {
                            hasDirectFileChildNode = true;
                            break;
                        }
                    }
                    if (!hasDirectFileChildNode) return false;
                    return {};
                },
            })),
        },

        /**
         * A file attached to our content. Files can be images, videos, documents
         * (e.g. PDFs or Microsoft Word docs), audio, code, and more.
         *
         * Files are never directly embedded in content. Instead they must be wrapped
         * in some container. For example, `fileRow`. The `file` node is responsible
         * for rendering file content whereas the container is responsible for figuring
         * out how to lay out the file.
         */
        file: {
            defining: true,
            isolating: true,
            selectable: true,
            marks: fileMarks,
            attrs: {
                // `fileId` is nullable so the `file` node is generatable. Otherwise
                // ProseMirror complains that `fileRow` can't be generated because it requires
                // at least one file node. `fileId: null` files will always render with an
                // error. You should always provide a `FileId`.
                fileId: {
                    schema: FileIdOrFileEntityIdSchema.nullable(),
                    default: null,
                },
            },
            toDOM: () => ["div", {class: fileClassName}],
            parseDOM: [
                {
                    // The clipboard serializer converts files into `<img>`, `<video>`, `<audio>`,
                    // or `<object>` tags on copy. Then on paste `<ContentEditor>`'s
                    // `transformPastedDOM` converts those elements into a `<div>` with a
                    // `data-cy-tmp-file` attribute.
                    tag: "div[data-cy-tmp-file]",
                    // Make sure this is higher priority than our paragraph `div` parse rule.
                    priority: paragraphParseRulePriority + 50,
                    getAttrs: node => {
                        if (!(node instanceof HTMLElement)) return false;
                        const fileId = node.getAttribute("data-cy-tmp-file");
                        if (fileId === null) return false;
                        if (fileId === "null") return {fileId: null};
                        if (!isId<FileId>(fileId)) return false;
                        return {fileId};
                    },
                },
                {
                    // The clipboard serializer converts entity files to `<iframe>`s. Parse the
                    // `<iframe>` back into a file node. `<ContentEditor>` will fetch the referenced
                    // entity before rendering.
                    tag: "iframe",
                    getAttrs: node => {
                        if (!(node instanceof HTMLIFrameElement)) return false;

                        // NOTE(calebmer): Matching `spaceId` from the current URL is a little hacky.
                        // What if someday you can view content from two spaces at a time? (e.g. In
                        // a peek.)
                        const spaceIdMatch = window.location.pathname.match(/^\/s\/([^/]+)/);
                        if (!spaceIdMatch) return false;

                        const spaceId = spaceIdMatch[1]!;
                        if (!isId<SpaceId>(spaceId)) return false;

                        const entityId = parseSearchEntityIdFromUrl(spaceId, node.src);
                        if (entityId === null || !isFileEntityId(entityId)) return false;

                        return {fileId: entityId};
                    },
                },
            ],
        },
    };

    // If `withTable` is true, add a `fileRowTable` node into the content spec.
    //
    // In Alpine there are different places where we are using prosemirror editor.
    // For eg: documents, posts, task notes, messages, etc.
    //
    // In documents, we want to allow tables and `fileRowTable`s.
    //
    // In message, we are managing file uploads differently by attaching it to message,
    // in that case we don't want to allow `fileRowTable`s in the content spec.
    //
    // So we have this flag to control whether we add the `fileRowTable` node or not.
    if (withTable) {
        baseNodes.fileRowTable = {
            group: "tableBlock fileRowLike",
            // must have exactly one `file` node as child
            content: "file{1,1}",
            defining: true,
            isolating: true,
            // Don't allow selecting with a `NodeSelection`. The default is `true` but
            // there's only a small number of nodes (e.g. `divider`) we actually want to
            // let be selectable.
            selectable: false,
            // Allow any marks available on `file` nodes on `fileRowTable`s (e.g. comment marks
            // in documents). Comments should never appear on `fileRowTable`. Only on `file`. We
            // validate this is the case in `get_collaboratively_update_content_result.ts`.
            marks: fileMarks,
            attrs: {},
            // same classes being used for fileRow and fileRowTable
            toDOM: () => ["div", {class: fileRowLikeClassName}, 0],
            parseDOM: paragraphParseRules.map(paragraphParseRule => ({
                ...paragraphParseRule,
                // Make sure this is higher priority than our paragraph `div` parse rule
                // and our `fileRow` parse rule.
                priority: paragraphParseRule.priority + 100,
                // Only parse if the parent node is a `table`.
                context: "table//",
                getAttrs: node => {
                    if (!(node instanceof HTMLElement)) return false;
                    let hasDirectFileChildNode = false;
                    for (const childNode of node.childNodes) {
                        if (
                            (childNode instanceof HTMLElement &&
                                childNode.hasAttribute("data-cy-tmp-file")) ||
                            (childNode instanceof HTMLIFrameElement &&
                                childNode.src.match(/^[a-zA-Z0-9]+:\/\/[^/]+\/s\/[^/]+/))
                        ) {
                            hasDirectFileChildNode = true;
                            break;
                        }
                    }
                    if (!hasDirectFileChildNode) return false;
                    return {};
                },
            })),
        };
    }

    return createProsemirrorNodesSpec(baseNodes);
};

export const createContentFileFloatProsemirrorNodeSpecs = ({
    fileMarks,
}: {fileMarks?: string} = {}) =>
    createProsemirrorNodesSpec({
        /**
         * Renders a single file floating to the left or right. Text will wrap around
         * the floating file. A useful rendering mode for files when you're writing
         * prose. You can put your file to the side of your text where it will
         * supplements the document's content instead of interrupting it.
         *
         * Keyboard navigation and selection of floated files can be non-intuitive at
         * times. Floated files usually exist in the document at their top edge.
         * However, if there would be multiple conflicting floats at a given X position
         * than they're cleared with the CSS `clear: both`. So a float may be visually
         * pushed down the page by another float. This means a floating file can be in
         * a completely different position visually than it is in the document.
         * Changing keyboard navigation and selection interactions so they match the
         * visual position of the file would be a difficult, maybe impossible, task. So
         * we accept the user can get into some weird states with floating files and
         * leave them to it.
         */
        fileFloat: {
            group: "block",
            content: "file",
            defining: true,
            isolating: true,
            // Don't allow selecting with a `NodeSelection`. The default is `true` but
            // there's only a small number of nodes (e.g. `divider`) we actually want to
            // let be selectable.
            selectable: false,
            // Allow any marks available on `file` nodes on `fileFloat`s (e.g. comment marks
            // in documents). Comments should never appear on `fileFloat`. Only on `file`. We
            // validate this is the case in `get_collaboratively_update_content_result.ts`.
            marks: fileMarks,
            attrs: {
                direction: {
                    schema: Schema.enum(["left", "right"]),
                },
            },
            toDOM: node => [
                "div",
                {
                    class: `${fileFloatClassName} ${
                        node.attrs.direction === "left"
                            ? fileFloatLeftClassName
                            : fileFloatRightClassName
                    }`,
                },
                0,
            ],
            parseDOM: [
                {
                    // A `<div>` with a style attribute including `float: left` or `float: right`
                    // and at least one child that has a `data-cy-tmp-file` attribute is parsed as
                    // a `fileFloat`.
                    //
                    // The clipboard serializer converts files into `<img>`, `<video>`, `<audio>`,
                    // or `<object>` tags on copy. Then on paste `<ContentEditor>`'s
                    // `transformPastedDOM` converts those elements into a `<div>` with a
                    // `data-cy-tmp-file` attribute.
                    tag: "div[style*=float]",
                    // Make sure this is higher priority than our paragraph `div` parse rule. Also
                    // our `fileRow` `div` parse rule.
                    priority: paragraphParseRulePriority + 100,
                    getAttrs: node => {
                        if (!(node instanceof HTMLElement)) return false;

                        if (node.style.float !== "left" && node.style.float !== "right")
                            return false;

                        for (const childNode of node.childNodes) {
                            if (
                                (childNode instanceof HTMLElement &&
                                    childNode.hasAttribute("data-cy-tmp-file")) ||
                                (childNode instanceof HTMLIFrameElement &&
                                    childNode.src.match(/^[a-zA-Z0-9]+:\/\/[^/]+\/s\/[^/]+/))
                            ) {
                                return {direction: node.style.float};
                            }
                        }

                        return false;
                    },
                },
            ],
        },
    });
