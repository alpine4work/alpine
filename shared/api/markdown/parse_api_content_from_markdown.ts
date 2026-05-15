import {Tokenizer as HtmlTokenizer} from "htmlparser2";
import parseInlineStyle from "inline-style-parser";
import {
    BlockContent,
    DefinitionContent,
    List,
    ListItem,
    PhrasingContent,
    Root,
    RootContent,
} from "mdast";
import {fromMarkdown} from "mdast-util-from-markdown";
import {frontmatterFromMarkdown} from "mdast-util-frontmatter";
import {gfmStrikethroughFromMarkdown} from "mdast-util-gfm-strikethrough";
import {gfmTableFromMarkdown} from "mdast-util-gfm-table";
import {gfmTaskListItemFromMarkdown} from "mdast-util-gfm-task-list-item";
import {mathFromMarkdown} from "mdast-util-math";
import {frontmatter} from "micromark-extension-frontmatter";
import {gfmStrikethrough} from "micromark-extension-gfm-strikethrough";
import {gfmTable} from "micromark-extension-gfm-table";
import {gfmTaskListItem} from "micromark-extension-gfm-task-list-item";
import {math} from "micromark-extension-math";
import {
    ApiContentFileOrPreviewBlockElement,
    parseApiContentFileOrPreviewBlockElementFromUrl,
} from "~/shared/api/markdown/internal/parse_api_content_file_or_preview_block_element_from_url.js";
import {normalizeApiContentInlineElementMarks} from "~/shared/api/markdown/normalize_api_content.js";
import {apiContentCodeBlockLanguageDefinition} from "~/shared/api/specification/api_content_code_block_language_definition.js";
import {
    ApiContent,
    ApiContentBlockElement,
    ApiContentCheckListBlockElementItem,
    ApiContentCodeBlockElement,
    ApiContentCodeBlockElementTextInlineElement,
    ApiContentCodeBlockElementTextInlineElementMark,
    ApiContentInlineElement,
    ApiContentInlineElementHighlightMarkColor,
    ApiContentInlineElementMark,
    ApiContentListBlockElement,
    ApiContentListBlockElementItem,
    ApiContentParagraphBlockElement,
    ApiContentQuoteBlockElementBlockElement,
    ApiContentTableBlockElement,
    ApiContentTableBlockElementCell,
    ApiContentTableBlockElementCellBlockElement,
    ApiMentionTarget,
} from "~/shared/api/specification/types/api_specification_convenience_types.js";
import {InvalidArgumentError, UnimplementedError} from "~/shared/error/error.js";
import {errorDisplayMessage} from "~/shared/error/error_display_message.js";
import {createArrayWithLength} from "~/shared/helpers/array/create_array_with_length.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {isDeepEqual} from "~/shared/helpers/control/is_deep_equal.js";
import {noop} from "~/shared/helpers/control/noop.js";
import {flatMapIterable} from "~/shared/helpers/iterable/flat_map_iterable.js";
import {mapIterable} from "~/shared/helpers/iterable/map_iterable.js";
import {getOrSetDefaultMapValue} from "~/shared/helpers/map/get_or_set_default_map_value.js";
import {clamp} from "~/shared/helpers/number/clamp.js";
import {getObjectEntriesWithKeyofType} from "~/shared/helpers/object/get_object_entries_with_keyof_type.js";
import {isId} from "~/shared/id/id.js";
import {
    AccountId,
    ChannelId,
    ChatId,
    DocumentCommentThreadId,
    DocumentId,
    PostId,
    SpaceId,
    TaskCollectionId,
    TaskId,
} from "~/shared/id/types/id_types.js";

export type ApiContentMarkdownParserOptions = {
    readonly spaceId: SpaceId | null;
    /**
     * When true, image markdown (`![alt](url)`) is converted to text with a Link mark,
     * allowing file processing to detect and handle them. When false (default), images
     * are ignored.
     */
    readonly dangerouslyAllowImageContentType?: boolean;
};

export {actuallyParseApiContentFromMarkdown as parseApiContentFromMarkdown};
export {parseApiContentFromMarkdown as parseApiContentFromMarkdownTree};

type ApiContentMarkdownParserDefinitions = {
    readonly futureDefinitionsByIdentifier: Map<string, Array<DefinitionContent>>;
    readonly pastDefinitionsByIdentifier: Map<string, Array<DefinitionContent>>;
};

// TODO(calebmer, #public-api): Clearly document backwards compatibility commitment
// for Markdown printing vs parsing. We're committing to always printing the same
// Markdown for the same content. However, we may choose to parse Markdown
// differently over time. We'll never change how we parse Markdown we've printed
// but as we add new features, Markdown that used to be parsed one way may be
// parsed in some different way.
//
// For example, say we add collapsible sections. We may print this to Markdown
// using the `<details>` element ([like GitHub][1]). Currently when we parse a
// `<details>` element we ignore it (since we ignore unknown HTML) but we'll make a
// backwards incompatible change where we start parsing `<details>` as a
// collapsible section giving different meaning to the Markdown the user provides
// us.
//
// Another example, it seems likely we may support some kind of math Markdown
// extension someday (ChatGPT and Claude seem to use [the `$$math$$` syntax][2]).
// We're currently escaping `$` to reserve the ability to use math in markdown in
// the future.
//
// [1]:
//     https://docs.github.com/en/get-started/writing-on-github/working-with-advanced-formatting/organizing-information-with-collapsed-sections
// [2]: https://github.com/syntax-tree/mdast-util-math
// [3]:
//     https://genai.stackexchange.com/questions/386/how-does-chatgpt-render-math-in-markdown-output
function actuallyParseApiContentFromMarkdown(
    markdown: string,
    options: ApiContentMarkdownParserOptions,
): ApiContent {
    const root = parseMarkdownTree(markdown);
    return parseApiContentFromMarkdown(root, options);
}

export function parseMarkdownTree(
    markdown: string,
    options?: {
        allowUndefinedLinkReferenceIdentifiers?: boolean;
        allowAttentionWithoutClose?: boolean;
        allowCodeTextWithoutClose?: boolean;
        allowLabelWithoutClose?: boolean;
        allowResourceWithoutClose?: boolean;
    },
): Root {
    return fromMarkdown(markdown, "utf-8", {
        // NOTE(calebmer): We add these options via patch to `micromark-core-commonmark`,
        // `micromark`, and `mdast-util-from-markdown`. These options are technically
        // incompatible with the CommonMark spec which is why they aren't enabled by
        // default.
        allowUndefinedLinkReferenceIdentifiers: options?.allowUndefinedLinkReferenceIdentifiers,
        allowAttentionWithoutClose: options?.allowAttentionWithoutClose,
        allowCodeTextWithoutClose: options?.allowCodeTextWithoutClose,
        allowLabelWithoutClose: options?.allowLabelWithoutClose,
        allowResourceWithoutClose: options?.allowResourceWithoutClose,

        extensions: [
            gfmStrikethrough({singleTilde: false}),
            gfmTable(),
            gfmTaskListItem(),
            math(),
            // NOTE(calebmer, 2025-09-02): We don't currently support frontmatter in our
            // Markdown but we want to reserve the syntax so we have the ability to use
            // frontmatter in the future.
            frontmatter("yaml"),
        ],
        mdastExtensions: [
            gfmStrikethroughFromMarkdown(),
            gfmTableFromMarkdown(),
            gfmTaskListItemFromMarkdown(),
            // NOTE(calebmer, 2025-08-08): We don't currently support math symbols in content
            // but we might want to support math in the future. So make sure we escape `$` and
            // `$$` to reserve them.
            mathFromMarkdown(),
            // NOTE(calebmer, 2025-09-02): We don't currently support frontmatter in our
            // Markdown but we want to reserve the syntax so we have the ability to use
            // frontmatter in the future.
            frontmatterFromMarkdown("yaml"),
        ],
    });
}

function parseApiContentFromMarkdown(
    root: Root,
    options: ApiContentMarkdownParserOptions,
): ApiContent {
    const definitions: ApiContentMarkdownParserDefinitions = {
        futureDefinitionsByIdentifier: new Map(),
        pastDefinitionsByIdentifier: new Map(),
    };

    const loop = (parent: Root | RootContent) => {
        if (parent.type === "definition") {
            const identifier = parent.identifier;

            getOrSetDefaultMapValue(
                definitions.futureDefinitionsByIdentifier,
                identifier,
                () => [],
            ).push(parent);
        }

        if ("children" in parent) {
            for (const child of parent.children) {
                loop(child);
            }
        }
    };

    loop(root);

    return {
        elements: Array.from(
            parseApiContentBlockElementsFromMarkdown(
                root.children as Array<BlockContent | DefinitionContent>,
                definitions,
                options,
                {withTableHtml: true},
            ),
        ),
    };
}

/**
 * Merge adjacent standalone File/Preview elements into a FileGallery in-place.
 * Each merged element becomes a single-item row.
 */
function mergeAdjacentFileElements(elements: Array<ApiContentBlockElement>) {
    let i = 0;

    while (i < elements.length - 1) {
        const element = elements[i]!;
        const next = elements[i + 1]!;

        if (
            (element.type === "File" || element.type === "Preview") &&
            (next.type === "File" || next.type === "Preview" || next.type === "FileGallery")
        ) {
            const gallery: ApiContentBlockElement =
                next.type === "FileGallery"
                    ? {type: "FileGallery", rows: [{items: [{element}]}, ...next.rows]}
                    : {
                          type: "FileGallery",
                          rows: [{items: [{element}]}, {items: [{element: next}]}],
                      };

            elements.splice(i, 2, gallery);
            continue;
        }

        if (element.type === "FileGallery") {
            if (next.type === "FileGallery") {
                elements.splice(i, 2, {
                    type: "FileGallery",
                    rows: [...element.rows, ...next.rows],
                });

                continue;
            }

            if (next.type === "File" || next.type === "Preview") {
                elements.splice(i, 2, {
                    type: "FileGallery",
                    rows: [...element.rows, {items: [{element: next}]}],
                });

                continue;
            }
        }

        i++;
    }
}

function* parseApiContentBlockElementsFromMarkdown(
    contents: Array<BlockContent | DefinitionContent>,
    definitions: ApiContentMarkdownParserDefinitions,
    options: ApiContentMarkdownParserOptions,
    // Required option so caller must make a choice on whether to enable this property
    // or not.
    {withTableHtml}: {withTableHtml: boolean},
): IterableIterator<ApiContentBlockElement> {
    const tableState = withTableHtml ? new ApiContentBlockElementsMarkdownTableState() : null;

    // Buffer the last yielded element so we can merge adjacent FileGalleries that span
    // separate mdast blocks (e.g. two HTML divs separated by a blank line in the
    // markdown output).
    let pending: ApiContentBlockElement | null = null;

    function* emit(element: ApiContentBlockElement): IterableIterator<ApiContentBlockElement> {
        if (pending?.type === "FileGallery") {
            // Merge adjacent FileGalleries.
            if (element.type === "FileGallery") {
                pending = {
                    type: "FileGallery",
                    rows: [...pending.rows, ...element.rows],
                };
                return;
            }

            // Absorb adjacent standalone File/Preview as a new gallery row. This can produce
            // single-element rows (e.g. from a bare `<img>` between two
            // `<div style="display:flex">` rows in user-uploaded markdown). That's fine;
            // `normalizeApiContent` handles canonicalization of gallery structure.
            if (element.type === "File" || element.type === "Preview") {
                pending = {
                    type: "FileGallery",
                    rows: [...pending.rows, {items: [{element}]}],
                };
                return;
            }
        }

        // Merge adjacent standalone File/Preview elements into a new FileGallery. This
        // happens when the printer unwraps all single-item rows from a multi-row gallery
        // into standalone elements.
        if (
            (pending?.type === "File" || pending?.type === "Preview") &&
            (element.type === "File" ||
                element.type === "Preview" ||
                element.type === "FileGallery")
        ) {
            if (element.type === "FileGallery") {
                pending = {
                    type: "FileGallery",
                    rows: [{items: [{element: pending}]}, ...element.rows],
                };
            } else {
                pending = {
                    type: "FileGallery",
                    rows: [{items: [{element: pending}]}, {items: [{element}]}],
                };
            }
            return;
        }

        // Flush the pending element before processing the new one.
        if (pending !== null) {
            yield* flush();
        }

        pending = element;
    }

    function* flush(): IterableIterator<ApiContentBlockElement> {
        if (pending === null) return;

        const element = pending;
        pending = null;
        yield element;
    }

    for (const content of contents) {
        for (const element of parseApiContentBlockElementFromMarkdown(
            content,
            definitions,
            tableState,
            options,
        )) {
            if (tableState !== null && tableState.onBlockElement(element)) continue;

            yield* emit(element);
        }
    }

    // Flush the final buffered element.
    yield* flush();
}

