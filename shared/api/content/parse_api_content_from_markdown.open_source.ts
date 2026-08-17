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
import {computeApiContentGfmTableLayout} from "~/shared/api/content/compute_api_content_gfm_table_layout.open_source.js";
import {
    normalizeApiContentBlockElement,
    normalizeApiContentInlineElementMarks,
} from "~/shared/api/content/normalize_api_content.open_source.js";
import {
    ApiContentFileOrPreviewBlockElement,
    parseApiContentFileOrPreviewBlockElementFromMarkdownUrlIfPossible,
    parseApiMentionReferenceFromMarkdownUrlIfPossible,
} from "~/shared/api/content/parse_api_content_from_markdown_url_if_possible.open_source.js";
import {apiContentCodeBlockLanguageDefinition} from "~/shared/api/specification/api_content_code_block_language_definition.open_source.js";
import {printApiReferenceKey} from "~/shared/api/specification/api_reference_key.open_source.js";
import {
    ApiContent,
    ApiContentBlockElement,
    ApiContentCheckListBlockElementItem,
    ApiContentCodeBlockElement,
    ApiContentCodeBlockElementTextInlineElement,
    ApiContentCodeBlockElementTextInlineElementMark,
    ApiContentCommentMark,
    ApiContentHeadingBlockElement,
    ApiContentHighlightMarkColor,
    ApiContentInlineElement,
    ApiContentInlineElementMark,
    ApiContentListBlockElement,
    ApiContentListBlockElementItem,
    ApiContentParagraphBlockElement,
    ApiContentQuoteBlockElementBlockElement,
    ApiContentTableBlockElement,
    ApiContentTableBlockElementCell,
    ApiContentTableBlockElementCellBlockElement,
} from "~/shared/api/specification/types/api_specification_convenience_types.open_source.js";
import {
    InternalError,
    InvalidArgumentError,
    UnimplementedError,
} from "~/shared/error/error.open_source.js";
import {errorDisplayMessage} from "~/shared/error/error_display_message.open_source.js";
import {createArrayWithLength} from "~/shared/helpers/array/create_array_with_length.open_source.js";
import {assert} from "~/shared/helpers/control/assert.open_source.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.open_source.js";
import {isDeepEqual} from "~/shared/helpers/control/is_deep_equal.open_source.js";
import {noop} from "~/shared/helpers/control/noop.open_source.js";
import {flatMapIterable} from "~/shared/helpers/iterable/flat_map_iterable.open_source.js";
import {mapIterable} from "~/shared/helpers/iterable/map_iterable.open_source.js";
import {getOrSetDefaultMapValue} from "~/shared/helpers/map/get_or_set_default_map_value.open_source.js";
import {clamp} from "~/shared/helpers/number/clamp.open_source.js";
import {emptyObject} from "~/shared/helpers/object/empty_object.open_source.js";
import {getObjectEntriesWithKeyofType} from "~/shared/helpers/object/get_object_entries_with_keyof_type.open_source.js";
import {isId} from "~/shared/id/id.open_source.js";
import {DocumentCommentThreadId} from "~/shared/id/types/id_types.open_source.js";

export type ApiContentMarkdownParserOptions = {
    /**
     * When true, we add `width`s to `FileGallery` element rows that distribute the
     * files equally within the row.
     *
     * This is used by `parseApiContentFromAgentWebMarkdown()` because the goal of that
     * function is to return `ApiContentResponse` which requires the `width` property.
     * `parseApiContentFromAgentWebMarkdown()` can't add widths itself because it
     * doesn't save file gallery widths in storage (an agent doesn't care about file
     * gallery widths).
     */
    readonly withDummyFileGalleryElementLayout?: boolean;
};

export {actuallyParseApiContentFromMarkdown as parseApiContentFromMarkdown};
export {parseApiContentFromMarkdown as parseApiContentFromMarkdownTree};

type ApiContentMarkdownParserDefinitions = {
    readonly futureDefinitionsByIdentifier: Map<string, Array<DefinitionContent>>;
    readonly pastDefinitionsByIdentifier: Map<string, Array<DefinitionContent>>;
};

type ApiContentMarkdownBlockContent =
    | BlockContent
    | DefinitionContent
    | {readonly type: "mdxFlowExpression"}
    | {readonly type: "mdxJsxFlowElement"};

