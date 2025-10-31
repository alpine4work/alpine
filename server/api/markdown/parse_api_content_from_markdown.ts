import {Tokenizer as HtmlTokenizer} from "htmlparser2";
import {BlockContent, DefinitionContent, PhrasingContent, Root, RootContent} from "mdast";
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
import {normalizeApiContentInlineElementMarks} from "~/server/api/markdown/normalize_api_content.js";
import {apiContentCodeBlockLanguageDefinition} from "~/shared/api/api_content_code_block_language_definition.js";
import {
    ApiContent,
    ApiContentBlockElement,
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
    ApiMentionPath,
} from "~/shared/api/types/api_specification_convenience_types.js";
import {UnimplementedError} from "~/shared/error/error.js";
import {errorDisplayMessage} from "~/shared/error/error_display_message.js";
import {createArrayWithLength} from "~/shared/helpers/array/create_array_with_length.js";
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
    DocumentCommentThreadId,
    DocumentId,
    PostId,
    SpaceId,
    TaskCollectionId,
    TaskId,
} from "~/shared/id/types/id_types.js";

export type ApiContentMarkdownParserOptions = {
    readonly spaceId: SpaceId;
};

export {actuallyParseApiContentFromMarkdown as parseApiContentFromMarkdown};
export {parseApiContentFromMarkdown as parseApiContentFromMarkdownTree};

type ApiContentMarkdownParserDefinitions = {
    readonly futureDefinitionsByIdentifier: Map<string, Array<DefinitionContent>>;
    readonly pastDefinitionsByIdentifier: Map<string, Array<DefinitionContent>>;
};

