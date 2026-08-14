import {NodeSpec} from "prosemirror-model";
import {ContentMention, ContentMentionSchema} from "~/shared/content/content_mention.js";
import {paragraphParseRulePriority, paragraphParseRules} from "~/shared/content/content_schema.js";
import {
    fileClassName,
    fileFloatClassName,
    fileFloatLeftClassName,
    fileFloatRightClassName,
    fileRowLikeClassName,
} from "~/shared/design/core/constant_class_names.js";
import {FileIdOrFileEntityIdSchema, isFileEntityId} from "~/shared/files/file_entity_id.js";
import {isId} from "~/shared/id/id.open_source.js";
import {AccountId, FileId, SiteId} from "~/shared/id/types/id_types.open_source.js";
import {Schema} from "~/shared/schema/schema.js";
import {parseSearchEntityIdFromUrl} from "~/shared/search/parse_search_entity_id_from_url.js";
import {isSearchMentionEntityId} from "~/shared/search/search_entity_id.js";

/**
 * TypeScript convenience function for creating a `NodeSpec`. Forces us to adhere
 * to the `NodeSpec` format while allowing the return type to be an instance of
 * `NodeSpec`. (So node keys are preserved, for instance.)
 */
function createProsemirrorNodesSpec<Nodes extends {[key: string]: NodeSpec}>(nodes: Nodes): Nodes {
    return nodes;
}

function isFileEntityUrl(url: string): boolean {
    const entityId = parseSearchEntityIdFromUrl(url);
    return entityId !== null && isFileEntityId(entityId);
}