const apiContentCodeBlockLanguageByName = new Map<string, ApiContentCodeBlockElement["language"]>();

for (const [language, extensions] of getObjectEntriesWithKeyofType(
    apiContentCodeBlockLanguageDefinition,
)) {
    for (const extension of extensions) {
        apiContentCodeBlockLanguageByName.set(extension, language);
    }

    apiContentCodeBlockLanguageByName.set(language, language);
}

// Matches inline HTML children that contain `<video`, `<audio`, or `<object` tags.
// CommonMark treats these as inline HTML instead of block-level HTML. When found
// inside a paragraph, we extract them and re-parse as block HTML to produce
// block-level file elements.
const inlineHtmlMediaTagPattern = /^<(video|audio|object)\b/i;

function* parseApiContentBlockElementFromMarkdown(
    content: BlockContent | DefinitionContent,
    definitions: ApiContentMarkdownParserDefinitions,
    tableState: ApiContentBlockElementsMarkdownTableState | null,
    options: ApiContentMarkdownParserOptions,
): IterableIterator<ApiContentBlockElement> {
    // TODO: Support inline images that appear in the middle of paragraph text, e.g.
    // `Check out this diagram: ![](https://alpine.inc/s/.../files/abc123)`. Today we
    // only recognize a file URL when it's the sole child of a paragraph. Ideally we'd
    // split the paragraph into: a paragraph with the preceding text, the File/Preview
    // block element, and a paragraph with the trailing text. This would let agents
    // write more natural markdown with embedded files without losing the file
    // reference.
    switch (content.type) {
        case "paragraph": {
            // A paragraph with a single image child may represent a File or Preview block
            // element if the URL matches our alpine.inc patterns.
            const firstChild = content.children[0];
            if (
                content.children.length === 1 &&
                firstChild?.type === "image" &&
                options.spaceId !== null
            ) {
                const imageNode = firstChild;

                const fileOrPreview = parseApiContentFileOrPreviewBlockElementFromUrl(
                    options.spaceId,
                    imageNode.url,
                );

                if (fileOrPreview !== null) {
                    yield fileOrPreview;
                    break;
                }
            }

            // A paragraph with a single link child may represent a Preview block element if
            // the URL matches our alpine.inc preview patterns. We don't print previews as
            // links (we use image syntax), but an agent might write markdown like
            // `[My Document](https://alpine.inc/s/.../documents/...)` and we want to handle
            // that gracefully.
            if (
                content.children.length === 1 &&
                firstChild?.type === "link" &&
                options.spaceId !== null
            ) {
                const linkNode = firstChild;
                const fileOrPreview = parseApiContentFileOrPreviewBlockElementFromUrl(
                    options.spaceId,
                    linkNode.url,
                );

                if (fileOrPreview !== null && fileOrPreview.type === "Preview") {
                    yield fileOrPreview;
                    break;
                }
            }

            // CommonMark treats `<video>`, `<audio>`, and `<object>` as inline HTML rather
            // than block-level HTML. When these appear in a paragraph, each HTML tag becomes a
            // separate `html` phrasing content child (e.g. `<video>`, `<source .../>`,
            // `</video>` are three separate children). We detect a media tag, find the span of
            // adjacent `html` children that form the complete element, concatenate them, and
            // re-parse as block HTML to extract the file element. Any surrounding text is
            // preserved as separate paragraphs.
            if (options.spaceId !== null) {
                const mediaStartIndex = content.children.findIndex(
                    child => child.type === "html" && inlineHtmlMediaTagPattern.test(child.value),
                );

                if (mediaStartIndex !== -1) {
                    // Find the extent of adjacent html children starting from the media tag.
                    let mediaEndIndex = mediaStartIndex;
                    while (
                        mediaEndIndex + 1 < content.children.length &&
                        content.children[mediaEndIndex + 1]!.type === "html"
                    ) {
                        mediaEndIndex++;
                    }

                    // Concatenate all adjacent html children into a single string for the block HTML
                    // parser.
                    let combinedHtml = "";
                    for (let i = mediaStartIndex; i <= mediaEndIndex; i++) {
                        const child = content.children[i]!;
                        if (child.type === "html") {
                            combinedHtml += child.value;
                        }
                    }

                    // Yield a paragraph for any children before the media tag.
                    const before = content.children.slice(0, mediaStartIndex);
                    if (before.length > 0) {
                        yield {
                            type: "Paragraph",
                            elements: Array.from(
                                parseAndMergeApiContentInlineElementsFromMarkdown(
                                    before,
                                    definitions,
                                    options,
                                ),
                            ),
                        };
                    }

                    // Parse the combined inline HTML as block-level HTML to extract the media element.
                    yield* parseApiContentBlockElementFromMarkdown(
                        {type: "html", value: combinedHtml},
                        definitions,
                        tableState,
                        options,
                    );

                    // Yield a paragraph for any children after the media tags.
                    const after = content.children.slice(mediaEndIndex + 1);
                    if (after.length > 0) {
                        yield {
                            type: "Paragraph",
                            elements: Array.from(
                                parseAndMergeApiContentInlineElementsFromMarkdown(
                                    after,
                                    definitions,
                                    options,
                                ),
                            ),
                        };
                    }

                    break;
                }
            }

            yield {
                type: "Paragraph",
                elements: Array.from(
                    parseAndMergeApiContentInlineElementsFromMarkdown(
                        content.children,
                        definitions,
                        options,
                    ),
                ),
            };
            break;
        }
        case "list": {
            // Ordered lists are homogenous (they contain _only_ ordered list items) so we can
            // yield them directly. Conversely, unordered lists are non-homogenous – they can
            // contain normal unordered list items or "checklist" items. However, we maintain
            // separate list structures for checklists and unordered lists; so when parsing
            // unordered lists into our API content, we need to split them based on the list
            // items.
            if (content.ordered) {
                const orderStart = getOrderStartIfExists(content);
                yield {
                    type: "OrderedList",
                    ...(orderStart !== undefined ? {orderStart} : {}),
                    items: parseContentListBlockElementItems(
                        content.children,
                        definitions,
                        options,
                        intoApiContentListBlockElementItem,
                    ),
                };
                break;
            }

            // Group consecutive items by their list type. This is necessary because the
            // markdown AST represents mixed checklist/regular items as a single, unordered
            // list, but our API treats CheckList as a separate type.
            //
            // For example:
            //
            // - [ ] Checklist item
            // - Regular item
            // - [x] Another checklist item
            //
            // Gets parsed as a single unordered list with mixed `checked` values, but needs to
            // be yielded as: CheckList, UnorderedList, CheckList
            const itemGroups: Array<{
                type: "UnorderedList" | "CheckList";
                items: Array<ListItem>;
            }> = [];

            for (const item of content.children) {
                const listType =
                    item.checked !== null && item.checked !== undefined
                        ? "CheckList"
                        : "UnorderedList";

                const lastGroup = itemGroups[itemGroups.length - 1];

                if (lastGroup && lastGroup.type === listType) {
                    lastGroup.items.push(item);
                } else {
                    itemGroups.push({type: listType, items: [item]});
                }
            }

            // Yield each group as a separate list block
            for (const group of itemGroups) {
                if (group.type === "UnorderedList") {
                    yield {
                        type: "UnorderedList",
                        items: parseContentListBlockElementItems(
                            group.items,
                            definitions,
                            options,
                            intoApiContentListBlockElementItem,
                        ),
                    };
                } else {
                    yield {
                        type: "CheckList",
                        items: parseContentListBlockElementItems(
                            group.items,
                            definitions,
                            options,
                            intoApiContentCheckListBlockElementItem,
                        ),
                    };
                }
            }
            break;
        }
        case "blockquote": {
            yield {
                type: "Quote",
                elements: Array.from(
                    flatMapIterable(
                        parseApiContentBlockElementsFromMarkdown(
                            content.children,
                            definitions,
                            options,
                            // Instead of ignoring elements like `</td>` (which may feel broken) throw an error
                            // if we see table HTML.
                            {withTableHtml: false},
                        ),
                        intoApiContentQuoteBlockElementBlockElement,
                    ),
                ),
            };
            break;
        }
        case "heading": {
            yield {
                type: "Heading",
                level: clamp(1, Math.floor(content.depth), 3),
                elements: Array.from(
                    parseAndMergeApiContentInlineElementsFromMarkdown(
                        content.children,
                        definitions,
                        options,
                    ),
                ),
            };
            break;
        }
        case "thematicBreak": {
            yield {type: "Divider"};
            break;
        }
        case "html": {
            let elements: Array<ApiContentBlockElement> | undefined;

            let textElements: Array<{
                type: "Text";
                text: string;
                marks: Array<ApiContentInlineElementMark> | undefined;
            }> = [];

            let openParagraphTagCount = 0;

            let anchorTagState: {
                phase: "<a>" | "<a href>";
                href: string | null;
            } | null = null;

            let markTagState: {
                phase: "<mark>" | "<mark class>" | "<mark data-comment>";
                class: string | null;
                dataComment: string | null;
            } | null = null;

            // Media tag states are split by tag type so that each only carries the fields
            // relevant to that tag. `<img>` has `alt`; `<object>` uses `data` instead of
            // `src`; `<video>`/`<audio>` can receive their URL from a child `<source>`
            // element.
            let mediaTagState:
                | // `<img>` gets its URL from `src` and carries `alt` text (used as the preview
                // title).
                ((
                      | {tagName: "img"; src: string | null; alt: string | null}
                      // `<object>` uses `data` instead of `src` for its URL.
                      | {tagName: "object"; data: string | null}
                      // `<video>`/`<audio>` get their URL from `src` on the tag itself or from a child
                      // `<source>` element.
                      | {tagName: "video" | "audio"; src: string | null}
                  ) & {
                      style: string | null;
                      phase: "open" | "attr-name" | "attr-value";
                      attrName: string;
                  })
                | null = null;

            let codeTagState: {
                phase: "<pre>" | "<pre>..." | "<code>" | "<code class>" | "<code>..." | "</code>";
                class: string | null;
                textElements: Array<{
                    type: "Text";
                    text: string;
                    marks: Array<ApiContentInlineElementMark> | undefined;
                }>;
            } | null = null;

            let divFileState:
                | ({
                      phase: "open" | "attr-name" | "attr-value";
                      attrName: string;
                      attrValue: string;
                  } &
                      // Style hasn't been parsed yet, so we don't know what kind of container this div
                      // is (if any).
                      (| {containerType: null}
                          // A `display: flex` row inside a file gallery. Collects elements as the row is
                          // parsed.
                          | {
                                containerType: "file-gallery-row";
                                currentItems: Array<{
                                    element: ApiContentFileOrPreviewBlockElement;
                                }>;
                            }
                          // A `float: left` or `float: right` container for a single floating file.
                          // `currentRow` starts null and is set to a single-element array when the first
                          // media element is found.
                          | {
                                containerType: "file-float";
                                floatSide: "Left" | "Right";
                                currentRow: Array<ApiContentFileOrPreviewBlockElement> | null;
                            }
                      ))
                | null = null;

            // Tracks `<a>` tags inside gallery/float containers that may represent Preview
            // elements. When an `<a>` tag with a preview URL href is found inside a
            // `divFileState`, we capture it here instead of pushing a Link mark.
            let previewAnchorState: {
                phase: "<a>" | "<a href>";
                href: string;
                title: string;
            } | null = null;

            const markStack = new ApiContentInlineElementsMarkdownParserMarkStack();

            const handleText = (text: string) => {
                if (text.length === 0) return;

                // Capture text inside preview anchor tags as the title.
                if (previewAnchorState !== null) {
                    previewAnchorState.title += text;
                    return;
                }

                // Perform HTML space crushing. Any consecutive whitespace in HTML is collapsed to
                // a single space. If we're in `<pre><code>` then we must preserve whitespace.
                if (codeTagState === null) {
                    text = text.replaceAll(/\s+/g, " ");
                }

                // Ignore text between the `<pre>` and `<code>` tags.
                if (codeTagState !== null && codeTagState.phase !== "<code>...") {
                    return;
                }

                const actualTextElements =
                    codeTagState !== null ? codeTagState.textElements : textElements;

                const marks = markStack.getMarks();

                // If marks haven't changed, merge with the last text object.
                if (actualTextElements.length > 0) {
                    const lastTextElement = actualTextElements[actualTextElements.length - 1]!;
                    if (isDeepEqual(lastTextElement.marks, marks)) {
                        lastTextElement.text += text;
                        return;
                    }
                }

                actualTextElements.push({type: "Text", text, marks});
            };

            const handleElement = (element: ApiContentBlockElement) => {
                if (tableState?.onBlockElement(element)) return;

                elements ??= [];

                // FileGallery merge and unwrap is handled at the top level of the parser (in
                // `emit`) so it works across mdast block boundaries. Don't do it here.
                elements.push(element);
            };

            // Append attribute data to the correct field on the current media tag state.
            const appendMediaTagAttribute = (
                state: NonNullable<typeof mediaTagState>,
                data: string,
            ) => {
                switch (state.attrName) {
                    case "src":
                        assert(state.tagName !== "object");
                        state.src += data;
                        break;
                    case "data":
                        assert(state.tagName === "object");
                        state.data += data;
                        break;
                    case "alt":
                        assert(state.tagName === "img");
                        state.alt += data;
                        break;
                    case "style":
                        state.style += data;
                        break;
                }
            };

            // Resolve the current media tag (<img>, <video>, <audio>, <object>) into a File or
            // Preview block element and route it to the correct destination (standalone,
            // gallery row, or float container).
            //
            // `force` should be true when called from a close tag (e.g. `</video>`). When
            // false (from onopentagend/onselfclosingtag), video tags without a src are kept
            // alive so `<source>` children can provide the URL.
            const handleMediaTagEnd = (force = false) => {
                if (mediaTagState === null) return;

                const mediaUrl =
                    mediaTagState.tagName === "object" ? mediaTagState.data : mediaTagState.src;

                // For `<video>`/`<audio>` with `<source>` children, the src comes from the child.
                // Don't clear state on the open tag end if no URL is found yet.
                if (
                    !force &&
                    (mediaTagState.tagName === "video" || mediaTagState.tagName === "audio") &&
                    !mediaUrl
                ) {
                    return;
                }

                if (mediaUrl && options.spaceId !== null) {
                    const element = parseApiContentFileOrPreviewBlockElementFromUrl(
                        options.spaceId,
                        mediaUrl,
                    );
                    if (element !== null) {
                        if (divFileState?.containerType === "file-gallery-row") {
                            // Widths are response-only metadata computed by the server. We don't need to parse
                            // them from the HTML since they'll be recomputed on the next response.
                            divFileState.currentItems.push({element});
                        } else if (divFileState?.containerType === "file-float") {
                            divFileState.currentRow = [element];
                        } else {
                            handleElement(element);
                        }
                    }
                }
                mediaTagState = null;
            };

            const tokenizer = new HtmlTokenizer(
                {},
                {
                    ontext: (start, end) => {
                        const text = content.value.slice(start, end);
                        if (tableState?.onText()) return;
                        // Ignore whitespace-only text inside gallery/float containers. Newlines between
                        // tags (e.g. between `<div>` and `<img>`) are meaningless and would otherwise
                        // produce spurious paragraph elements.
                        if (
                            divFileState !== null &&
                            divFileState.containerType !== null &&
                            text.trim() === ""
                        )
                            return;
                        handleText(text);
                    },
                    ontextentity: codepoint => {
                        const text = String.fromCodePoint(codepoint);
                        handleText(text);
                    },

                    onopentagname: (start, end) => {
                        const tagName = content.value.slice(start, end).toLowerCase();

                        switch (tagName) {
                            case "p": {
                                openParagraphTagCount++;

                                if (textElements.length > 0) {
                                    handleElement({type: "Paragraph", elements: textElements});
                                    textElements = [];
                                }
                                break;
                            }
                            case "br": {
                                elements ??= [];

                                if (textElements.length > 0) {
                                    handleElement({type: "Paragraph", elements: textElements});
                                    textElements = [];
                                }

                                handleElement({
                                    type: "Paragraph",
                                    elements: [{type: "Break", marks: undefined}],
                                });
                                break;
                            }
                            case "hr": {
                                elements ??= [];

                                if (textElements.length > 0) {
                                    handleElement({type: "Paragraph", elements: textElements});
                                    textElements = [];
                                }

                                handleElement({type: "Divider"});
                                break;
                            }
                            case "strong":
                            case "b": {
                                markStack.pushForHtmlTag(tagName, {type: "Bold"});
                                break;
                            }
                            case "em":
                            case "i": {
                                markStack.pushForHtmlTag(tagName, {type: "Italic"});
                                break;
                            }
                            case "del": {
                                markStack.pushForHtmlTag(tagName, {type: "Strike"});
                                break;
                            }
                            case "a": {
                                if (divFileState !== null) {
                                    // Inside a gallery/float container, track `<a>` as a potential preview anchor
                                    // instead of an inline link mark. We don't print previews as `<a>` tags (we use
                                    // `<img>`), but an agent might write
                                    // `<a href="https://alpine.inc/s/.../documents/...">Title</a>` inside a gallery
                                    // div to create a preview element.
                                    previewAnchorState = {phase: "<a>", href: "", title: ""};
                                } else {
                                    anchorTagState = {phase: "<a>", href: null};
                                }
                                break;
                            }
                            case "mark": {
                                markTagState = {phase: "<mark>", class: null, dataComment: null};
                                break;
                            }
                            case "pre": {
                                if (codeTagState !== null) break;

                                // When we open a `<pre>` but any previous text into a paragraph.
                                if (textElements.length > 0) {
                                    handleElement({type: "Paragraph", elements: textElements});
                                    textElements = [];
                                }

                                codeTagState = {
                                    phase: "<pre>",
                                    class: null,
                                    textElements: [],
                                };
                                break;
                            }
                            case "code": {
                                if (codeTagState?.phase === "<pre>...") {
                                    codeTagState.phase = "<code>";
                                } else {
                                    markStack.pushForHtmlTag(tagName, {type: "Code"});
                                }
                                break;
                            }
                            case "table":
                            case "thead":
                            case "tbody":
                            case "tr":
                            case "th":
                            case "td": {
                                if (tableState === null) {
                                    throw new UnimplementedError(
                                        "Table HTML isn\u2019t supported in this Markdown block content parent",
                                        {
                                            // Make sure we have a nice error message for API users trying to parse invalid
                                            // Markdown content into API content.
                                            displayMessage: errorDisplayMessage`Table HTML isn\u2019t supported in this Markdown block content parent.`,
                                        },
                                    );
                                }

                                tableState.onOpenTagName(tagName);
                                break;
                            }
                            case "img": {
                                mediaTagState = {
                                    tagName,
                                    src: null,
                                    alt: null,
                                    style: null,
                                    phase: "open",
                                    attrName: "",
                                };
                                break;
                            }
                            case "video":
                            case "audio": {
                                mediaTagState = {
                                    tagName,
                                    src: null,
                                    style: null,
                                    phase: "open",
                                    attrName: "",
                                };
                                break;
                            }
                            case "object": {
                                mediaTagState = {
                                    tagName,
                                    data: null,
                                    style: null,
                                    phase: "open",
                                    attrName: "",
                                };
                                break;
                            }
                            case "source": {
                                // `<source>` children of `<video>`/`<audio>` provide the src. We don't change the
                                // media tag's identity here, just re-enter attribute parsing. This means a `src`
                                // on both the parent tag and a `<source>` child both write to the same
                                // `mediaTagState.src` field (the last one wins). That's intentional: agents may
                                // put `src` directly on `<video>` or use `<source>` children, and we accept either
                                // form.
                                if (
                                    mediaTagState !== null &&
                                    (mediaTagState.tagName === "video" ||
                                        mediaTagState.tagName === "audio")
                                ) {
                                    mediaTagState.phase = "open";
                                    mediaTagState.attrName = "";
                                }

                                break;
                            }
                            case "div": {
                                // Nested divs inherit the parent's container context (gallery row, float) so that
                                // media tags inside them route correctly. By the time htmlparser2 fires
                                // `onopentagname` for a child element, the parent's `onopentagend` has already
                                // fired, so the parent div's attribute phase is complete. We always start fresh in
                                // the "open" phase here.
                                {
                                    const base = {
                                        phase: "open" as const,
                                        attrName: "",
                                        attrValue: "",
                                    };

                                    if (divFileState?.containerType === "file-gallery-row") {
                                        divFileState = {
                                            ...base,
                                            containerType: "file-gallery-row",
                                            currentItems: divFileState.currentItems,
                                        };
                                    } else if (divFileState?.containerType === "file-float") {
                                        divFileState = {
                                            ...base,
                                            containerType: "file-float",
                                            floatSide: divFileState.floatSide,
                                            currentRow: divFileState.currentRow,
                                        };
                                    } else {
                                        divFileState = {...base, containerType: null};
                                    }
                                }
                                break;
                            }
                        }
                    },
                    onopentagend: () => {
                        if (anchorTagState?.phase === "<a>") {
                            markStack.pushForHtmlTag("a", {
                                type: "Link",
                                url: anchorTagState.href ?? "",
                            });

                            anchorTagState = null;
                        }

                        // The `<mark>` HTML element can either be a comment or highlight.
                        if (markTagState !== null) {
                            if (
                                markTagState.dataComment &&
                                isId<DocumentCommentThreadId>(markTagState.dataComment)
                            ) {
                                markStack.pushForHtmlTag("mark", {
                                    type: "Comment",
                                    threadId: markTagState.dataComment,
                                });
                            } else {
                                let color: ApiContentInlineElementHighlightMarkColor | null = null;

                                if (markTagState.class) {
                                    const colorMatch =
                                        markTagState.class.match(/^highlight-([a-z]+)$/);

                                    color = colorMatch
                                        ? parseApiContentInlineElementHighlightMarkColorIfPossible(
                                              colorMatch[1]!,
                                          )
                                        : null;
                                }

                                markStack.pushForHtmlTag("mark", {
                                    type: "Highlight",
                                    // Default to orange since that's our closest color to yellow. The default browser
                                    // CSS typically renders `<mark>` with a yellow background.
                                    color: color ?? "Orange",
                                });
                            }
                            markTagState = null;
                        }

                        if (codeTagState?.phase === "<pre>") {
                            codeTagState.phase = "<pre>...";
                        }

                        if (codeTagState?.phase === "<code>") {
                            codeTagState.phase = "<code>...";
                        }

                        // Handle non-self-closing media tags (<img>, <audio>, <object>).
                        handleMediaTagEnd();

                        // Div attributes are processed in `onattribend` as each attribute completes. Reset
                        // phase here for any trailing boolean attribute that didn't get an `onattribend`
                        // call.
                        if (
                            divFileState?.phase === "attr-name" ||
                            divFileState?.phase === "attr-value"
                        ) {
                            divFileState.phase = "open";
                            divFileState.attrName = "";
                            divFileState.attrValue = "";
                        }

                        tableState?.onOpenTagEnd();
                    },
                    onclosetag: (start, end) => {
                        const tagName = content.value.slice(start, end).toLowerCase();

                        switch (tagName) {
                            case "p": {
                                if (openParagraphTagCount === 0) break;
                                openParagraphTagCount--;

                                // If we saw an open/close `p` tag (`<p></p>`) add a paragraph element.
                                //
                                // Since Markdown can't represent empty paragraphs, we print an empty `<p>` tag
                                // instead.
                                if (openParagraphTagCount === 0) {
                                    handleElement({type: "Paragraph", elements: textElements});
                                    textElements = [];
                                }
                                break;
                            }
                            case "strong":
                            case "b":
                            case "em":
                            case "i":
                            case "del":
                            case "mark": {
                                markStack.popForHtmlTag(tagName);
                                break;
                            }
                            case "a": {
                                // Resolve a preview anchor tag into a Preview element. We don't print previews as
                                // `<a>` tags, but an agent might use anchor syntax to reference a preview URL.
                                if (previewAnchorState !== null && options.spaceId !== null) {
                                    const element = parseApiContentFileOrPreviewBlockElementFromUrl(
                                        options.spaceId,
                                        previewAnchorState.href,
                                    );
                                    if (element !== null && element.type === "Preview") {
                                        const preview: ApiContentFileOrPreviewBlockElement =
                                            element;
                                        if (divFileState?.containerType === "file-gallery-row") {
                                            divFileState.currentItems.push({
                                                element: preview,
                                            });
                                        } else if (divFileState?.containerType === "file-float") {
                                            divFileState.currentRow = [preview];
                                        } else {
                                            handleElement(preview);
                                        }
                                    }
                                    previewAnchorState = null;
                                } else {
                                    markStack.popForHtmlTag(tagName);
                                }
                                break;
                            }
                            case "code": {
                                if (codeTagState?.phase === "<code>...") {
                                    codeTagState.phase = "</code>";
                                } else {
                                    markStack.popForHtmlTag(tagName);
                                }
                                break;
                            }
                            case "pre": {
                                if (codeTagState?.phase !== "</code>") break;

                                elements ??= [];

                                const languageMatch =
                                    codeTagState.class !== null
                                        ? codeTagState.class.match(/language-([a-z0-9]+)/)
                                        : undefined;

                                // According to [mdn on `<pre>` elements][1]:
                                //
                                // > Whitespace inside this element is displayed as written, with one exception. If
                                // > one or more leading newline characters are included immediately following the
                                // > opening `<pre>` tag, the _first_ newline character is stripped.
                                //
                                // We also strip the final newline if one exists since it naturally forms the end
                                // of our block.
                                //
                                // [1]: https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/pre
                                const textElements = codeTagState.textElements;
                                if (textElements.length > 0) {
                                    const firstTextElement = textElements[0]!;
                                    const lastTextElement = textElements[textElements.length - 1]!;

                                    if (firstTextElement.text.startsWith("\n")) {
                                        firstTextElement.text = firstTextElement.text.slice(1);
                                    }

                                    if (lastTextElement.text.endsWith("\n")) {
                                        lastTextElement.text = lastTextElement.text.slice(0, -1);
                                    }

                                    // If first/last text elements were emptied then remove them.

                                    if (lastTextElement.text.length === 0) {
                                        textElements.pop();
                                    }

                                    if (
                                        lastTextElement !== firstTextElement &&
                                        firstTextElement.text.length === 0
                                    ) {
                                        textElements.shift();
                                    }
                                }

                                const lines: Array<{
                                    elements: Array<ApiContentCodeBlockElementTextInlineElement>;
                                }> = [];

                                // Split text elements into code block lines.
                                for (const textElement of textElements) {
                                    const texts = textElement.text.split("\n");
                                    const marks =
                                        intoApiContentCodeBlockElementTextInlineElementMarks(
                                            textElement.marks,
                                        );

                                    for (let i = 0; i < texts.length; i++) {
                                        const text = texts[i]!;

                                        if (i === 0) {
                                            if (lines.length === 0) lines.push({elements: []});

                                            if (text.length > 0) {
                                                lines[lines.length - 1]!.elements.push({
                                                    type: "Text",
                                                    text,
                                                    marks,
                                                });
                                            }
                                        } else {
                                            lines.push({
                                                elements:
                                                    text.length > 0
                                                        ? [{type: "Text", text, marks}]
                                                        : [],
                                            });
                                        }
                                    }
                                }

                                const languageName = languageMatch?.[1]?.toLowerCase();
                                const language = languageName
                                    ? apiContentCodeBlockLanguageByName.get(languageName)
                                    : undefined;

                                handleElement({
                                    type: "Code",
                                    language: language ?? "text",
                                    lines,
                                });

                                codeTagState = null;
                                break;
                            }
                            case "table":
                            case "thead":
                            case "tbody":
                            case "tr":
                            case "th":
                            case "td": {
                                if (tableState === null) {
                                    throw new UnimplementedError(
                                        "Table HTML isn\u2019t supported in this Markdown block content parent",
                                        {
                                            // Make sure we have a nice error message for API users trying to parse invalid
                                            // Markdown content into API content.
                                            displayMessage: errorDisplayMessage`Table HTML isn\u2019t supported in this Markdown block content parent.`,
                                        },
                                    );
                                }

                                if (textElements.length > 0) {
                                    handleElement({type: "Paragraph", elements: textElements});
                                    textElements = [];
                                }

                                const element = tableState.onCloseTagName(tagName);

                                if (element !== null) {
                                    handleElement(element);
                                }

                                break;
                            }
                            case "video":
                            case "audio": {
                                // Force-end the media tag when the closing tag is reached. This handles
                                // `<video><source src="..."/></video>`.
                                handleMediaTagEnd(true);
                                break;
                            }
                            case "source": {
                                // `<source/>` is self-closing but htmlparser2 may emit a close event for it as
                                // well. Ignore it.
                                break;
                            }
                            case "div": {
                                if (divFileState === null) break;

                                if (
                                    divFileState.containerType === "file-float" &&
                                    divFileState.currentRow !== null &&
                                    divFileState.currentRow.length > 0
                                ) {
                                    // Close the float container.
                                    handleElement({
                                        type: "FileFloat",
                                        side: divFileState.floatSide,
                                        element: divFileState.currentRow[0]!,
                                    });

                                    divFileState = null;
                                } else if (
                                    divFileState.containerType === "file-gallery-row" &&
                                    divFileState.currentItems.length > 0
                                ) {
                                    // Close a gallery row div. Widths are not parsed; they're response-only metadata
                                    // that will be recomputed by the server.
                                    handleElement({
                                        type: "FileGallery",
                                        rows: [{items: divFileState.currentItems}],
                                    });

                                    divFileState = null;
                                } else {
                                    divFileState = null;
                                }
                                break;
                            }
                        }
                    },
                    onselfclosingtag: () => {
                        // Handle self-closing media tags (<img/>, <audio/>, <object/>).
                        handleMediaTagEnd();

                        if (divFileState === null) return;

                        // This fires for self-closing child tags inside the div (e.g. `<img/>` inside
                        // `<div style="display:flex">`), NOT for the div itself. If we're inside a
                        // container, the child was already handled by `handleMediaTagEnd()` above; just
                        // reset attribute parsing state for the next child. If there's no container, this
                        // was a bare `<div/>` which is meaningless, so clear state.
                        divFileState =
                            divFileState.containerType !== null
                                ? {
                                      ...divFileState,
                                      phase: "open",
                                      attrName: "",
                                      attrValue: "",
                                  }
                                : null;
                    },
                    onattribname: (start, end) => {
                        const attributeName = content.value.slice(start, end).toLowerCase();

                        if (anchorTagState?.phase === "<a>" && attributeName === "href") {
                            anchorTagState.phase = "<a href>";
                            anchorTagState.href = "";
                        }

                        if (previewAnchorState !== null) {
                            if (attributeName === "href") {
                                previewAnchorState.phase = "<a href>";
                                previewAnchorState.href = "";
                            } else {
                                previewAnchorState.phase = "<a>";
                            }
                        }

                        if (markTagState?.phase === "<mark>") {
                            if (attributeName === "class") {
                                markTagState.phase = "<mark class>";
                                markTagState.class = "";
                            } else if (attributeName === "data-comment") {
                                markTagState.phase = "<mark data-comment>";
                                markTagState.dataComment = "";
                            }
                        }

                        if (codeTagState?.phase === "<code>" && attributeName === "class") {
                            codeTagState.phase = "<code class>";
                            codeTagState.class = "";
                        }

                        if (mediaTagState?.phase === "open") {
                            let recognized = false;

                            if (attributeName === "style") {
                                mediaTagState.style = "";
                                recognized = true;
                            } else if (
                                attributeName === "src" &&
                                mediaTagState.tagName !== "object"
                            ) {
                                mediaTagState.src = "";
                                recognized = true;
                            } else if (
                                attributeName === "data" &&
                                mediaTagState.tagName === "object"
                            ) {
                                mediaTagState.data = "";
                                recognized = true;
                            } else if (attributeName === "alt" && mediaTagState.tagName === "img") {
                                mediaTagState.alt = "";
                                recognized = true;
                            }

                            if (recognized) {
                                mediaTagState.phase = "attr-name";
                                mediaTagState.attrName = attributeName;
                            }
                        }

                        if (divFileState?.phase === "open") {
                            divFileState.phase = "attr-name";
                            divFileState.attrName = attributeName;
                            divFileState.attrValue = "";
                        }

                        tableState?.onAttributeName(attributeName);
                    },
                    onattribdata: (start, end) => {
                        const attributeData = content.value.slice(start, end);

                        if (anchorTagState?.phase === "<a href>") {
                            anchorTagState.href += attributeData;
                        }

                        if (previewAnchorState?.phase === "<a href>") {
                            previewAnchorState.href += attributeData;
                        }

                        if (markTagState?.phase === "<mark class>") {
                            markTagState.class += attributeData;
                        }

                        if (markTagState?.phase === "<mark data-comment>") {
                            markTagState.dataComment += attributeData;
                        }

                        if (codeTagState?.phase === "<code class>") {
                            codeTagState.class += attributeData;
                        }

                        if (
                            mediaTagState?.phase === "attr-name" ||
                            mediaTagState?.phase === "attr-value"
                        ) {
                            mediaTagState.phase = "attr-value";
                            appendMediaTagAttribute(mediaTagState, attributeData);
                        }

                        if (
                            divFileState?.phase === "attr-name" ||
                            divFileState?.phase === "attr-value"
                        ) {
                            divFileState.phase = "attr-value";
                            divFileState.attrValue += attributeData;
                        }

                        tableState?.onAttributeData(attributeData);
                    },
                    onattribentity: codepoint => {
                        const attributeData = String.fromCodePoint(codepoint);

                        if (anchorTagState?.phase === "<a href>") {
                            anchorTagState.href += attributeData;
                        }

                        if (previewAnchorState?.phase === "<a href>") {
                            previewAnchorState.href += attributeData;
                        }

                        if (markTagState?.phase === "<mark class>") {
                            markTagState.class += attributeData;
                        }

                        if (markTagState?.phase === "<mark data-comment>") {
                            markTagState.dataComment += attributeData;
                        }

                        if (codeTagState?.phase === "<code class>") {
                            codeTagState.class += attributeData;
                        }

                        if (
                            mediaTagState?.phase === "attr-name" ||
                            mediaTagState?.phase === "attr-value"
                        ) {
                            mediaTagState.phase = "attr-value";
                            appendMediaTagAttribute(mediaTagState, attributeData);
                        }

                        if (
                            divFileState?.phase === "attr-name" ||
                            divFileState?.phase === "attr-value"
                        ) {
                            divFileState.phase = "attr-value";
                            divFileState.attrValue += attributeData;
                        }

                        tableState?.onAttributeData(attributeData);
                    },
                    onattribend: () => {
                        if (anchorTagState?.phase === "<a href>") {
                            anchorTagState.phase = "<a>";
                        }

                        if (markTagState?.phase === "<mark class>") {
                            markTagState.phase = "<mark>";
                        }

                        if (markTagState?.phase === "<mark data-comment>") {
                            markTagState.phase = "<mark>";
                        }

                        if (codeTagState?.phase === "<code class>") {
                            codeTagState.phase = "<code>";
                        }

                        if (mediaTagState?.phase === "attr-value") {
                            mediaTagState.phase = "open";
                        }

                        // Process div attributes as each one completes so we handle multiple attributes
                        // (e.g. `<div id="foo" style="display:flex">`).
                        if (
                            divFileState?.phase === "attr-name" ||
                            divFileState?.phase === "attr-value"
                        ) {
                            if (divFileState.attrName === "style") {
                                const declarations = parseInlineStyle(divFileState.attrValue);

                                for (const decl of declarations) {
                                    if (decl.type !== "declaration") continue;
                                    const prop = decl.property.toLowerCase();
                                    const value = decl.value.toLowerCase().trim();

                                    // Gallery rows: `display: flex`
                                    if (prop === "display" && value === "flex") {
                                        divFileState = {
                                            ...divFileState,
                                            containerType: "file-gallery-row",
                                            currentItems: [],
                                        };
                                    }

                                    // Float containers: `float: left` or `float: right`
                                    if (
                                        prop === "float" &&
                                        (value === "left" || value === "right")
                                    ) {
                                        divFileState = {
                                            ...divFileState,
                                            containerType: "file-float",
                                            floatSide: value === "right" ? "Right" : "Left",
                                            currentRow: null,
                                        };
                                    }
                                }
                            }

                            divFileState.phase = "open";
                            divFileState.attrName = "";
                            divFileState.attrValue = "";
                        }

                        tableState?.onAttributeEnd();
                    },

                    oncdata: noop,
                    oncomment: noop,
                    ondeclaration: noop,
                    onend: noop,
                    onprocessinginstruction: noop,
                },
            );

            tokenizer.write(content.value);
            tokenizer.end();

            if (elements !== undefined) {
                yield* elements;
            }

            if (textElements.length > 0) {
                yield {type: "Paragraph", elements: textElements};
            }
            break;
        }
        case "code": {
            const languageName = content.lang?.toLowerCase();
            const language = languageName
                ? apiContentCodeBlockLanguageByName.get(languageName)
                : undefined;

            yield {
                type: "Code",
                language: language ?? "text",
                lines: content.value.split("\n").map(line => ({
                    elements: line.length > 0 ? [{type: "Text", text: line, marks: undefined}] : [],
                })),
            };
            break;
        }
        case "table": {
            let columnCount = 0;
            let width: number | null = null;
            let columnWidths: Array<number> | null = null;

            const rows = content.children.map(row => {
                columnCount = Math.max(columnCount, row.children.length);

                return {
                    cells: row.children.map((cell): ApiContentTableBlockElementCell => {
                        const elements = Array.from(
                            parseAndMergeApiContentInlineElementsFromMarkdown(
                                cell.children,
                                definitions,
                                options,
                                {
                                    onSpanDataWidth: newWidth => {
                                        width = newWidth;
                                    },
                                    onSpanDataColumnWidths: newColumnWidths => {
                                        columnWidths = newColumnWidths;
                                    },
                                },
                            ),
                        );

                        return {
                            elements: elements.length > 0 ? [{type: "Paragraph", elements}] : [],
                        };
                    }),
                };
            });

            // Ensure at least 2 columns (schema requires tableCell{2,})
            columnCount = Math.max(columnCount, 2);

            for (const row of rows) {
                while (row.cells.length < columnCount) {
                    row.cells.push({elements: []});
                }
            }

            yield {
                type: "Table",
                width: width ?? 1,
                columns: createArrayWithLength(columnCount, columnIndex => ({
                    width: columnWidths?.[columnIndex] ?? 1,
                })),
                hasHeaderRow: true,
                hasHeaderColumn: undefined,
                rows,
            };
            break;
        }
        case "math": {
            // If we support math someday in `ApiContent` then we'll update this.
            yield {
                type: "Paragraph",
                elements: [
                    {type: "Text", text: "$$", marks: undefined},
                    {type: "Break", marks: undefined},
                    {type: "Text", text: content.value, marks: undefined},
                    {type: "Break", marks: undefined},
                    {type: "Text", text: "$$", marks: undefined},
                ],
            };
            break;
        }
        case "definition": {
            const futureDefinitions = definitions.futureDefinitionsByIdentifier.get(
                content.identifier,
            );

            if (futureDefinitions !== undefined) {
                const index = futureDefinitions.indexOf(content);
                if (index !== -1) futureDefinitions.splice(index, 1);
            }

            const pastDefinitions = getOrSetDefaultMapValue(
                definitions.pastDefinitionsByIdentifier,
                content.identifier,
                () => [],
            );

            pastDefinitions.unshift(content);
            break;
        }
        case "footnoteDefinition": {
            // Footnotes are ignored for now.
            break;
        }
        // @ts-expect-error: `mdast-util-frontmatter` doesn't seem to add the `yaml`
        // node type to the Markdown AST.
        case "yaml": {
            // Frontmatter is ignored for now.
            break;
        }
        default:
            throw exhaustive(content);
    }
}