type ApiContentMarkdownPhrasingContent =
    | PhrasingContent
    | {readonly type: "mdxTextExpression"}
    | {readonly type: "mdxJsxTextElement"};

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
    options?: ApiContentMarkdownParserOptions,
): ApiContent {
    const root = parseMarkdownTree(markdown);

    // IMPORTANT: Do not call `normalizeApiContent()` on this return! The parser must
    // return normalized markdown on its own without needing to call
    // `normalizeApiContent()`. If the parser doesn't return content in normalized form
    // then that's a deeper bug in the parser you should fix instead of calling
    // `normalizeApiContent()` at the top level (which is lazy).
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
            math({singleDollarTextMath: false}),
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
    options: ApiContentMarkdownParserOptions = emptyObject,
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

    const elements = Array.from(
        parseApiContentBlockElementsFromMarkdown(
            root.children as Array<BlockContent | DefinitionContent>,
            options,
            definitions,
            {withTableHtml: true},
        ),
    );

    // IMPORTANT: Do not call `normalizeApiContent()` on this return! The parser must
    // return normalized markdown on its own without needing to call
    // `normalizeApiContent()`. If the parser doesn't return content in normalized form
    // then that's a deeper bug in the parser you should fix instead of calling
    // `normalizeApiContent()` at the top level (which is lazy).
    return {
        elements: elements.length === 0 ? [{type: "Paragraph", elements: []}] : elements,
    };
}