export const contentMentionProsemirrorNodeSpecs = createProsemirrorNodesSpec({
    /**
     * A mention is an inline reference to an account. Mentioning an account also sends
     * a notification to the account to get their attention.
     *
     * A mention node alone in content does not include all the data we need to render
     * it. When sending content to the client we need to load extra related data. In
     * the case of an account, their name and avatar.
     */
    mention: {
        inline: true,
        group: "inline",
        selectable: true,
        // Allow all marks on `mention`.
        marks: "_",
        attrs: {
            mention: {
                schema: ContentMentionSchema,
            },
        },
        // The rendering of mentions is entirely managed with a custom renderer since we
        // need to get data from `ContentReferences`.
        toDOM: () => ["span", {}, ""],
        parseDOM: [
            {
                tag: "span[data-cy-mention]",
                getAttrs: node => {
                    if (!(node instanceof HTMLElement)) return false;

                    const accountId = node.getAttribute("data-cy-mention");
                    if (!accountId) return false;
                    if (!isId<AccountId>(accountId)) return false;

                    const isShort = node.getAttribute("data-cy-mention-short") !== null;

                    const mention: ContentMention = {
                        type: "Account",
                        accountId,
                        isShort,
                    };

                    return {mention};
                },
            },
            {
                priority: 100,
                tag: "a[data-cy-mention]",
                getAttrs: node => {
                    if (!(node instanceof HTMLElement)) return false;

                    const href = node.getAttribute("href");
                    if (!href) return false;

                    // If `data-cy-site` is set, this `<a>` is a Site mention whose `href` points to
                    // the site's first entity (e.g. a Document URL). Parsing the `href` would give us
                    // back the first entity, not the site, so we read the `SiteId` from `data-cy-site`
                    // instead to reconstruct the `Site:` mention.
                    const siteId = node.getAttribute("data-cy-site");
                    if (siteId !== null) {
                        if (!isId<SiteId>(siteId)) return false;

                        const mention: ContentMention = {
                            type: "SearchEntity",
                            entityId: `Site:${siteId}`,
                        };

                        return {mention};
                    }

                    // We parse the `SearchEntityId` in `data-cy-mention` using whatever `SpaceId` is
                    // in the URL. It's the responsibility of `<ContentEditor>`'s `transformPastedDOM`
                    // to remove the `data-cy-mention` attribute from any mentions in the wrong space.
                    // Since only `<ContentEditor>` will know if we're in the right space.
                    const entityId = parseSearchEntityIdFromUrl(href);
                    if (!entityId) return false;
                    if (!isSearchMentionEntityId(entityId)) return false;

                    const mention: ContentMention = {
                        type: "SearchEntity",
                        entityId,
                    };

                    return {mention};
                },
            },
        ],
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
         * Renders one or more files in content in a horizontal row. When the user first
         * adds a file to a document it'll be in a `fileRow`. A single, centered, file is a
         * `fileRow`.
         *
         * Up to three files may be rendered horizontally next to each other. File rows may
         * be stacked vertically to create an image gallery. All images in a file row have
         * the same height and we try our best to fill the entire width of the document
         * with each file row. See `layoutContentFileRow()` for more information on how we
         * layout a file row.
         */
        fileRow: {
            group: "block fileRowLike",
            content: "file{1,3}",
            defining: true,
            isolating: true,
            // Don't allow selecting with a `NodeSelection`. The default is `true` but there's
            // only a small number of nodes (e.g. `divider`) we actually want to let be
            // selectable.
            selectable: false,
            // Allow any marks available on `file` nodes on `fileRow`s (e.g. comment marks in
            // documents). Comments should never appear on `fileRow`. Only on `file`. We
            // validate this is the case in `get_collaboratively_update_content_result.ts`.
            marks: fileMarks,
            // same class `fileRowLikeClassName` being used for fileRow and fileRowTable
            toDOM: () => ["div", {class: fileRowLikeClassName}, 0],
            // A `<div>` or `<p>` with a direct child that has a `data-cy-tmp-file` attribute
            // is parsed as a `fileRow`.
            //
            // The clipboard serializer converts files into `<img>`, `<video>`, `<audio>`, or
            // `<object>` tags on copy. Then on paste `<ContentEditor>`'s `transformPastedDOM`
            // converts those elements into a `<div>` with a `data-cy-tmp-file` attribute.
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
                                isFileEntityUrl(childNode.src))
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
         * A file attached to our content. Files can be images, videos, documents (e.g.
         * PDFs or Microsoft Word docs), audio, code, and more.
         *
         * Files are never directly embedded in content. Instead they must be wrapped in
         * some container. For example, `fileRow`. The `file` node is responsible for
         * rendering file content whereas the container is responsible for figuring out how
         * to lay out the file.
         */
        file: {
            defining: true,
            isolating: true,
            selectable: true,
            marks: fileMarks,
            attrs: {
                // `fileId` is nullable so the `file` node is generatable. Otherwise ProseMirror
                // complains that `fileRow` can't be generated because it requires at least one
                // file node. `fileId: null` files will always render with an error. You should
                // always provide a `FileId`.
                fileId: {
                    schema: FileIdOrFileEntityIdSchema.nullable(),
                    default: null,
                },
            },
            toDOM: () => ["div", {class: fileClassName}],
            parseDOM: [
                {
                    // The clipboard serializer converts files into `<img>`, `<video>`, `<audio>`, or
                    // `<object>` tags on copy. Then on paste `<ContentEditor>`'s `transformPastedDOM`
                    // converts those elements into a `<div>` with a `data-cy-tmp-file` attribute.
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

                        const entityId = parseSearchEntityIdFromUrl(node.src);
                        if (entityId === null || !isFileEntityId(entityId)) return false;

                        return {fileId: entityId};
                    },
                },
            ],
        },
    };

    // If `withTable` is true, add a `fileRowTable` node into the content spec.
    //
    // In Alpine there are different places where we are using prosemirror editor. For
    // eg: documents, posts, task notes, messages, etc.
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
            // Don't allow selecting with a `NodeSelection`. The default is `true` but there's
            // only a small number of nodes (e.g. `divider`) we actually want to let be
            // selectable.
            selectable: false,
            // Allow any marks available on `file` nodes on `fileRowTable`s (e.g. comment marks
            // in documents). Comments should never appear on `fileRowTable`. Only on `file`.
            // We validate this is the case in `get_collaboratively_update_content_result.ts`.
            marks: fileMarks,
            attrs: {},
            // same classes being used for fileRow and fileRowTable
            toDOM: () => ["div", {class: fileRowLikeClassName}, 0],
            parseDOM: paragraphParseRules.map(paragraphParseRule => ({
                ...paragraphParseRule,
                // Make sure this is higher priority than our paragraph `div` parse rule and our
                // `fileRow` parse rule.
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
                                isFileEntityUrl(childNode.src))
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
         * Renders a single file floating to the left or right. Text will wrap around the
         * floating file. A useful rendering mode for files when you're writing prose. You
         * can put your file to the side of your text where it will supplements the
         * document's content instead of interrupting it.
         *
         * Keyboard navigation and selection of floated files can be non-intuitive at
         * times. Floated files usually exist in the document at their top edge. However,
         * if there would be multiple conflicting floats at a given X position than they're
         * cleared with the CSS `clear: both`. So a float may be visually pushed down the
         * page by another float. This means a floating file can be in a completely
         * different position visually than it is in the document. Changing keyboard
         * navigation and selection interactions so they match the visual position of the
         * file would be a difficult, maybe impossible, task. So we accept the user can get
         * into some weird states with floating files and leave them to it.
         */
        fileFloat: {
            group: "block",
            content: "file",
            defining: true,
            isolating: true,
            // Don't allow selecting with a `NodeSelection`. The default is `true` but there's
            // only a small number of nodes (e.g. `divider`) we actually want to let be
            // selectable.
            selectable: false,
            // Allow any marks available on `file` nodes on `fileFloat`s (e.g. comment marks in
            // documents). Comments should never appear on `fileFloat`. Only on `file`. We
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
                    // A `<div>` with a style attribute including `float: left` or `float: right` and
                    // at least one child that has a `data-cy-tmp-file` attribute is parsed as a
                    // `fileFloat`.
                    //
                    // The clipboard serializer converts files into `<img>`, `<video>`, `<audio>`, or
                    // `<object>` tags on copy. Then on paste `<ContentEditor>`'s `transformPastedDOM`
                    // converts those elements into a `<div>` with a `data-cy-tmp-file` attribute.
                    tag: "div[style*=float]",
                    // Make sure this is higher priority than our paragraph `div` parse rule. Also our
                    // `fileRow` `div` parse rule.
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
                                    isFileEntityUrl(childNode.src))
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