class ApiContentBlockElementsMarkdownTableState {
    private _state: {
        phase: "Table" | "TableRow" | "TableCell";
        isTagOpen: boolean;
        workingWidth: string | null;
        workingColumnWidths: string | null;
        width: number | null;
        columnWidths: Array<number> | null;
        rows: Array<{
            cells: Array<{
                tagName: "td" | "th";
                isTagOpen: boolean;
                workingScope: string | null;
                scope: string | null;
                elements: Array<ApiContentBlockElement>;
            }>;
        }>;
    } | null = null;

    public onBlockElement(element: ApiContentBlockElement): boolean {
        if (this._state === null) return false;

        if (this._state.rows.length === 0) return false;
        const lastRow = this._state.rows[this._state.rows.length - 1]!;

        if (lastRow.cells.length === 0) return false;
        const lastCell = lastRow.cells[lastRow.cells.length - 1]!;

        lastCell.elements.push(element);
        return true;
    }

    // Ignore text when we're in a table and between table cells. Typically this will
    // just be a bunch of whitespace and newlines we don't care about.
    public onText(): boolean {
        if (this._state === null) return false;
        if (this._state.phase !== "TableCell") return true;
        return false;
    }

    public onOpenTagName(tagName: "table" | "thead" | "tbody" | "tr" | "th" | "td") {
        switch (tagName) {
            case "thead":
            case "tbody": {
                // Ignore...
                break;
            }
            case "table": {
                if (this._state !== null) break;

                this._state = {
                    phase: "Table",
                    isTagOpen: true,
                    workingWidth: null,
                    workingColumnWidths: null,
                    width: null,
                    columnWidths: null,
                    rows: [],
                };
                break;
            }
            case "tr": {
                if (this._state?.phase !== "Table") break;
                this._state.phase = "TableRow";
                this._state.rows.push({cells: []});
                break;
            }
            case "th":
            case "td": {
                if (this._state?.phase !== "TableRow") break;

                this._state.phase = "TableCell";

                if (this._state.rows.length === 0) {
                    this._state.rows.push({cells: []});
                }

                const lastRow = this._state.rows[this._state.rows.length - 1]!;

                lastRow.cells.push({
                    tagName,
                    isTagOpen: true,
                    workingScope: null,
                    scope: null,
                    elements: [],
                });
                break;
            }
            default:
                throw exhaustive(tagName);
        }
    }