function* parseApiContentBlockElementsFromMarkdown(
    contents: Array<ApiContentMarkdownBlockContent>,
    options: ApiContentMarkdownParserOptions,
    definitions: ApiContentMarkdownParserDefinitions,
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

        if (element.type !== "FileGallery" || !options.withDummyFileGalleryElementLayout) {
            yield element;
        } else {
            // If requested then add dummy `width` properties to `FileGallery` items where the
            // items are distributed evenly within their row.
            //
            // We have the same logic in `normalizeApiContent()`.
            yield {
                ...element,
                rows: element.rows.map(row => ({
                    ...row,
                    items: row.items.map((item, index) => ({
                        ...item,
                        width:
                            index !== row.items.length - 1
                                ? Math.round((1 / row.items.length) * 100) / 100
                                : (100 -
                                      (row.items.length - 1) *
                                          Math.round((1 / row.items.length) * 100)) /
                                  100,
                    })),
                })),
            };
        }
    }

    for (const content of contents) {
        for (const element of parseApiContentBlockElementFromMarkdown(
            content,
            options,
            definitions,
            tableState,
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

function* parseApiContentBlockElementFromMarkdown(
    content: ApiContentMarkdownBlockContent,
    options: ApiContentMarkdownParserOptions,
    definitions: ApiContentMarkdownParserDefinitions,
    tableState: ApiContentBlockElementsMarkdownTableState | null,
): IterableIterator<ApiContentBlockElement> {
    switch (content.type) {
        case "paragraph": {
            yield* parseApiContentInlineElementsAsBlockElementsFromMarkdown(
                content.children,
                definitions,
                elements => ({type: "Paragraph", elements}),
            );
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
                        options,
                        definitions,
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
                            options,
                            definitions,
                            intoApiContentListBlockElementItem,
                        ),
                    };
                } else {
                    yield {
                        type: "CheckList",
                        items: parseContentListBlockElementItems(
                            group.items,
                            options,
                            definitions,
                            intoApiContentCheckListBlockElementItem,
                        ),
                    };
                }
            }
            break;
        }
        case "blockquote": {
            const elements = Array.from(
                flatMapIterable(
                    parseApiContentBlockElementsFromMarkdown(
                        content.children,
                        options,
                        definitions,
                        // Instead of ignoring elements like `</td>` (which may feel broken) throw an error
                        // if we see table HTML.
                        {withTableHtml: false},
                    ),
                    intoApiContentQuoteBlockElementBlockElement,
                ),
            );

            yield {
                type: "Quote",
                elements: elements.length === 0 ? [{type: "Paragraph", elements: []}] : elements,
            };
            break;
        }
        case "heading": {
            yield* parseApiContentInlineElementsAsBlockElementsFromMarkdown(
                content.children,
                definitions,
                elements => ({
                    type: "Heading",
                    level: clamp(1, Math.floor(content.depth), 3),
                    elements,
                }),
            );
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
                marks?: Array<ApiContentInlineElementMark>;
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

            let mediaTagState: ParseApiContentFromHtmlMarkdownMediaTagState | null = null;

            let commentTagState: {
                phase: "<comment>" | "<comment id>";
                id: string | null;
            } | null = null;

            let codeTagState: {
                phase: "<pre>" | "<pre>..." | "<code>" | "<code class>" | "<code>..." | "</code>";
                class: string | null;
                textElements: Array<{
                    type: "Text";
                    text: string;
                    marks?: Array<ApiContentInlineElementMark>;
                }>;
            } | null = null;

            let divFileState:
                | ({
                      phase: "open" | "attr-name" | "attr-value";
                      attributeName: string;
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

                actualTextElements.push({
                    type: "Text",
                    text,
                    ...(marks !== undefined ? {marks} : {}),
                });
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
                state: ParseApiContentFromHtmlMarkdownMediaTagState,
                data: string,
            ) => {
                switch (state.attributeName) {
                    case "src":
                        if (state.tagName !== "object") state.src += data;
                        break;
                    case "data":
                        if (state.tagName === "object") state.data += data;
                        break;
                    case "alt":
                        if (state.tagName === "img") state.alt += data;
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

                if (mediaUrl) {
                    let element =
                        parseApiContentFileOrPreviewBlockElementFromMarkdownUrlIfPossible(mediaUrl);

                    const dataElement = content.data?.fileOrPreviewElementByUrl?.get(mediaUrl);
                    if (dataElement) {
                        // If we were provided a `fileElement` then use it. Since it may have response
                        // properties like `contentType` and `contentLength`. Though make sure it matches
                        // the parsed file element first.
                        assert(isDeepEqual(element, normalizeApiContentBlockElement(dataElement)));

                        element = dataElement;
                    }

                    if (element !== null) {
                        const marks = markStack
                            .getMarks()
                            ?.filter(
                                (mark): mark is ApiContentCommentMark => mark.type === "Comment",
                            );

                        if (marks !== undefined && marks.length > 0) {
                            element = {...element, marks};
                        }

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
                                    elements: [{type: "Break"}],
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
                                    // `<a href="https://alpine.inc/doc/...">Title</a>` inside a gallery div to create
                                    // a preview element.
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
                            case "comment": {
                                commentTagState = {phase: "<comment>", id: null};
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
                                    attributeName: "",
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
                                    attributeName: "",
                                };
                                break;
                            }
                            case "object": {
                                mediaTagState = {
                                    tagName,
                                    data: null,
                                    style: null,
                                    phase: "open",
                                    attributeName: "",
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
                                    mediaTagState.attributeName = "";
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
                                        attributeName: "",
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
                                    thread: {id: markTagState.dataComment},
                                });
                            } else {
                                let color: ApiContentHighlightMarkColor | null = null;

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

                        if (
                            commentTagState !== null &&
                            commentTagState.id !== null &&
                            isId<DocumentCommentThreadId>(commentTagState.id)
                        ) {
                            markStack.pushForHtmlTag("comment", {
                                type: "Comment",
                                thread: {id: commentTagState.id},
                            });
                            commentTagState = null;
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
                            divFileState.attributeName = "";
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
                            case "mark":
                            case "comment": {
                                markStack.popForHtmlTag(tagName);
                                break;
                            }
                            case "a": {
                                // Resolve a preview anchor tag into a Preview element. We don't print previews as
                                // `<a>` tags, but an agent might use anchor syntax to reference a preview URL.
                                if (previewAnchorState !== null) {
                                    const element =
                                        parseApiContentFileOrPreviewBlockElementFromMarkdownUrlIfPossible(
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
                                                    ...(marks !== undefined ? {marks} : {}),
                                                });
                                            }
                                        } else {
                                            lines.push({
                                                elements:
                                                    text.length > 0
                                                        ? [
                                                              {
                                                                  type: "Text",
                                                                  text,
                                                                  ...(marks !== undefined
                                                                      ? {marks}
                                                                      : {}),
                                                              },
                                                          ]
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
                                      attributeName: "",
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

                        if (commentTagState?.phase === "<comment>") {
                            if (attributeName === "id") {
                                commentTagState.phase = "<comment id>";
                                commentTagState.id = "";
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
                                mediaTagState.phase = "attribute";
                                mediaTagState.attributeName = attributeName;
                            }
                        }

                        if (divFileState?.phase === "open") {
                            divFileState.phase = "attr-name";
                            divFileState.attributeName = attributeName;
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

                        if (commentTagState?.phase === "<comment id>") {
                            commentTagState.id += attributeData;
                        }

                        if (codeTagState?.phase === "<code class>") {
                            codeTagState.class += attributeData;
                        }

                        if (mediaTagState?.phase === "attribute") {
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

                        if (commentTagState?.phase === "<comment id>") {
                            commentTagState.id += attributeData;
                        }

                        if (codeTagState?.phase === "<code class>") {
                            codeTagState.class += attributeData;
                        }

                        if (mediaTagState?.phase === "attribute") {
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

                        if (commentTagState?.phase === "<comment id>") {
                            commentTagState.phase = "<comment>";
                        }

                        if (codeTagState?.phase === "<code class>") {
                            codeTagState.phase = "<code>";
                        }

                        if (mediaTagState?.phase === "attribute") {
                            mediaTagState.phase = "open";
                        }

                        // Process div attributes as each one completes so we handle multiple attributes
                        // (e.g. `<div id="foo" style="display:flex">`).
                        if (
                            divFileState?.phase === "attr-name" ||
                            divFileState?.phase === "attr-value"
                        ) {
                            if (divFileState.attributeName === "style") {
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
                            divFileState.attributeName = "";
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
                    elements: line.length > 0 ? [{type: "Text", text: line}] : [],
                })),
            };
            break;
        }
        case "table": {
            const tableLayout = computeApiContentGfmTableLayout(content);

            const rows = content.children.map(row => {
                const cells = row.children.map((cell): ApiContentTableBlockElementCell => {
                    const elements = Array.from(
                        parseApiContentInlineElementsAsBlockElementsFromMarkdown(
                            cell.children,
                            definitions,
                            elements => ({type: "Paragraph", elements}),
                        ),
                    );

                    return {
                        elements:
                            elements.length === 0 ? [{type: "Paragraph", elements: []}] : elements,
                    };
                });

                while (cells.length < 2) {
                    cells.push({elements: [{type: "Paragraph", elements: []}]});
                }

                return {cells};
            });

            if (rows.length === 0) {
                rows.push({
                    cells: [
                        {elements: [{type: "Paragraph", elements: []}]},
                        {elements: [{type: "Paragraph", elements: []}]},
                    ],
                });
            }

            yield {
                type: "Table",
                width: tableLayout.tableWidth,
                columns: tableLayout.columnWidths.map(width => ({width})),
                hasHeaderRow: true,
                rows,
            };
            break;
        }
        case "math": {
            // If we support math someday in `ApiContent` then we'll update this.
            yield {
                type: "Paragraph",
                elements: [
                    {type: "Text", text: "$$"},
                    {type: "Break"},
                    {type: "Text", text: content.value},
                    {type: "Break"},
                    {type: "Text", text: "$$"},
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
        case "mdxFlowExpression":
        case "mdxJsxFlowElement": {
            throw new InternalError("Unreachable, Markdown parser doesn\u2019t use MDX plugin");
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

// Media tag states are split by tag type so that each only carries the fields
// relevant to that tag. `<img>` has `alt`; `<object>` uses `data` instead of
// `src`; `<video>`/`<audio>` can receive their URL from a child `<source>`
// element.
type ParseApiContentFromHtmlMarkdownMediaTagState =
    // `<img>` gets its URL from `src` and carries `alt` text (used as the preview
    // title).
    (
        | {tagName: "img"; src: string | null; alt: string | null}
        // `<object>` uses `data` instead of `src` for its URL.
        | {tagName: "object"; data: string | null}
        // `<video>`/`<audio>` get their URL from `src` on the tag itself or from a child
        // `<source>` element.
        | {tagName: "video" | "audio"; src: string | null}
    ) & {
        style: string | null;
        phase: "open" | "attribute";
        attributeName: string;
    };

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
                    const cells = row.cells.map(
                        (cell, columnIndex): ApiContentTableBlockElementCell => {
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

                            return {
                                elements:
                                    elements.length === 0
                                        ? [{type: "Paragraph", elements: []}]
                                        : elements,
                            };
                        },
                    );

                    while (cells.length < 2) {
                        cells.push({elements: [{type: "Paragraph", elements: []}]});
                    }

                    columnCount = Math.max(columnCount, cells.length);

                    return {cells};
                });

                if (rows.length === 0) {
                    rows.push({
                        cells: [
                            {elements: [{type: "Paragraph", elements: []}]},
                            {elements: [{type: "Paragraph", elements: []}]},
                        ],
                    });

                    columnCount = Math.max(columnCount, 2);
                }

                return {
                    type: "Table",
                    width: state.width ?? 1,
                    columns: createArrayWithLength(columnCount, columnIndex => ({
                        width: state.columnWidths?.[columnIndex] ?? 1,
                    })),
                    ...(hasHeaderRow === true ? {hasHeaderRow} : {}),
                    ...(hasHeaderColumn === true ? {hasHeaderColumn} : {}),
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

type ApiContentInlineElementOrFileOrPreviewBlockElement =
    | ApiContentInlineElement
    | {type: "FileOrPreview"; element: ApiContentFileOrPreviewBlockElement};

function* parseApiContentInlineElementsAsBlockElementsFromMarkdown<
    BlockElement extends ApiContentParagraphBlockElement | ApiContentHeadingBlockElement,
>(
    contents: Array<PhrasingContent>,
    definitions: ApiContentMarkdownParserDefinitions,
    createBlockElement: (elements: Array<ApiContentInlineElement>) => BlockElement,
): IterableIterator<BlockElement | ApiContentFileOrPreviewBlockElement> {
    let hasYielded = false;
    let trimNextStart = false;
    let elements: Array<ApiContentInlineElement> | null = null;

    for (const element of parseAndMergeApiContentInlineElementsFromMarkdown(
        contents,
        definitions,
    )) {
        if (element.type === "FileOrPreview") {
            hasYielded = true;

            if (elements !== null) {
                const lastElement = elements[elements.length - 1];

                // Trim whitepsace around the file or preview block element. Which is rendered, as
                // a block, on a new line instead of inline.
                if (lastElement?.type === "Text") {
                    const trimmedText = lastElement.text.trimEnd();

                    if (trimmedText.length === 0) {
                        elements.pop();
                    } else {
                        elements[elements.length - 1] = {
                            ...lastElement,
                            text: trimmedText,
                        };
                    }
                }

                if (elements.length > 0) {
                    yield createBlockElement(elements);
                }
                elements = null;
            }

            trimNextStart = true;
            yield element.element;
            continue;
        }

        if (!trimNextStart) {
            elements ??= [];
            elements.push(element);
        } else {
            // Trim whitepsace around the file or preview block element. Which is rendered, as
            // a block, on a new line instead of inline.

            trimNextStart = false;

            if (element.type !== "Text") {
                elements ??= [];
                elements.push(element);
            } else {
                const trimmedText = element.text.trimStart();
                if (trimmedText.length > 0) {
                    elements ??= [];
                    elements.push({...element, text: trimmedText});
                }
            }
        }
    }

    if (elements !== null) {
        yield createBlockElement(elements);
    } else if (!hasYielded) {
        yield createBlockElement([]);
    }
}

function* parseAndMergeApiContentInlineElementsFromMarkdown(
    contents: Array<ApiContentMarkdownPhrasingContent>,
    definitions: ApiContentMarkdownParserDefinitions,
): IterableIterator<ApiContentInlineElementOrFileOrPreviewBlockElement> {
    let lastElement: ApiContentInlineElementOrFileOrPreviewBlockElement | undefined;

    for (const element of parseApiContentInlineElementsFromMarkdown(
        contents,
        definitions,
        new ApiContentInlineElementsMarkdownParserMarkStack(),
        {current: null},
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
                ...(element.marks !== undefined ? {marks: element.marks} : {}),
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
    contents: Array<ApiContentMarkdownPhrasingContent>,
    definitions: ApiContentMarkdownParserDefinitions,
    markStack: ApiContentInlineElementsMarkdownParserMarkStack,
    mediaTagStateRef: {current: ParseApiContentFromHtmlMarkdownMediaTagState | null},
): IterableIterator<ApiContentInlineElementOrFileOrPreviewBlockElement> {
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
                            mediaTagStateRef,
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
                            mediaTagStateRef,
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
                            mediaTagStateRef,
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
                            mediaTagStateRef,
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
                            mediaTagStateRef,
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
                            mediaTagStateRef,
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
                            mediaTagStateRef,
                        );
                    }

                    markStack.push({type: "Strike"});
                    yield* parseApiContentInlineElementFromMarkdown(
                        content2,
                        definitions,
                        markStack,
                        mediaTagStateRef,
                    );
                    markStack.pop();

                    if (content3.value.length > 2) {
                        yield* parseApiContentInlineElementFromMarkdown(
                            {...content3, value: content3.value.slice(2)},
                            definitions,
                            markStack,
                            mediaTagStateRef,
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
            mediaTagStateRef,
        );

        index += 1;
    }
}

function* parseApiContentInlineElementFromMarkdown(
    content: ApiContentMarkdownPhrasingContent,
    definitions: ApiContentMarkdownParserDefinitions,
    markStack: ApiContentInlineElementsMarkdownParserMarkStack,
    mediaTagStateRef: {current: ParseApiContentFromHtmlMarkdownMediaTagState | null},
): IterableIterator<ApiContentInlineElementOrFileOrPreviewBlockElement> {
    switch (content.type) {
        case "strong": {
            markStack.push({type: "Bold"});
            yield* parseApiContentInlineElementsFromMarkdown(
                content.children,
                definitions,
                markStack,
                mediaTagStateRef,
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
                mediaTagStateRef,
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
                mediaTagStateRef,
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

            let mentionReference =
                url !== undefined ? parseApiMentionReferenceFromMarkdownUrlIfPossible(url) : null;

            if (mentionReference !== null) {
                // If a mention reference was already parsed for us then let's use that instead. It
                // may be a response specialization and contain additional properties like `title`.
                if (content.data?.mentionReference) {
                    assert(
                        printApiReferenceKey(mentionReference) ===
                            printApiReferenceKey(content.data.mentionReference),
                    );

                    mentionReference = content.data.mentionReference;
                }

                const isAccountShortName =
                    mentionReference.type === "Account" && url?.hash === "#short";

                const marks = markStack.getMarks();

                yield {
                    type: "Mention",
                    reference: mentionReference,
                    ...(isAccountShortName ? {isAccountShortName} : {}),
                    ...(marks !== undefined ? {marks} : {}),
                };
                break;
            }

            // Parse links that look like previews (e.g.
            // `https://alpine.inc/doc/:documentId/preview`) as preview elements. As a
            // convenience if you forget to add the `!` in front of your link to turn it into
            // an image.
            let fileOrPreviewElement =
                url !== undefined
                    ? parseApiContentFileOrPreviewBlockElementFromMarkdownUrlIfPossible(url)
                    : null;

            if (fileOrPreviewElement !== null) {
                const marks = markStack
                    .getMarks()
                    ?.filter((mark): mark is ApiContentCommentMark => mark.type === "Comment");

                if (marks !== undefined && marks.length > 0) {
                    fileOrPreviewElement = {...fileOrPreviewElement, marks};
                }

                yield {type: "FileOrPreview", element: fileOrPreviewElement};
                break;
            }

            markStack.push({type: "Link", url: content.url});

            yield* parseApiContentInlineElementsFromMarkdown(
                content.children,
                definitions,
                markStack,
                mediaTagStateRef,
            );

            markStack.pop();
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
                mediaTagStateRef,
            );

            if (definition !== undefined) {
                markStack.pop();
            }
            break;
        }
        case "inlineCode": {
            markStack.push({type: "Code"});
            const marks = markStack.getMarks();
            yield {type: "Text", text: content.value, ...(marks !== undefined ? {marks} : {})};
            markStack.pop();
            break;
        }
        case "text": {
            const marks = markStack.getMarks();

            yield {
                type: "Text",
                // `mdast` preserves single newlines in text. Presumably so we keep the newlines
                // when printing the text back out. However, we don't allow newlines in `Text`
                // elements (they're ultimately not supported by ProseMirror) so convert
                // consecutive newlines into a single space.
                text: content.value.replaceAll(/\n+/g, " "),
                ...(marks !== undefined ? {marks} : {}),
            };
            break;
        }
        case "break": {
            const marks = markStack.getMarks();
            yield {type: "Break", ...(marks !== undefined ? {marks} : {})};
            break;
        }
        case "html": {
            let elements: Array<ApiContentInlineElementOrFileOrPreviewBlockElement> | undefined;

            let anchorTagState: {
                phase: "<a>" | "<a href>";
                href: string | null;
            } | null = null;

            let markTagState: {
                phase: "<mark>" | "<mark class>" | "<mark data-comment>";
                class: string | null;
                dataComment: string | null;
            } | null = null;

            let commentTagState: {
                phase: "<comment>" | "<comment id>";
                id: string | null;
            } | null = null;

            // Append attribute data to the correct field on the current media tag state.
            const appendMediaTagAttribute = (
                state: ParseApiContentFromHtmlMarkdownMediaTagState,
                data: string,
            ) => {
                switch (state.attributeName) {
                    case "src":
                        if (state.tagName !== "object") state.src += data;
                        break;
                    case "data":
                        if (state.tagName === "object") state.data += data;
                        break;
                    case "alt":
                        if (state.tagName === "img") state.alt += data;
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
                if (mediaTagStateRef.current === null) return;

                const mediaUrl =
                    mediaTagStateRef.current.tagName === "object"
                        ? mediaTagStateRef.current.data
                        : mediaTagStateRef.current.src;

                // For `<video>`/`<audio>` with `<source>` children, the src comes from the child.
                // Don't clear state on the open tag end if no URL is found yet.
                if (
                    !force &&
                    (mediaTagStateRef.current.tagName === "video" ||
                        mediaTagStateRef.current.tagName === "audio") &&
                    !mediaUrl
                ) {
                    return;
                }

                if (mediaUrl) {
                    let element =
                        parseApiContentFileOrPreviewBlockElementFromMarkdownUrlIfPossible(mediaUrl);

                    const dataElement = content.data?.fileOrPreviewElementByUrl?.get(mediaUrl);
                    if (dataElement) {
                        // If we were provided a `fileElement` then use it. Since it may have response
                        // properties like `contentType` and `contentLength`. Though make sure it matches
                        // the parsed file element first.
                        assert(isDeepEqual(element, normalizeApiContentBlockElement(dataElement)));

                        element = dataElement;
                    }

                    if (element !== null) {
                        const marks = markStack
                            .getMarks()
                            ?.filter(
                                (mark): mark is ApiContentCommentMark => mark.type === "Comment",
                            );

                        if (marks !== undefined && marks.length > 0) {
                            element = {...element, marks};
                        }

                        elements ??= [];
                        elements.push({type: "FileOrPreview", element});
                    }
                }
                mediaTagStateRef.current = null;
            };

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

                                const marks = markStack.getMarks();

                                elements.push({
                                    type: "Break",
                                    ...(marks !== undefined ? {marks} : {}),
                                });
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
                            case "comment": {
                                commentTagState = {phase: "<comment>", id: null};
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
                            case "img": {
                                mediaTagStateRef.current = {
                                    tagName,
                                    src: null,
                                    alt: null,
                                    style: null,
                                    phase: "open",
                                    attributeName: "",
                                };
                                break;
                            }
                            case "video":
                            case "audio": {
                                mediaTagStateRef.current = {
                                    tagName,
                                    src: null,
                                    style: null,
                                    phase: "open",
                                    attributeName: "",
                                };
                                break;
                            }
                            case "object": {
                                mediaTagStateRef.current = {
                                    tagName,
                                    data: null,
                                    style: null,
                                    phase: "open",
                                    attributeName: "",
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
                                    mediaTagStateRef.current !== null &&
                                    (mediaTagStateRef.current.tagName === "video" ||
                                        mediaTagStateRef.current.tagName === "audio")
                                ) {
                                    mediaTagStateRef.current.phase = "open";
                                    mediaTagStateRef.current.attributeName = "";
                                }

                                break;
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
                                    thread: {id: markTagState.dataComment},
                                });
                            } else {
                                let color: ApiContentHighlightMarkColor | null = null;

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

                        if (
                            commentTagState !== null &&
                            commentTagState.id !== null &&
                            isId<DocumentCommentThreadId>(commentTagState.id)
                        ) {
                            markStack.pushForHtmlTag("comment", {
                                type: "Comment",
                                thread: {id: commentTagState.id},
                            });
                            commentTagState = null;
                        }

                        // Handle non-self-closing media tags (<img>, <audio>, <object>).
                        handleMediaTagEnd();
                    },
                    onclosetag: (start, end) => {
                        const tagName = content.value.slice(start, end).toLowerCase();

                        switch (tagName) {
                            case "a":
                            case "mark":
                            case "comment":
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
                        }
                    },
                    onselfclosingtag: () => {
                        // Handle self-closing media tags (<img/>, <audio/>, <object/>).
                        handleMediaTagEnd();
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

                        if (commentTagState?.phase === "<comment>") {
                            if (attributeName === "id") {
                                commentTagState.phase = "<comment id>";
                                commentTagState.id = "";
                            }
                        }

                        if (mediaTagStateRef.current?.phase === "open") {
                            let recognized = false;

                            if (attributeName === "style") {
                                mediaTagStateRef.current.style = "";
                                recognized = true;
                            } else if (
                                attributeName === "src" &&
                                mediaTagStateRef.current.tagName !== "object"
                            ) {
                                mediaTagStateRef.current.src = "";
                                recognized = true;
                            } else if (
                                attributeName === "data" &&
                                mediaTagStateRef.current.tagName === "object"
                            ) {
                                mediaTagStateRef.current.data = "";
                                recognized = true;
                            } else if (
                                attributeName === "alt" &&
                                mediaTagStateRef.current.tagName === "img"
                            ) {
                                mediaTagStateRef.current.alt = "";
                                recognized = true;
                            }

                            if (recognized) {
                                mediaTagStateRef.current.phase = "attribute";
                                mediaTagStateRef.current.attributeName = attributeName;
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

                        if (commentTagState?.phase === "<comment id>") {
                            commentTagState.id += attributeData;
                        }

                        if (mediaTagStateRef.current?.phase === "attribute") {
                            appendMediaTagAttribute(mediaTagStateRef.current, attributeData);
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

                        if (commentTagState?.phase === "<comment id>") {
                            commentTagState.id += attributeData;
                        }

                        if (mediaTagStateRef.current?.phase === "attribute") {
                            appendMediaTagAttribute(mediaTagStateRef.current, attributeData);
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

                        if (commentTagState?.phase === "<comment id>") {
                            commentTagState.phase = "<comment>";
                        }

                        if (mediaTagStateRef.current?.phase === "attribute") {
                            mediaTagStateRef.current.phase = "open";
                        }
                    },

                    oncdata: noop,
                    oncomment: noop,
                    ondeclaration: noop,
                    onend: noop,
                    onprocessinginstruction: noop,
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
            const marks = markStack.getMarks();

            // If we support math someday in `ApiContent` then we'll update this.
            yield {
                type: "Text",
                text: `$${content.value}$`,
                ...(marks !== undefined ? {marks} : {}),
            };
            break;
        }
        case "image": {
            let fileOrPreviewElement =
                parseApiContentFileOrPreviewBlockElementFromMarkdownUrlIfPossible(content.url);

            if (content.data?.fileElement) {
                // If we were provided a `fileElement` then use it. Since it may have response
                // properties like `contentType` and `contentLength`. Though make sure it matches
                // the parsed file element first.
                assert(
                    isDeepEqual(
                        fileOrPreviewElement,
                        normalizeApiContentBlockElement(content.data.fileElement),
                    ),
                );

                fileOrPreviewElement = content.data.fileElement;
            } else if (content.data?.previewElement) {
                // If we were provided a `previewElement` then use it. Since it may have response
                // properties like `reference.title`. Though make sure it matches the parsed
                // preview element first.
                assert(
                    isDeepEqual(
                        fileOrPreviewElement,
                        normalizeApiContentBlockElement(content.data.previewElement),
                    ),
                );

                fileOrPreviewElement = content.data.previewElement;
            }

            if (fileOrPreviewElement !== null) {
                const marks = markStack
                    .getMarks()
                    ?.filter((mark): mark is ApiContentCommentMark => mark.type === "Comment");

                if (marks !== undefined && marks.length > 0) {
                    fileOrPreviewElement = {...fileOrPreviewElement, marks};
                }

                yield {type: "FileOrPreview", element: fileOrPreviewElement};
                break;
            }
            break;
        }
        case "imageReference":
        case "footnoteReference": {
            // Ignore image references and footnotes for now.
            break;
        }
        case "mdxTextExpression":
        case "mdxJsxTextElement": {
            throw new InternalError("Unreachable, Markdown parser doesn\u2019t use MDX plugin");
        }
        default:
            throw exhaustive(content);
    }
}

function intoApiContentCheckListBlockElementItem(
    item: ListItem,
    elements: ReadonlyArray<ApiContentBlockElement>,
    nestedListElements: ReadonlyArray<ApiContentListBlockElement>,
): ApiContentCheckListBlockElementItem {
    assert(item.checked !== null && item.checked !== undefined);

    const mappedElements = Array.from(
        flatMapIterable(elements, intoApiContentParagraphBlockElement),
    );

    if (mappedElements.length === 0 && (!nestedListElements || nestedListElements.length === 0))
        mappedElements.push({type: "Paragraph", elements: []});

    return {
        checked: item.checked,
        elements: mappedElements,
        ...(nestedListElements && nestedListElements.length > 0 ? {nestedListElements} : {}),
    };
}

function intoApiContentListBlockElementItem(
    item: ListItem,
    elements: ReadonlyArray<ApiContentBlockElement>,
    nestedListElements: ReadonlyArray<ApiContentListBlockElement>,
): ApiContentListBlockElementItem {
    const mappedElements = Array.from(
        flatMapIterable(elements, intoApiContentParagraphBlockElement),
    );

    if (mappedElements.length === 0 && (!nestedListElements || nestedListElements.length === 0))
        mappedElements.push({type: "Paragraph", elements: []});

    return {
        elements: mappedElements,
        ...(nestedListElements && nestedListElements.length > 0 ? {nestedListElements} : {}),
    };
}

function parseContentListBlockElementItems<
    InputListItem extends ListItem,
    OutputListItem extends ApiContentListBlockElementItem | ApiContentCheckListBlockElementItem,
>(
    inputListItems: ReadonlyArray<InputListItem>,
    options: ApiContentMarkdownParserOptions,
    definitions: ApiContentMarkdownParserDefinitions,
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
                options,
                definitions,
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
): ApiContentHighlightMarkColor | null {
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