// TODO(calebmer, #public-api): Clearly document backwards compatibility
// commitment for Markdown printing vs parsing. We're committing to always
// printing the same Markdown for the same content. However, we may choose to
// parse Markdown differently over time. We'll never change how we parse
// Markdown we've printed but as we add new features, Markdown that used to be
// parsed one way may be parsed in some different way.
//
// For example, say we add collapsible sections. We may print this to Markdown
// using the `<details>` element ([like GitHub][1]). Currently when we parse a
// `<details>` element we ignore it (since we ignore unknown HTML) but we'll
// make a backwards incompatible change where we start parsing `<details>` as a
// collapsible section giving different meaning to the Markdown the user
// provides us.
//
// Another example, it seems likely we may support some kind of math Markdown
// extension someday (ChatGPT and Claude seem to use [the `$$math$$`
// syntax][2]). We're currently escaping `$` to reserve the ability to use math
// in markdown in the future.
//
// [1]: https://docs.github.com/en/get-started/writing-on-github/working-with-advanced-formatting/organizing-information-with-collapsed-sections
// [2]: https://github.com/syntax-tree/mdast-util-math
// [3]: https://genai.stackexchange.com/questions/386/how-does-chatgpt-render-math-in-markdown-output
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
    },
): Root {
    return fromMarkdown(markdown, "utf-8", {
        // NOTE(calebmer): We add these options via patch to `micromark-core-commonmark`,
        // `micromark`, and `mdast-util-from-markdown`. These options are technically
        // incompatible with the CommonMark spec which is why they aren't enabled
        // by default.
        allowUndefinedLinkReferenceIdentifiers: options?.allowUndefinedLinkReferenceIdentifiers,
        allowAttentionWithoutClose: options?.allowAttentionWithoutClose,
        allowCodeTextWithoutClose: options?.allowCodeTextWithoutClose,
        allowLabelWithoutClose: options?.allowLabelWithoutClose,

        extensions: [
            gfmStrikethrough(),
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
            // NOTE(calebmer, 2025-08-08): We don't currently support math symbols in
            // content but we might want to support math in the future. So make sure we
            // escape `$` and `$$` to reserve them.
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

function* parseApiContentBlockElementsFromMarkdown(
    contents: Array<BlockContent | DefinitionContent>,
    definitions: ApiContentMarkdownParserDefinitions,
    options: ApiContentMarkdownParserOptions,
    // Required option so caller must make a choice on whether to enable this
    // property or not.
    {withTableHtml}: {withTableHtml: boolean},
): IterableIterator<ApiContentBlockElement> {
    const tableState = withTableHtml ? new ApiContentBlockElementsMarkdownTableState() : null;

    for (const content of contents) {
        for (const element of parseApiContentBlockElementFromMarkdown(
            content,
            definitions,
            tableState,
            options,
        )) {
            if (tableState !== null && tableState.onBlockElement(element)) continue;

            yield element;
        }
    }
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
    content: BlockContent | DefinitionContent,
    definitions: ApiContentMarkdownParserDefinitions,
    tableState: ApiContentBlockElementsMarkdownTableState | null,
    options: ApiContentMarkdownParserOptions,
): IterableIterator<ApiContentBlockElement> {
    switch (content.type) {
        case "paragraph": {
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
            yield {
                type: content.ordered ? "OrderedList" : "UnorderedList",
                items: Array.from(
                    flatMapIterable(
                        content.children,
                        function* (item): IterableIterator<ApiContentListBlockElementItem> {
                            let elements: Array<ApiContentBlockElement> = [];
                            let nestedListElements: Array<ApiContentListBlockElement> = [];

                            for (const element of parseApiContentBlockElementsFromMarkdown(
                                item.children,
                                definitions,
                                options,
                                // Instead of ignoring elements like `</td>` (which may feel broken) throw an
                                // error if we see table HTML.
                                {withTableHtml: false},
                            )) {
                                if (
                                    element.type === "UnorderedList" ||
                                    element.type === "OrderedList"
                                ) {
                                    nestedListElements.push(element);
                                } else {
                                    if (nestedListElements.length > 0) {
                                        yield {
                                            elements: Array.from(
                                                flatMapIterable(
                                                    elements,
                                                    intoApiContentParagraphBlockElement,
                                                ),
                                            ),
                                            nestedListElements,
                                        };

                                        elements = [];
                                        nestedListElements = [];
                                    }

                                    elements.push(element);
                                }
                            }

                            yield {
                                elements: Array.from(
                                    flatMapIterable(elements, intoApiContentParagraphBlockElement),
                                ),
                                nestedListElements:
                                    nestedListElements.length > 0 ? nestedListElements : undefined,
                            };
                        },
                    ),
                ),
            };
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
                            // Instead of ignoring elements like `</td>` (which may feel broken) throw an
                            // error if we see table HTML.
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

            let codeTagState: {
                phase: "<pre>" | "<pre>..." | "<code>" | "<code class>" | "<code>..." | "</code>";
                class: string | null;
                textElements: Array<{
                    type: "Text";
                    text: string;
                    marks: Array<ApiContentInlineElementMark> | undefined;
                }>;
            } | null = null;

            const markStack = new ApiContentInlineElementsMarkdownParserMarkStack();

            const handleText = (text: string) => {
                if (text.length === 0) return;

                // Perform HTML space crushing. Any consecutive whitespace in HTML is collapsed
                // to a single space. If we're in `<pre><code>` then we must preserve
                // whitespace.
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
                if (!tableState?.onBlockElement(element)) {
                    elements ??= [];
                    elements.push(element);
                }
            };

            const tokenizer = new HtmlTokenizer(
                {},
                {
                    ontext: (start, end) => {
                        const text = content.value.slice(start, end);
                        if (tableState?.onText()) return;
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
                                anchorTagState = {phase: "<a>", href: null};
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
                                        "Table HTML isn’t supported in this Markdown block content parent",
                                        {
                                            // Make sure we have a nice error message for API users trying to parse invalid
                                            // Markdown content into API content.
                                            displayMessage: errorDisplayMessage`Table HTML isn’t supported in this Markdown block content parent.`,
                                        },
                                    );
                                }

                                tableState.onOpenTagName(tagName);
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
                                    // Default to orange since that's our closest color to yellow. The default
                                    // browser CSS typically renders `<mark>` with a yellow background.
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
                            case "a":
                            case "mark": {
                                markStack.popForHtmlTag(tagName);
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
                                // > Whitespace inside this element is displayed as written, with one
                                // > exception. If one or more leading newline characters are included
                                // > immediately following the opening `<pre>` tag, the _first_ newline
                                // > character is stripped.
                                //
                                // We also strip the final newline if one exists since it naturally forms the
                                // end of our block.
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
                                        "Table HTML isn’t supported in this Markdown block content parent",
                                        {
                                            // Make sure we have a nice error message for API users trying to parse invalid
                                            // Markdown content into API content.
                                            displayMessage: errorDisplayMessage`Table HTML isn’t supported in this Markdown block content parent.`,
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

                        if (codeTagState?.phase === "<code>" && attributeName === "class") {
                            codeTagState.phase = "<code class>";
                            codeTagState.class = "";
                        }

                        tableState?.onAttributeName(attributeName);
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

                        if (codeTagState?.phase === "<code class>") {
                            codeTagState.class += attributeData;
                        }

                        tableState?.onAttributeData(attributeData);
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

                        if (codeTagState?.phase === "<code class>") {
                            codeTagState.class += attributeData;
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

                        tableState?.onAttributeEnd();
                    },

                    oncdata: noop,
                    oncomment: noop,
                    ondeclaration: noop,
                    onend: noop,
                    onprocessinginstruction: noop,
                    onselfclosingtag: noop,
                },
            );

            tokenizer.write(content.value);

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

    // Ignore text when we're in a table and between table cells. Typically this
    // will just be a bunch of whitespace and newlines we don't care about.
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

                            return {elements};
                        }),
                    };
                });

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

    // `null` means we haven't computed the marks yet. `undefined` means we've
    // computed the marks and there are no marks.
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
            // `mdast` seems unable to parse `**<br/>**` bold formatted HTML when it's next
            // to other bold/italic content. So add special support for that here.
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

            // `mdast` seems unable to parse `*<br/>*` italic formatted HTML when it's next
            // to other bold/italic content. So add special support for that here.
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

            // `mdast` seems unable to parse `_<br/>_` italic formatted HTML when it's next
            // to other bold/italic content. So add special support for that here.
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

            // `mdast` seems unable to parse `~~[test](...)~~` strike formatted HTML. So
            // add special support for that here.
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

            const mentionTargetPath = url
                ? parseApiMentionPathIfPossible(options.spaceId, url)
                : null;

            if (mentionTargetPath === null) {
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
                    mentionTargetPath.startsWith("/accounts/") &&
                    url?.searchParams.get("mention") === "short";

                yield {
                    type: "Mention",
                    targetPath: mentionTargetPath,
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
            yield {type: "Text", text: content.value, marks: markStack.getMarks()};
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
                            // We print `<br>` HTML elements when we have a break with marks. Since the
                            // `mdast` parser struggles with marks around the standard Markdown break
                            // syntax.
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
                                    "Table HTML isn’t supported in Markdown phrasing content",
                                    {
                                        // Make sure we have a nice error message for API users trying to parse invalid
                                        // Markdown content into API content.
                                        displayMessage: errorDisplayMessage`Table HTML isn’t supported in Markdown phrasing content.`,
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
                                    // Default to orange since that's our closest color to yellow. The default
                                    // browser CSS typically renders `<mark>` with a yellow background.
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
                                    "Table HTML isn’t supported in Markdown phrasing content",
                                    {
                                        // Make sure we have a nice error message for API users trying to parse invalid
                                        // Markdown content into API content.
                                        displayMessage: errorDisplayMessage`Table HTML isn’t supported in Markdown phrasing content.`,
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
        case "image":
        case "imageReference":
        case "footnoteReference": {
            // Ignore images and footnotes for now.
            //
            // TODO(calebmer): Once we support images in `ApiContent` then we'll
            // update this.
            break;
        }
        default:
            throw exhaustive(content);
    }
}

export function parseApiMentionPathIfPossible(spaceId: SpaceId, url: URL): ApiMentionPath | null {
    const isMentionUrl =
        url?.protocol === "https:" &&
        url.host === "alpine.inc" &&
        url.pathname.startsWith(`/s/${spaceId}/`) &&
        url.searchParams.has("mention");

    // This link is treated as a mention if it's an `https://alpine.inc` link with
    // a `mention` search param.
    if (!isMentionUrl) return null;

    const pathSegments = url.pathname.slice(`/s/${spaceId}/`.length).split("/");

    if (pathSegments.length === 2) {
        const pathSegment1 = pathSegments[0]!;
        const pathSegment2 = pathSegments[1]!;

        switch (pathSegment1) {
            case "accounts": {
                if (isId<AccountId>(pathSegment2)) {
                    return `/accounts/${pathSegment2}`;
                }
                break;
            }
            case "channels": {
                if (isId<ChannelId>(pathSegment2)) {
                    return `/channels/${pathSegment2}`;
                }
                break;
            }
            case "documents": {
                if (isId<DocumentId>(pathSegment2)) {
                    return `/documents/${pathSegment2}`;
                }
                break;
            }
            case "posts": {
                if (isId<PostId>(pathSegment2)) {
                    return `/posts/${pathSegment2}`;
                }
                break;
            }
            case "tasks": {
                if (isId<TaskId>(pathSegment2)) {
                    return `/tasks/${pathSegment2}`;
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
            return `/task-collections/${pathSegments[2]}`;
        }
    }

    return null;
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
            case "OrderedList": {
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
            case "OrderedList": {
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