    public onOpenTagEnd() {
        if (this._state === null) return;

        this._state.isTagOpen = false;

        const lastRow = this._state.rows[this._state.rows.length - 1];
        if (lastRow !== undefined) {
            const lastCell = lastRow.cells[lastRow.cells.length - 1]!;
            if (lastCell !== undefined) {
                lastCell.isTagOpen = false;
            }
        }
    }

    public onCloseTagName(
        tagName: "table" | "thead" | "tbody" | "tr" | "th" | "td",
    ): ApiContentTableBlockElement | null {
        switch (tagName) {
            case "thead":
            case "tbody": {
                // Ignore...
                return null;
            }
            case "tr": {
                if (this._state?.phase === "TableRow" || this._state?.phase === "TableCell") {
                    this._state.phase = "Table";
                }
                return null;
            }
            case "th":
            case "td": {
                if (this._state?.phase === "TableCell") {
                    this._state.phase = "TableRow";
                }
                return null;
            }
            case "table": {
                if (this._state === null) return null;

                const state = this._state;
                this._state = null;

                let columnCount = 0;

                let hasHeaderRow: boolean | undefined;
                let hasHeaderColumn: boolean | undefined;

                const rows = state.rows.map((row, rowIndex) => {
                    columnCount = Math.max(columnCount, row.cells.length);

                    return {
                        cells: row.cells.map((cell, columnIndex) => {
                            hasHeaderRow ??= true;
                            hasHeaderColumn ??= true;

                            hasHeaderRow &&=
                                cell.tagName === "th"
                                    ? rowIndex === 0 || cell.scope === "row"
                                    : rowIndex !== 0;

                            hasHeaderColumn &&=
                                cell.tagName === "th"
                                    ? columnIndex === 0 || cell.scope === "col"
                                    : columnIndex !== 0;

                            const elements = Array.from(
                                flatMapIterable(
                                    cell.elements,
                                    intoApiContentTableBlockElementCellElement,
                                ),
                            );

                            if (
                                elements.length === 1 &&
                                elements[0]!.type === "Paragraph" &&
                                elements[0]!.elements.length === 0
                            ) {
                                elements.pop();
                            }

                            mergeAdjacentFileElements(elements);

                            return {elements};
                        }),
                    };
                });

                // Ensure at least 2 columns (schema requires tableCell{2,})
                columnCount = Math.max(columnCount, 2);

                for (const row of rows) {
                    while (row.cells.length < columnCount) {
                        row.cells.push({elements: []});
                    }
                }

                return {
                    type: "Table",
                    width: state.width ?? 1,
                    columns: createArrayWithLength(columnCount, columnIndex => ({
                        width: state.columnWidths?.[columnIndex] ?? 1,
                    })),
                    hasHeaderRow: hasHeaderRow ? true : undefined,
                    hasHeaderColumn: hasHeaderColumn ? true : undefined,
                    rows,
                };
            }
            default:
                throw exhaustive(tagName);
        }
    }

    public onAttributeName(attributeName: string) {
        if (this._state === null) return;

        if (this._state.isTagOpen) {
            switch (attributeName) {
                case "data-width": {
                    this._state.workingWidth = "";
                    break;
                }
                case "data-column-widths": {
                    this._state.workingColumnWidths = "";
                    break;
                }
            }
        }

        const lastRow = this._state.rows[this._state.rows.length - 1];
        if (lastRow !== undefined) {
            const lastCell = lastRow.cells[lastRow.cells.length - 1]!;
            if (lastCell !== undefined && lastCell.isTagOpen && attributeName === "scope") {
                lastCell.workingScope = "";
            }
        }
    }

    public onAttributeData(attributeData: string) {
        if (this._state === null) return;

        if (this._state.workingWidth !== null) {
            this._state.workingWidth += attributeData;
        }

        if (this._state.workingColumnWidths !== null) {
            this._state.workingColumnWidths += attributeData;
        }

        const lastRow = this._state.rows[this._state.rows.length - 1];
        if (lastRow !== undefined) {
            const lastCell = lastRow.cells[lastRow.cells.length - 1]!;
            if (lastCell !== undefined && lastCell.workingScope !== null) {
                lastCell.workingScope += attributeData;
            }
        }
    }

    public onAttributeEnd() {
        if (this._state === null) return;

        // Try to parse `data-width` attribute.
        if (this._state.workingWidth !== null) {
            this._state.width = parseFloat(this._state.workingWidth);
            if (isNaN(this._state.width)) this._state.width = null;
            this._state.workingWidth = null;
        }

        // Try to parse `data-column-widths` attribute.
        if (this._state.workingColumnWidths !== null) {
            try {
                this._state.columnWidths = JSON.parse(`[${this._state.workingColumnWidths}]`);

                if (
                    !Array.isArray(this._state.columnWidths) ||
                    this._state.columnWidths.some(columnWidth => typeof columnWidth !== "number")
                ) {
                    this._state.columnWidths = null;
                }
            } catch {
                this._state.columnWidths = null;
            }
            this._state.workingColumnWidths = null;
        }

        // Parse the `scope` attribute.
        const lastRow = this._state.rows[this._state.rows.length - 1];
        if (lastRow !== undefined) {
            const lastCell = lastRow.cells[lastRow.cells.length - 1]!;
            if (lastCell !== undefined && lastCell.workingScope !== null) {
                lastCell.scope = lastCell.workingScope;
                lastCell.workingScope = null;
            }
        }
    }
}

function* parseAndMergeApiContentInlineElementsFromMarkdown(
    contents: Array<PhrasingContent>,
    definitions: ApiContentMarkdownParserDefinitions,
    options: ApiContentMarkdownParserOptions,
    callbacks?: {
        onSpanDataWidth?: (width: number | null) => void;
        onSpanDataColumnWidths?: (columnWidths: Array<number> | null) => void;
    },
): IterableIterator<ApiContentInlineElement> {
    let lastElement: ApiContentInlineElement | undefined;

    for (const element of parseApiContentInlineElementsFromMarkdown(
        contents,
        definitions,
        new ApiContentInlineElementsMarkdownParserMarkStack(),
        options,
        callbacks,
    )) {
        // Merge any adjacent text elements with the same marks.
        if (
            element.type === "Text" &&
            lastElement?.type === "Text" &&
            isDeepEqual(element.marks, lastElement.marks)
        ) {
            lastElement = {
                type: "Text",
                text: lastElement.text + element.text,
                marks: lastElement.marks,
            };
            continue;
        }

        if (lastElement !== undefined) yield lastElement;
        lastElement = element;
    }

    if (lastElement !== undefined) yield lastElement;
}

class ApiContentInlineElementsMarkdownParserMarkStack {
    private readonly _stack: Array<{
        mark: ApiContentInlineElementMark;
        forHtmlTagName: string | null;
    }> = [];

    // `null` means we haven't computed the marks yet. `undefined` means we've computed
    // the marks and there are no marks.
    private _cachedMarks: Array<ApiContentInlineElementMark> | undefined | null = null;

    public getLength() {
        return this._stack.length;
    }

    public getMarks() {
        if (this._cachedMarks === null) {
            this._cachedMarks = normalizeApiContentInlineElementMarks(
                mapIterable(this._stack, ({mark}) => mark),
            );
        }
        return this._cachedMarks;
    }

    public push(mark: ApiContentInlineElementMark) {
        this._stack.push({mark, forHtmlTagName: null});
        this._cachedMarks = null;
    }

    public pop() {
        const index = this._stack.findLastIndex(item => item.forHtmlTagName === null);
        if (index !== -1) {
            this._stack.splice(index, 1);
            this._cachedMarks = null;
        }
    }

    public pushForHtmlTag(tagName: string, mark: ApiContentInlineElementMark) {
        this._stack.push({mark, forHtmlTagName: tagName});
        this._cachedMarks = null;
    }

    public popForHtmlTag(tagName: string) {
        const index = this._stack.findLastIndex(item => item.forHtmlTagName === tagName);
        if (index !== -1) {
            this._stack.splice(index, 1);
            this._cachedMarks = null;
        }
    }
}

function* parseApiContentInlineElementsFromMarkdown(
    contents: Array<PhrasingContent>,
    definitions: ApiContentMarkdownParserDefinitions,
    markStack: ApiContentInlineElementsMarkdownParserMarkStack,
    options: ApiContentMarkdownParserOptions,
    callbacks?: {
        onSpanDataWidth?: (width: number | null) => void;
        onSpanDataColumnWidths?: (columnWidths: Array<number> | null) => void;
    },
): IterableIterator<ApiContentInlineElement> {
    let index = 0;

    while (index < contents.length) {
        const content = contents[index]!;

        if (markStack.getLength() === 0 && content.type === "text") {
            // `mdast` seems unable to parse `**<br/>**` bold formatted HTML when it's next to
            // other bold/italic content. So add special support for that here.
            if (content.value.endsWith("**") && index + 2 < contents.length) {
                const content2 = contents[index + 1]!;
                const content3 = contents[index + 2]!;

                if (
                    content2.type === "html" &&
                    content2.value === "<br/>" &&
                    content3.type === "text" &&
                    content3.value.startsWith("**")
                ) {
                    if (content.value.length > 2) {
                        yield* parseApiContentInlineElementFromMarkdown(
                            {...content, value: content.value.slice(0, -2)},
                            definitions,
                            markStack,
                            options,
                            callbacks,
                        );
                    }

                    yield {
                        type: "Break",
                        marks: [{type: "Bold"}],
                    };

                    if (content3.value.length > 2) {
                        yield* parseApiContentInlineElementFromMarkdown(
                            {...content3, value: content3.value.slice(2)},
                            definitions,
                            markStack,
                            options,
                            callbacks,
                        );
                    }

                    index += 3;
                    continue;
                }
            }

            // `mdast` seems unable to parse `*<br/>*` italic formatted HTML when it's next to
            // other bold/italic content. So add special support for that here.
            if (content.value.endsWith("*") && index + 2 < contents.length) {
                const content2 = contents[index + 1]!;
                const content3 = contents[index + 2]!;

                if (
                    content2.type === "html" &&
                    content2.value === "<br/>" &&
                    content3.type === "text" &&
                    content3.value.startsWith("*")
                ) {
                    if (content.value.length > 1) {
                        yield* parseApiContentInlineElementFromMarkdown(
                            {...content, value: content.value.slice(0, -1)},
                            definitions,
                            markStack,
                            options,
                            callbacks,
                        );
                    }

                    yield {
                        type: "Break",
                        marks: [{type: "Italic"}],
                    };

                    if (content3.value.length > 1) {
                        yield* parseApiContentInlineElementFromMarkdown(
                            {...content3, value: content3.value.slice(1)},
                            definitions,
                            markStack,
                            options,
                            callbacks,
                        );
                    }

                    index += 3;
                    continue;
                }
            }

            // `mdast` seems unable to parse `_<br/>_` italic formatted HTML when it's next to
            // other bold/italic content. So add special support for that here.
            if (content.value.endsWith("_") && index + 2 < contents.length) {
                const content2 = contents[index + 1]!;
                const content3 = contents[index + 2]!;

                if (
                    content2.type === "html" &&
                    content2.value === "<br/>" &&
                    content3.type === "text" &&
                    content3.value.startsWith("_")
                ) {
                    if (content.value.length > 1) {
                        yield* parseApiContentInlineElementFromMarkdown(
                            {...content, value: content.value.slice(0, -1)},
                            definitions,
                            markStack,
                            options,
                            callbacks,
                        );
                    }

                    yield {
                        type: "Break",
                        marks: [{type: "Italic"}],
                    };

                    if (content3.value.length > 1) {
                        yield* parseApiContentInlineElementFromMarkdown(
                            {...content3, value: content3.value.slice(1)},
                            definitions,
                            markStack,
                            options,
                            callbacks,
                        );
                    }

                    index += 3;
                    continue;
                }
            }

            // `mdast` seems unable to parse `~~[test](...)~~` strike formatted HTML. So add
            // special support for that here.
            if (content.value.endsWith("~~") && index + 2 < contents.length) {
                const content2 = contents[index + 1]!;
                const content3 = contents[index + 2]!;

                if (
                    content2.type === "link" &&
                    content3.type === "text" &&
                    content3.value.startsWith("~~")
                ) {
                    if (content.value.length > 2) {
                        yield* parseApiContentInlineElementFromMarkdown(
                            {...content, value: content.value.slice(0, -2)},
                            definitions,
                            markStack,
                            options,
                            callbacks,
                        );
                    }

                    markStack.push({type: "Strike"});
                    yield* parseApiContentInlineElementFromMarkdown(
                        content2,
                        definitions,
                        markStack,
                        options,
                        callbacks,
                    );
                    markStack.pop();

                    if (content3.value.length > 2) {
                        yield* parseApiContentInlineElementFromMarkdown(
                            {...content3, value: content3.value.slice(2)},
                            definitions,
                            markStack,
                            options,
                            callbacks,
                        );
                    }

                    index += 3;
                    continue;
                }
            }
        }

        yield* parseApiContentInlineElementFromMarkdown(
            content,
            definitions,
            markStack,
            options,
            callbacks,
        );

        index += 1;
    }
}

function* parseApiContentInlineElementFromMarkdown(
    content: PhrasingContent,
    definitions: ApiContentMarkdownParserDefinitions,
    markStack: ApiContentInlineElementsMarkdownParserMarkStack,
    options: ApiContentMarkdownParserOptions,
    callbacks:
        | {
              onSpanDataWidth?: (width: number | null) => void;
              onSpanDataColumnWidths?: (columnWidths: Array<number> | null) => void;
          }
        | undefined,
): IterableIterator<ApiContentInlineElement> {
    switch (content.type) {
        case "strong": {
            markStack.push({type: "Bold"});
            yield* parseApiContentInlineElementsFromMarkdown(
                content.children,
                definitions,
                markStack,
                options,
            );
            markStack.pop();
            break;
        }
        case "emphasis": {
            markStack.push({type: "Italic"});
            yield* parseApiContentInlineElementsFromMarkdown(
                content.children,
                definitions,
                markStack,
                options,
            );
            markStack.pop();
            break;
        }
        case "delete": {
            markStack.push({type: "Strike"});
            yield* parseApiContentInlineElementsFromMarkdown(
                content.children,
                definitions,
                markStack,
                options,
            );
            markStack.pop();
            break;
        }
        case "link": {
            // Try parsing URL.
            let url: URL | undefined;
            try {
                url = new URL(content.url);
            } catch {
                // Noop
            }

            const mentionTarget =
                url !== undefined && options.spaceId !== null
                    ? parseApiMentionTargetIfPossible(options.spaceId, url)
                    : null;

            if (mentionTarget === null) {
                markStack.push({type: "Link", url: content.url});

                yield* parseApiContentInlineElementsFromMarkdown(
                    content.children,
                    definitions,
                    markStack,
                    options,
                );

                markStack.pop();
            } else {
                const isAccountShortName =
                    mentionTarget.type === "Account" &&
                    url?.searchParams.get("mention") === "short";

                yield {
                    type: "Mention",
                    target: mentionTarget,
                    isAccountShortName: isAccountShortName || undefined,
                    marks: markStack.getMarks(),
                };
            }
            break;
        }
        case "linkReference": {
            let definition: DefinitionContent | undefined;

            const futureDefinitions = definitions.futureDefinitionsByIdentifier.get(
                content.identifier,
            );
            if (futureDefinitions !== undefined && futureDefinitions.length > 0) {
                definition = futureDefinitions[0]!;
            } else {
                const pastDefinitions = definitions.pastDefinitionsByIdentifier.get(
                    content.identifier,
                );
                if (pastDefinitions !== undefined && pastDefinitions.length > 0) {
                    definition = pastDefinitions[pastDefinitions.length - 1]!;
                }
            }

            if (definition !== undefined) {
                markStack.push({
                    type: "Link",
                    url:
                        // @ts-expect-error: For some reason the `url` property doesn't exist on the
                        // `mdast` `Definition` type.
                        definition.url ?? "",
                });
            }

            yield* parseApiContentInlineElementsFromMarkdown(
                content.children,
                definitions,
                markStack,
                options,
            );

            if (definition !== undefined) {
                markStack.pop();
            }
            break;
        }
        case "inlineCode": {
            markStack.push({type: "Code"});
            yield {type: "Text", text: content.value, marks: markStack.getMarks()};
            markStack.pop();
            break;
        }
        case "text": {
            yield {
                type: "Text",
                // `mdast` preserves single newlines in text. Presumably so we keep the newlines
                // when printing the text back out. However, we don't allow newlines in `Text`
                // elements (they're ultimately not supported by ProseMirror) so convert
                // consecutive newlines into a single space.
                text: content.value.replaceAll(/\n+/g, " "),
                marks: markStack.getMarks(),
            };
            break;
        }
        case "break": {
            yield {type: "Break", marks: markStack.getMarks()};
            break;
        }
        case "html": {
            let elements: Array<ApiContentInlineElement> | undefined;

            let anchorTagState: {
                phase: "<a>" | "<a href>";
                href: string | null;
            } | null = null;

            let markTagState: {
                phase: "<mark>" | "<mark class>" | "<mark data-comment>";
                class: string | null;
                dataComment: string | null;
            } | null = null;

            let spanTagState: {
                workingWidth: string | null;
                workingColumnWidths: string | null;
            } | null = null;

            const tokenizer = new HtmlTokenizer(
                {},
                {
                    onopentagname: (start, end) => {
                        const tagName = content.value.slice(start, end).toLowerCase();

                        switch (tagName) {
                            // We print `<br>` HTML elements when we have a break with marks. Since the `mdast`
                            // parser struggles with marks around the standard Markdown break syntax.
                            case "br": {
                                elements ??= [];
                                elements.push({type: "Break", marks: markStack.getMarks()});
                                break;
                            }
                            case "a": {
                                anchorTagState = {phase: "<a>", href: null};
                                break;
                            }
                            case "mark": {
                                markTagState = {phase: "<mark>", class: null, dataComment: null};
                                break;
                            }
                            case "strong":
                            case "b": {
                                markStack.pushForHtmlTag(tagName, {type: "Bold"});
                                break;
                            }
                            case "em":
                            case "i": {
                                markStack.pushForHtmlTag(tagName, {type: "Italic"});
                                break;
                            }
                            case "del": {
                                markStack.pushForHtmlTag(tagName, {type: "Strike"});
                                break;
                            }
                            case "code": {
                                markStack.pushForHtmlTag(tagName, {type: "Code"});
                                break;
                            }
                            case "span": {
                                spanTagState = {
                                    workingWidth: null,
                                    workingColumnWidths: null,
                                };
                                break;
                            }
                            case "table":
                            case "thead":
                            case "tbody":
                            case "tr":
                            case "th":
                            case "td": {
                                throw new UnimplementedError(
                                    "Table HTML isn\u2019t supported in Markdown phrasing content",
                                    {
                                        // Make sure we have a nice error message for API users trying to parse invalid
                                        // Markdown content into API content.
                                        displayMessage: errorDisplayMessage`Table HTML isn\u2019t supported in Markdown phrasing content.`,
                                    },
                                );
                            }
                        }
                    },
                    onopentagend: () => {
                        if (anchorTagState !== null) {
                            markStack.pushForHtmlTag("a", {
                                type: "Link",
                                url: anchorTagState.href ?? "",
                            });
                            anchorTagState = null;
                        }

                        // The `<mark>` HTML element can either be a comment or highlight.
                        if (markTagState !== null) {
                            if (
                                markTagState.dataComment &&
                                isId<DocumentCommentThreadId>(markTagState.dataComment)
                            ) {
                                markStack.pushForHtmlTag("mark", {
                                    type: "Comment",
                                    threadId: markTagState.dataComment,
                                });
                            } else {
                                let color: ApiContentInlineElementHighlightMarkColor | null = null;

                                if (markTagState.class) {
                                    const colorMatch =
                                        markTagState.class.match(/^highlight-([a-z]+)$/);

                                    color = colorMatch
                                        ? parseApiContentInlineElementHighlightMarkColorIfPossible(
                                              colorMatch[1]!,
                                          )
                                        : null;
                                }

                                markStack.pushForHtmlTag("mark", {
                                    type: "Highlight",
                                    // Default to orange since that's our closest color to yellow. The default browser
                                    // CSS typically renders `<mark>` with a yellow background.
                                    color: color ?? "Orange",
                                });
                            }
                            markTagState = null;
                        }

                        if (spanTagState !== null) {
                            spanTagState = null;
                        }
                    },
                    onclosetag: (start, end) => {
                        const tagName = content.value.slice(start, end).toLowerCase();

                        switch (tagName) {
                            case "a":
                            case "mark":
                            case "strong":
                            case "b":
                            case "em":
                            case "i":
                            case "del":
                            case "code": {
                                markStack.popForHtmlTag(tagName);
                                break;
                            }
                            case "table":
                            case "thead":
                            case "tbody":
                            case "tr":
                            case "th":
                            case "td": {
                                throw new UnimplementedError(
                                    "Table HTML isn\u2019t supported in Markdown phrasing content",
                                    {
                                        // Make sure we have a nice error message for API users trying to parse invalid
                                        // Markdown content into API content.
                                        displayMessage: errorDisplayMessage`Table HTML isn\u2019t supported in Markdown phrasing content.`,
                                    },
                                );
                            }
                        }
                    },
                    onattribname: (start, end) => {
                        const attributeName = content.value.slice(start, end).toLowerCase();

                        if (anchorTagState?.phase === "<a>" && attributeName === "href") {
                            anchorTagState.phase = "<a href>";
                            anchorTagState.href = "";
                        }

                        if (markTagState?.phase === "<mark>") {
                            if (attributeName === "class") {
                                markTagState.phase = "<mark class>";
                                markTagState.class = "";
                            } else if (attributeName === "data-comment") {
                                markTagState.phase = "<mark data-comment>";
                                markTagState.dataComment = "";
                            }
                        }

                        if (spanTagState !== null) {
                            if (attributeName === "data-width") {
                                spanTagState.workingWidth = "";
                            } else if (attributeName === "data-column-widths") {
                                spanTagState.workingColumnWidths = "";
                            }
                        }
                    },
                    onattribdata: (start, end) => {
                        const attributeData = content.value.slice(start, end);

                        if (anchorTagState?.phase === "<a href>") {
                            anchorTagState.href += attributeData;
                        }

                        if (markTagState?.phase === "<mark class>") {
                            markTagState.class += attributeData;
                        }

                        if (markTagState?.phase === "<mark data-comment>") {
                            markTagState.dataComment += attributeData;
                        }

                        if (typeof spanTagState?.workingWidth === "string") {
                            spanTagState.workingWidth += attributeData;
                        }

                        if (typeof spanTagState?.workingColumnWidths === "string") {
                            spanTagState.workingColumnWidths += attributeData;
                        }
                    },
                    onattribentity: codepoint => {
                        const attributeData = String.fromCodePoint(codepoint);

                        if (anchorTagState?.phase === "<a href>") {
                            anchorTagState.href += attributeData;
                        }

                        if (markTagState?.phase === "<mark class>") {
                            markTagState.class += attributeData;
                        }

                        if (markTagState?.phase === "<mark data-comment>") {
                            markTagState.dataComment += attributeData;
                        }

                        if (typeof spanTagState?.workingWidth === "string") {
                            spanTagState.workingWidth += attributeData;
                        }

                        if (typeof spanTagState?.workingColumnWidths === "string") {
                            spanTagState.workingColumnWidths += attributeData;
                        }
                    },
                    onattribend: () => {
                        if (anchorTagState?.phase === "<a href>") {
                            anchorTagState.phase = "<a>";
                        }

                        if (markTagState?.phase === "<mark class>") {
                            markTagState.phase = "<mark>";
                        }

                        if (markTagState?.phase === "<mark data-comment>") {
                            markTagState.phase = "<mark>";
                        }

                        // Try to parse `data-width` attribute.
                        if (typeof spanTagState?.workingWidth === "string") {
                            let width: number | null = parseFloat(spanTagState.workingWidth ?? "");
                            if (isNaN(width)) width = null;

                            callbacks?.onSpanDataWidth?.(width);

                            spanTagState.workingWidth = null;
                        }

                        // Try to parse `data-column-widths` attribute.
                        if (typeof spanTagState?.workingColumnWidths === "string") {
                            let columnWidths: Array<number> | null;
                            try {
                                columnWidths = JSON.parse(`[${spanTagState.workingColumnWidths}]`);

                                if (
                                    !Array.isArray(columnWidths) ||
                                    columnWidths.some(
                                        columnWidth => typeof columnWidth !== "number",
                                    )
                                ) {
                                    columnWidths = null;
                                }
                            } catch {
                                columnWidths = null;
                            }

                            callbacks?.onSpanDataColumnWidths?.(columnWidths);

                            spanTagState.workingColumnWidths = null;
                        }
                    },

                    oncdata: noop,
                    oncomment: noop,
                    ondeclaration: noop,
                    onend: noop,
                    onprocessinginstruction: noop,
                    onselfclosingtag: noop,
                    ontext: noop,
                    ontextentity: noop,
                },
            );

            tokenizer.write(content.value);
            tokenizer.end();

            if (elements !== undefined) {
                yield* elements;
            }
            break;
        }
        case "inlineMath": {
            // If we support math someday in `ApiContent` then we'll update this.
            yield {type: "Text", text: `$${content.value}$`, marks: markStack.getMarks()};
            break;
        }
        case "image": {
            if (options.dangerouslyAllowImageContentType) {
                // Convert images to links so they can be detected by file processing.
                // `![alt](url)` becomes a text element with a Link mark. TODO(#public-api): This
                // is not supported by the public api yet, just for imports.
                const altText = content.alt || content.url;
                const existingMarks = markStack.getMarks() ?? [];
                const marks = [...existingMarks, {type: "Link" as const, url: content.url}];
                yield {type: "Text", text: altText, marks};
            }
            // TODO(calebmer): Once we support images in `ApiContent` then we'll update this.
            break;
        }
        case "imageReference":
        case "footnoteReference": {
            // Ignore image references and footnotes for now.
            break;
        }
        default:
            throw exhaustive(content);
    }
}

function parseApiMentionTargetIfPossible(spaceId: SpaceId, url: URL): ApiMentionTarget | null {
    const isMentionUrl =
        url?.protocol === "https:" &&
        url.host === "alpine.inc" &&
        url.pathname.startsWith(`/s/${spaceId}/`) &&
        url.searchParams.has("mention");

    // This link is treated as a mention if it's an `https://alpine.inc` link with a
    // `mention` search param.
    if (!isMentionUrl) return null;

    const pathSegments = url.pathname.slice(`/s/${spaceId}/`.length).split("/");

    if (pathSegments.length === 2) {
        const pathSegment1 = pathSegments[0]!;
        const pathSegment2 = pathSegments[1]!;

        switch (pathSegment1) {
            case "accounts": {
                if (isId<AccountId>(pathSegment2)) {
                    return {type: "Account", id: pathSegment2};
                }
                break;
            }
            case "channels": {
                if (isId<ChannelId>(pathSegment2)) {
                    return {type: "Channel", id: pathSegment2};
                }
                break;
            }
            case "chats": {
                if (isId<ChatId>(pathSegment2)) {
                    return {type: "Chat", id: pathSegment2};
                }
                break;
            }
            case "documents": {
                if (isId<DocumentId>(pathSegment2)) {
                    return {type: "Document", id: pathSegment2};
                }
                break;
            }
            case "posts": {
                if (isId<PostId>(pathSegment2)) {
                    return {type: "Post", id: pathSegment2};
                }
                break;
            }
            case "tasks": {
                if (isId<TaskId>(pathSegment2)) {
                    return {type: "Task", id: pathSegment2};
                }
                break;
            }
        }
    } else if (pathSegments.length === 3) {
        if (
            pathSegments[0] === "tasks" &&
            pathSegments[1] === "collections" &&
            isId<TaskCollectionId>(pathSegments[2]!)
        ) {
            return {type: "TaskCollection", id: pathSegments[2]};
        }
    }

    return null;
}

function intoApiContentCheckListBlockElementItem(
    item: ListItem,
    elements: ReadonlyArray<ApiContentBlockElement>,
    nestedListElements: ReadonlyArray<ApiContentListBlockElement>,
): ApiContentCheckListBlockElementItem {
    assert(item.checked !== null && item.checked !== undefined);

    return {
        checked: item.checked,
        elements: Array.from(flatMapIterable(elements, intoApiContentParagraphBlockElement)),
        nestedListElements: nestedListElements?.length > 0 ? nestedListElements : undefined,
    };
}

function intoApiContentListBlockElementItem(
    item: ListItem,
    elements: ReadonlyArray<ApiContentBlockElement>,
    nestedListElements: ReadonlyArray<ApiContentListBlockElement>,
): ApiContentListBlockElementItem {
    return {
        elements: Array.from(flatMapIterable(elements, intoApiContentParagraphBlockElement)),
        nestedListElements: nestedListElements?.length > 0 ? nestedListElements : undefined,
    };
}

function parseContentListBlockElementItems<
    InputListItem extends ListItem,
    OutputListItem extends ApiContentListBlockElementItem | ApiContentCheckListBlockElementItem,
>(
    inputListItems: ReadonlyArray<InputListItem>,
    definitions: ApiContentMarkdownParserDefinitions,
    options: ApiContentMarkdownParserOptions,
    createOutputListItem: (
        inputListItem: InputListItem,
        elements: ReadonlyArray<ApiContentBlockElement>,
        nestedListElements: ReadonlyArray<ApiContentListBlockElement>,
    ) => OutputListItem,
): Array<OutputListItem> {
    return Array.from(
        flatMapIterable(inputListItems, function* (item): IterableIterator<OutputListItem> {
            let elements: Array<ApiContentBlockElement> = [];
            let nestedListElements: Array<ApiContentListBlockElement> = [];

            for (const element of parseApiContentBlockElementsFromMarkdown(
                item.children,
                definitions,
                options,
                // Instead of ignoring elements like `</td>` (which may feel broken) throw an error
                // if we see table HTML.
                {withTableHtml: false},
            )) {
                if (
                    element.type === "UnorderedList" ||
                    element.type === "OrderedList" ||
                    element.type === "CheckList"
                ) {
                    nestedListElements.push(element);
                } else {
                    if (nestedListElements.length > 0) {
                        yield createOutputListItem(item, elements, nestedListElements);

                        elements = [];
                        nestedListElements = [];
                    }

                    elements.push(element);
                }
            }

            yield createOutputListItem(item, elements, nestedListElements);
        }),
    );
}

function parseApiContentInlineElementHighlightMarkColorIfPossible(
    color: string,
): ApiContentInlineElementHighlightMarkColor | null {
    switch (color) {
        case "red":
            return "Red";
        case "orange":
            return "Orange";
        case "green":
            return "Green";
        case "blue":
            return "Blue";
        case "purple":
            return "Purple";
        default:
            return null;
    }
}

function* intoApiContentTableBlockElementCellElement(
    element: ApiContentBlockElement,
): IterableIterator<ApiContentTableBlockElementCellBlockElement> {
    switch (element.type) {
        case "Paragraph":
        case "UnorderedList":
        case "OrderedList":
        case "CheckList":
        case "Quote":
        case "Code": {
            yield element;
            break;
        }
        case "Heading": {
            yield {
                type: "Paragraph",
                elements: element.elements.map(childElement => ({
                    ...childElement,
                    marks: normalizeApiContentInlineElementMarks([
                        ...(childElement.marks ?? []),
                        {type: "Bold"},
                    ]),
                })),
            };
            break;
        }
        case "Divider": {
            yield {type: "Paragraph", elements: [{type: "Text", text: "---"}]};
            break;
        }
        case "Table": {
            for (const row of element.rows) {
                for (const cell of row.cells) {
                    for (const element of cell.elements) {
                        yield* intoApiContentQuoteBlockElementBlockElement(element);
                    }
                }
            }
            break;
        }
        case "File":
        case "Preview": {
            yield element;
            break;
        }
        case "FileGallery": {
            // Tables support single-file rows (rendered as `fileRowTable` in ProseMirror).
            // Unwrap each single-item row to a standalone File/Preview element. Multi-item
            // rows aren't supported in tables.
            for (const row of element.rows) {
                if (row.items.length !== 1) {
                    throw new InvalidArgumentError(
                        "File gallery rows with multiple items aren\u2019t supported in table cells",
                        {
                            displayMessage: errorDisplayMessage`File gallery rows with multiple items aren\u2019t supported in table cells.`,
                        },
                    );
                }
                yield row.items[0]!.element;
            }
            break;
        }
        case "FileFloat": {
            throw new InvalidArgumentError("File floats aren\u2019t supported in table cells", {
                displayMessage: errorDisplayMessage`File floats aren\u2019t supported in table cells.`,
            });
        }
        default:
            throw exhaustive(element);
    }
}

function* intoApiContentQuoteBlockElementBlockElement(
    actualElement: ApiContentBlockElement,
): IterableIterator<ApiContentQuoteBlockElementBlockElement> {
    for (const element of intoApiContentTableBlockElementCellElement(actualElement)) {
        switch (element.type) {
            case "Paragraph":
            case "UnorderedList":
            case "OrderedList":
            case "CheckList": {
                yield element;
                break;
            }
            case "Quote": {
                yield* element.elements;
                break;
            }
            case "Code": {
                for (const line of element.lines) {
                    yield {
                        type: "Paragraph",
                        elements: line.elements.map(element => ({
                            ...element,
                            marks: normalizeApiContentInlineElementMarks([
                                ...(element.marks ?? []),
                                {type: "Code"},
                            ]),
                        })),
                    };
                }
                break;
            }
            case "File": {
                throw new InvalidArgumentError("Files aren\u2019t supported in quote blocks", {
                    displayMessage: errorDisplayMessage`Files aren\u2019t supported in quote blocks.`,
                });
            }
            case "Preview": {
                throw new InvalidArgumentError("Previews aren\u2019t supported in quote blocks", {
                    displayMessage: errorDisplayMessage`Previews aren\u2019t supported in quote blocks.`,
                });
            }
            default:
                throw exhaustive(element);
        }
    }
}

export function* intoApiContentParagraphBlockElement(
    actualElement: ApiContentBlockElement,
): IterableIterator<ApiContentParagraphBlockElement> {
    for (const element of intoApiContentQuoteBlockElementBlockElement(actualElement)) {
        switch (element.type) {
            case "Paragraph": {
                yield element;
                break;
            }
            case "UnorderedList":
            case "OrderedList":
            case "CheckList": {
                for (const item of element.items) {
                    for (const itemElement of item.elements) {
                        yield itemElement;
                    }

                    if (item.nestedListElements) {
                        for (const nestedListElement of item.nestedListElements) {
                            yield* intoApiContentParagraphBlockElement(nestedListElement);
                        }
                    }
                }
                break;
            }
            default:
                throw exhaustive(element);
        }
    }
}

function intoApiContentCodeBlockElementTextInlineElementMarks(
    marks: ReadonlyArray<ApiContentInlineElementMark> | undefined,
): ReadonlyArray<ApiContentCodeBlockElementTextInlineElementMark> | undefined {
    if (marks === undefined) return undefined;

    const result: Array<ApiContentCodeBlockElementTextInlineElementMark> = [];

    for (const mark of marks) {
        switch (mark.type) {
            case "Bold":
            case "Italic":
            case "Strike":
            case "Link":
            case "Highlight":
            case "Comment":
                result.push(mark);
                break;
            case "Code":
                // Noop
                break;
            default:
                throw exhaustive(mark);
        }
    }

    return result.length > 0 ? result : undefined;
}

// NOTE(ifitzsimmons, 2026-01-07): See the comment for
// `addOrderedStartSpanToFirstItemInOrderedListIfNeeded` in
// `print_api_content_to_markdown.ts` for more details.
function getOrderStartIfExists(content: List): number | undefined {
    if (!content.ordered) return undefined;

    const orderedStart = content.start;

    // If order start is not `1`, always use the order start value.
    if (orderedStart === undefined || orderedStart === null || orderedStart !== 1) {
        return orderedStart ?? undefined;
    }

    const firstListItem = content.children[0];
    const firstListItemContent = firstListItem?.children[0];

    // In this case, `orderStart = 1` and the list content is empty. Since we always
    // inject an html element to preserve the explicit `orderStart` value of `1`, we
    // assume that the the lack of html content means that we should not preserve the
    // explicit `orderStart` value of `1`.
    if (!firstListItem || !firstListItemContent) return undefined;

    // If the first content element is an HTML element with the data-start attribute
    // return the explicit `orderStart` value of 1. We only inject the span into the
    // first element if the list item is empty (has no content). Example:
    //
    // ```markdown
    // 1. <span data-start="1"/>
    // ```
    if (doesElementHaveExplicitOrderStart(firstListItemContent)) return orderedStart;

    // Our `orderedListItem` does not currently support non-paragraph content.
    // Secondly, if markdown list is an empty paragraph, that means we did not inject
    // the html span for explicit `orderStart = 1`.
    if (firstListItemContent.type !== "paragraph" || firstListItemContent.children.length === 0) {
        return undefined;
    }

    // When a list item with explicit `orderStart = 1` _does_ have content, we inject
    // the span into the first paragraph element like so:
    //
    // ```markdown
    // 1. <span data-start="1"/>Hello world!
    // ```
    if (doesElementHaveExplicitOrderStart(firstListItemContent.children[0]!)) {
        return orderedStart;
    }

    return undefined;

    // When order start is explcitly set to 1 in our Prosemirror content
    // representation, we inject a span with the data-start attribute into the first
    // item in the list. While parsing, we look for this span to determine if we should
    // preserve the explicit order start value of `1`.
    function doesElementHaveExplicitOrderStart(
        element: PhrasingContent | BlockContent | DefinitionContent,
    ): boolean {
        return element.type === "html" && element.value.includes(`span data-start=\u201D1\u201D`);
    }
}
