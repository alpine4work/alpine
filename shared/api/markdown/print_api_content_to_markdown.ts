import escapeHtml from "escape-html";
import {
    BlockContent,
    Html,
    List,
    ListItem,
    Paragraph,
    PhrasingContent,
    Root,
    RootContent,
    TableCell,
    TableRow,
} from "mdast";
import {frontmatterToMarkdown} from "mdast-util-frontmatter";
import {gfmStrikethroughToMarkdown} from "mdast-util-gfm-strikethrough";
import {gfmTableToMarkdown} from "mdast-util-gfm-table";
import {gfmTaskListItemToMarkdown} from "mdast-util-gfm-task-list-item";
import {mathToMarkdown} from "mdast-util-math";
import {toMarkdown} from "mdast-util-to-markdown";
import {assertApiChecklistBlockElementItem} from "~/shared/api/markdown/assert_api_checklist_block_element_item.js";
import {getApiMentionReferenceNoun} from "~/shared/api/markdown/get_api_mention_reference_noun.js";
import {normalizeApiContentInlineElementMarks} from "~/shared/api/markdown/normalize_api_content.js";
import {
    ApiContent,
    ApiContentBlockElement,
    ApiContentCodeBlockElement,
    ApiContentCodeBlockElementTextInlineElementMark,
    ApiContentCodeMark,
    ApiContentFileBlockElement,
    ApiContentFileGalleryBlockElementRow,
    ApiContentHighlightMarkColor,
    ApiContentInlineElement,
    ApiContentInlineElementMark,
    ApiContentLinkMark,
    ApiContentMentionInlineElement,
    ApiContentParagraphBlockElement,
    ApiContentPreviewBlockElement,
    ApiContentTableBlockElement,
    ApiMentionReference,
    ApiPreviewReference,
} from "~/shared/api/specification/types/api_specification_convenience_types.js";
import {createArrayWithLength} from "~/shared/helpers/array/create_array_with_length.js";
import {emptyArray} from "~/shared/helpers/array/empty_array.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {isDeepEqual} from "~/shared/helpers/control/is_deep_equal.js";
import {concatIterables} from "~/shared/helpers/iterable/concat_iterables.js";
import {reverseIterable} from "~/shared/helpers/iterable/reverse_iterable.js";

declare module "mdast" {
    export interface EmphasisData {
        // NOTE(calebmer): We have a patch for `mdast-util-to-markdown` that checks this
        // property and uses it when printing emphasis nodes.
        emphasisMarker?: "*" | "_";
    }

    export interface LinkData {
        mentionElement?: ApiContentMentionInlineElement;
        mentionReference?: ApiMentionReference;
    }

    export interface ImageData {
        fileElement?: ApiContentFileBlockElement;
        previewElement?: ApiContentPreviewBlockElement;
    }

    export interface HtmlData {
        expectedOpenHtml?: string;
        expectedCloseHtml?: string;
        fileElement?: ApiContentFileBlockElement;
        previewElement?: ApiContentPreviewBlockElement;
        fileGalleryElementRow?: ApiContentFileGalleryBlockElementRow;
        fileOrPreviewElementByUrl?: Map<
            string,
            ApiContentFileBlockElement | ApiContentPreviewBlockElement
        >;
    }
}

export type ApiContentMarkdownPrinterOptions = {
    /**
     * If `true` then we convert comment marks to simple `<comment>` tags.
     *
     * ```html
     * <mark data-comment="1234567890">commented text</mark>
     * ```
     *
     * becomes
     *
     * ```html
     * <comment id="1234567890">commented text</comment>
     * ```
     */
    readonly withCommentTagHtml?: boolean;
};

type ApiContentInternalMarkdownPrinterOptions = ApiContentMarkdownPrinterOptions & {
    /**
     * Force line breaks to be printed as HTML. This is useful inside containers where
     * markdown hard-break syntax can interact with neighboring text.
     */
    readonly forceBreakHtml?: boolean;
};

export {actuallyPrintApiContentToMarkdown as printApiContentToMarkdown};
export {printApiContentToMarkdown as printApiContentToMarkdownTree};

function actuallyPrintApiContentToMarkdown(
    content: ApiContent,
    options: ApiContentMarkdownPrinterOptions = {},
): string {
    const root = printApiContentToMarkdown(content, options);
    return printMarkdownTree(root);
}

export function printMarkdownTree(root: Root | RootContent): string {
    return toMarkdown(root, {
        bullet: "-",
        rule: "-",
        extensions: [
            gfmStrikethroughToMarkdown(),
            // Disable `tablePipeAlign` since we can have arbitrarily long content in tables.
            // We don't want to add a ton of spaces and dashes for one really long cell. The
            // Markdown we print is optimized for machine (AI or API) readability not human
            // readability. Extra spaces aren't useful for machines, only humans.
            //
            // If you want human readable Markdown run Prettier on the Markdown output.
            gfmTableToMarkdown({tablePipeAlign: false}),
            gfmTaskListItemToMarkdown(),
            // NOTE(calebmer, 2025-08-08): We don't currently support math symbols in content
            // but we might want to support math in the future. So make sure we escape `$` and
            // `$$` to reserve them.
            //
            // We disable single dollar syntax so dollar signs like $4.2 in text don't need to
            // be escaped.
            mathToMarkdown({singleDollarTextMath: false}),
            // NOTE(calebmer, 2025-09-02): We don't currently support frontmatter in our
            // Markdown but we want to reserve the syntax so we have the ability to use
            // frontmatter in the future.
            frontmatterToMarkdown("yaml"),
        ],
    });
}

function printApiContentToMarkdown(
    content: ApiContent,
    options: ApiContentMarkdownPrinterOptions = {},
): Root {
    const firstPrintableBlockElementIndex = getFirstPrintableBlockElementIndex(content.elements);

    return {
        type: "root",
        children:
            // If the first element in our content is a divider then we serialize it using the
            // HTML syntax `<hr />` so the divider isn't confused with frontmatter. Ignore
            // leading empty lists since they don't print any markdown and are stripped by
            // normalization during round trips.
            firstPrintableBlockElementIndex !== -1 &&
            content.elements[firstPrintableBlockElementIndex]!.type === "Divider"
                ? Array.from(
                      concatIterables(
                          [{type: "html", value: "<hr />"}],
                          printApiContentBlockElementsToMarkdown(
                              content.elements.slice(firstPrintableBlockElementIndex + 1),
                              options,
                          ),
                      ),
                  )
                : Array.from(printApiContentBlockElementsToMarkdown(content.elements, options)),
    };
}

/**
 * Finds the first block element that can produce markdown output.
 *
 * Empty lists are skipped because they don't print anything and normalization
 * removes them during markdown round trips.
 */
function getFirstPrintableBlockElementIndex(
    elements: ReadonlyArray<ApiContentBlockElement>,
): number {
    for (let index = 0; index < elements.length; index++) {
        const element = elements[index]!;

        if (
            (element.type === "UnorderedList" ||
                element.type === "OrderedList" ||
                element.type === "CheckList") &&
            element.items.length === 0
        ) {
            continue;
        }

        return index;
    }

    return -1;
}

function* printApiContentBlockElementsToMarkdown(
    elements: ReadonlyArray<ApiContentBlockElement>,
    options: ApiContentInternalMarkdownPrinterOptions,
): IterableIterator<BlockContent> {
    let pendingContent: BlockContent | null = null;

    for (const element of elements) {
        for (const content of printApiContentBlockElementToMarkdown(element, options)) {
            // Merge adjacent lists together.
            if (
                pendingContent?.type === "list" &&
                content.type === "list" &&
                pendingContent.ordered === content.ordered &&
                // Only merge ordered lists if the second list does not have an explicit order
                // start.
                (content.start === undefined || content.start === null)
            ) {
                for (const childContent of content.children)
                    pendingContent.children.push(childContent);
                continue;
            }

            if (content.type === "list" && content.ordered) {
                addOrderedStartSpanToFirstItemInOrderedListIfNeeded(content);
            }

            if (pendingContent !== null) yield pendingContent;
            pendingContent = content;
        }
    }

    if (pendingContent !== null) yield pendingContent;
}

function* printApiContentBlockElementToMarkdown(
    element: ApiContentBlockElement,
    options: ApiContentInternalMarkdownPrinterOptions,
): IterableIterator<BlockContent> {
    switch (element.type) {
        case "Paragraph": {
            const children = printApiContentInlineElementsToMarkdown(element.elements, options);

            if (children.length === 0) {
                yield {
                    type: "html",
                    value: "<p></p>",
                };
                break;
            }

            yield {
                type: "paragraph",
                children,
            };
            break;
        }
        case "UnorderedList":
        case "OrderedList":
        case "CheckList": {
            if (element.items.length === 0) break;

            const orderedAttributes =
                element.type === "OrderedList"
                    ? {
                          ordered: true,
                          start: element.orderStart,
                      }
                    : {ordered: false};

            yield {
                type: "list",
                ...orderedAttributes,
                children: element.items.map((item, index) => {
                    const children = Array.from(
                        concatIterables(
                            printApiContentBlockElementsToMarkdown(
                                item.elements.length > 0
                                    ? item.elements
                                    : element.type !== "CheckList" &&
                                        (item.nestedListElements === undefined ||
                                            item.nestedListElements.every(
                                                nestedElement => nestedElement.items.length === 0,
                                            ))
                                      ? emptyArray
                                      : element.type !== "UnorderedList" || index > 0
                                        ? [{type: "Paragraph", elements: []}]
                                        : emptyArray,
                                options,
                            ),
                            item.nestedListElements
                                ? printApiContentBlockElementsToMarkdown(
                                      item.nestedListElements,
                                      options,
                                  )
                                : emptyArray,
                        ),
                    );

                    // The GFM specification says that a check list item must start with a paragraph
                    // node.
                    //
                    // > A task list item is a list item where the first block in it is a paragraph
                    // > which begins with a task list item marker and at least one whitespace
                    // > character before any other content.
                    //
                    // So when we print an empty paragraph as `{type: "html", value: "<p></p>"}` it's
                    // not wrapped in a paragraph node and so not printed as a GFM check list item.
                    // Replace `{type: "html", value: "<p></p>"}` with `<span></span>` (e.g.
                    // `{type: "paragraph", children: [{type: "html", value: "<span></span>"}]}`) so
                    // the GFM check list item is printed properly.
                    if (element.type === "CheckList" && children.length > 0) {
                        const firstChild = children[0]!;

                        if (firstChild.type !== "paragraph") {
                            assert(firstChild.type === "html" && firstChild.value === "<p></p>");

                            children[0] = {
                                type: "paragraph",
                                children: [{type: "html", value: "<span></span>"}],
                            };
                        }
                    }

                    return {
                        type: "listItem",
                        checked:
                            element.type === "CheckList"
                                ? assertApiChecklistBlockElementItem(item).checked
                                : undefined,
                        children,
                    };
                }),
            };
            break;
        }
        case "Quote": {
            yield {
                type: "blockquote",
                children: Array.from(
                    printApiContentBlockElementsToMarkdown(element.elements, options),
                ),
            };
            break;
        }
        case "Heading": {
            const children = printApiContentInlineElementsToMarkdown(element.elements, {
                ...options,
                forceBreakHtml: true,
            });

            assert(element.level === 1 || element.level === 2 || element.level === 3);

            yield {
                type: "heading",
                depth: element.level,
                children,
            };
            break;
        }
        case "Divider": {
            yield {type: "thematicBreak"};
            break;
        }
        case "Code": {
            yield printApiContentCodeBlockElementToMarkdown(element, options);
            break;
        }
        case "Table": {
            yield* printApiContentTableBlockElementToMarkdown(element, options);
            break;
        }
        case "File": {
            const fileUrl = printApiFileContentUrl(element.id);
            if (!element.contentType || isWebSafeImageContentType(element.contentType)) {
                const children: Array<PhrasingContent> = [
                    // Web safe images (and files with unknown content type) use markdown image syntax.
                    {type: "image", url: fileUrl, alt: null, data: {fileElement: element}},
                ];

                if (element.marks) {
                    for (const mark of reverseIterable(element.marks)) {
                        children.unshift({
                            type: "html",
                            value: options.withCommentTagHtml
                                ? `<comment id="${mark.thread.id}">`
                                : `<mark data-comment="${mark.thread.id}">`,
                        });

                        children.push({
                            type: "html",
                            value: options.withCommentTagHtml ? "</comment>" : "</mark>",
                        });
                    }
                }

                yield {type: "paragraph", children};
            } else {
                const htmlNode: Html = {
                    type: "html",
                    value: printApiContentFileBlockElementToMarkdown(fileUrl, element.contentType),
                    data: {fileElement: element},
                };

                let children: Array<PhrasingContent> | undefined;

                if (element.marks) {
                    for (const mark of reverseIterable(element.marks)) {
                        children ??= [htmlNode];

                        children.unshift({
                            type: "html",
                            value: options.withCommentTagHtml
                                ? `<comment id="${mark.thread.id}">`
                                : `<mark data-comment="${mark.thread.id}">`,
                        });

                        children.push({
                            type: "html",
                            value: options.withCommentTagHtml ? "</comment>" : "</mark>",
                        });
                    }
                }

                yield children ? {type: "paragraph", children} : htmlNode;
            }
            break;
        }
        case "Preview": {
            const children: Array<PhrasingContent> = [
                {
                    type: "image",
                    url: printApiPreviewReferenceToPreviewUrl(element.reference),
                    alt: printApiMentionReferenceToMentionLinkLabel(element.reference),
                    data: {previewElement: element},
                },
            ];

            if (element.marks) {
                for (const mark of reverseIterable(element.marks)) {
                    children.unshift({
                        type: "html",
                        value: options.withCommentTagHtml
                            ? `<comment id="${mark.thread.id}">`
                            : `<mark data-comment="${mark.thread.id}">`,
                    });

                    children.push({
                        type: "html",
                        value: options.withCommentTagHtml ? "</comment>" : "</mark>",
                    });
                }
            }

            yield {type: "paragraph", children};
            break;
        }
        case "FileGallery": {
            // A gallery with a single row containing a single element renders the same as a
            // standalone File/Preview (normalization would unwrap it).
            if (element.rows.length === 1 && element.rows[0]!.items.length === 1) {
                yield* printApiContentBlockElementToMarkdown(
                    element.rows[0]!.items[0]!.element,
                    options,
                );
                break;
            }

            for (const row of element.rows) {
                // Single-element rows render as standalone File/Preview elements, matching how
                // normalization unwraps them.
                if (row.items.length === 1) {
                    yield* printApiContentBlockElementToMarkdown(row.items[0]!.element, options);
                    continue;
                }

                const lines = [`<div style="display: flex; align-items: stretch">`];

                // Round widths to the nearest integer percent. Derive the last from 100 -
                // sum(previous) so they sum to exactly 100.
                const widthPercents: Array<number> = [];
                let widthPercentSum = 0;
                for (let i = 0; i < row.items.length; i++) {
                    const item = assertExists(row.items[i]);
                    // Width is required in the Response type but optional in the request type. Both go
                    // through this code path, so default to equal widths when not provided. This means
                    // we can't assertExists here.
                    const width = item.width ?? 1 / row.items.length;

                    const widthPercent =
                        i < row.items.length - 1 ? Math.round(width * 100) : 100 - widthPercentSum;

                    widthPercentSum += widthPercent;
                    widthPercents.push(widthPercent);
                }

                for (let i = 0; i < row.items.length; i++) {
                    const item = row.items[i]!;
                    const widthPercent = assertExists(widthPercents[i]);

                    let html = printApiContentFileOrPreviewBlockElementToMarkdown(
                        item.element,
                        `flex: 0 0 ${widthPercent}%`,
                    );

                    if (item.element.marks) {
                        for (const mark of reverseIterable(item.element.marks)) {
                            html = options.withCommentTagHtml
                                ? `<comment id="${mark.thread.id}">${html}</comment>`
                                : `<mark data-comment="${mark.thread.id}">${html}</mark>`;
                        }
                    }

                    lines.push(html);
                }
                lines.push(`</div>`);
                yield {type: "html", value: lines.join("\n"), data: {fileGalleryElementRow: row}};
            }
            break;
        }
        case "FileFloat": {
            const side = element.side === "Right" ? "right" : "left";
            const style = `float: ${side}; clear: both`;

            let html = printApiContentFileOrPreviewBlockElementToMarkdown(element.element);

            if (element.element.marks) {
                for (const mark of reverseIterable(element.element.marks)) {
                    html = options.withCommentTagHtml
                        ? `<comment id="${mark.thread.id}">${html}</comment>`
                        : `<mark data-comment="${mark.thread.id}">${html}</mark>`;
                }
            }

            yield {
                type: "html",
                value: `<div style="${style}">\n${html}\n</div>`,
                data:
                    element.element.type === "Preview"
                        ? {previewElement: element.element}
                        : {fileElement: element.element},
            };
            break;
        }
        default:
            throw exhaustive(element);
    }
}

/**
 * Render a file URL as an HTML element string. Uses the same content type checks
 * as `content_editor_dom_clipboard_serializer.ts` to make sure we only put
 * web-safe content types in `<img>`, `<video>`, and `<audio>` tags. Everything
 * else falls back to `<object>`.
 */
function printApiContentFileBlockElementToMarkdown(
    fileUrl: string,
    contentType: string | undefined,
    styleAttr = "",
): string {
    const escapedUrl = escapeHtml(fileUrl);

    // If the file is a web safe image then use an `<img>` element. Files with unknown
    // content type also use `<img>` as the default.
    if (!contentType || isWebSafeImageContentType(contentType)) {
        return `<img src="${escapedUrl}"${styleAttr} />`;
    }

    // If the file is web safe video then use a `<video>` element. `video/mp4` is not
    // strictly web safe since it depends on the codecs used, but it's a common format
    // for sharing video on the web so we treat it as web safe here.
    //
    // https://developer.mozilla.org/en-US/docs/Web/HTML/Element/video
    if (isWebSafeVideoContentType(contentType) || contentType === "video/mp4") {
        return `<video type="${escapeHtml(contentType)}" src="${escapedUrl}" controls${styleAttr}></video>`;
    }

    // If the file is web safe audio then use an `<audio>` element. `audio/mp4` is not
    // strictly web safe since it depends on the codecs used, but it's a common format
    // for sharing audio on the web so we treat it as web safe here.
    //
    // https://developer.mozilla.org/en-US/docs/Web/HTML/Element/audio
    if (isWebSafeAudioContentType(contentType) || contentType === "audio/mp4") {
        return `<audio type="${escapeHtml(contentType)}" src="${escapedUrl}" controls${styleAttr}></audio>`;
    }

    // Otherwise, fallback to an `<object>` element.
    return `<object type="${escapeHtml(contentType)}" data="${escapedUrl}"${styleAttr}></object>`;
}

function printApiContentFileOrPreviewBlockElementToMarkdown(
    element:
        | {readonly type: "File"; readonly id: string; readonly contentType?: string}
        | {readonly type: "Preview"; readonly reference: ApiPreviewReference},
    style?: string,
): string {
    const styleAttr = style ? ` style="${escapeHtml(style)}"` : "";
    switch (element.type) {
        case "File": {
            const fileUrl = printApiFileContentUrl(element.id);
            return printApiContentFileBlockElementToMarkdown(
                fileUrl,
                element.contentType,
                styleAttr,
            );
        }
        case "Preview": {
            const previewUrl = printApiPreviewReferenceToPreviewUrl(element.reference);
            const title = element.reference.title?.trim() ? element.reference.title : "";
            return `<img alt="${escapeHtml(title)}" src="${escapeHtml(previewUrl)}"${styleAttr} />`;
        }
        default:
            throw exhaustive(element);
    }
}

function printApiContentCodeBlockElementToMarkdown(
    element: ApiContentCodeBlockElement,
    options: ApiContentMarkdownPrinterOptions,
): BlockContent {
    let hasMarks = false;
    let value = "";

    outer: for (let lineIndex = 0; lineIndex < element.lines.length; lineIndex++) {
        // Add a newline character between each line.
        if (lineIndex !== 0) value += "\n";

        const line = element.lines[lineIndex]!;

        for (const lineElement of line.elements) {
            if (lineElement.text.length === 0) continue;

            if (!lineElement.marks || lineElement.marks.length === 0) {
                assert(!lineElement.text.includes("\n"));
                value += lineElement.text;
                continue;
            }

            hasMarks = true;
            break outer;
        }
    }

    if (!hasMarks) {
        return {
            type: "code",
            lang: element.language,
            value,
        };
    }

    // The HTML specification itself recommends `class="language-*"` as a way to signal
    // the language we're using:
    // https://html.spec.whatwg.org/multipage/text-level-semantics.html#the-code-element
    let html = `<pre>\n<code class="language-${escapeHtml(element.language)}">\n`;

    for (const line of element.lines) {
        let openMarks: Array<ApiContentCodeBlockElementTextInlineElementMark> = [];

        for (const lineElement of line.elements) {
            if (lineElement.text.length === 0) continue;

            const marks = normalizeApiContentInlineElementMarks(lineElement.marks) ?? [];

            // Find the length of the shared prefix between openMarks and marks
            let sharedPrefixLength = 0;
            for (let i = 0; i < Math.min(openMarks.length, marks.length); i++) {
                const openMark = openMarks[i]!;
                const newMark = marks[i]!;

                // Check if marks are the same (including URL for links)
                if (!isDeepEqual(openMark, newMark)) break;

                sharedPrefixLength++;
            }

            // Close marks that are not in the shared prefix (in reverse order)
            for (let i = openMarks.length - 1; i >= sharedPrefixLength; i--) {
                const mark = openMarks[i]!;
                switch (mark.type) {
                    case "Bold":
                        html += "</strong>";
                        break;
                    case "Italic":
                        html += "</em>";
                        break;
                    case "Strike":
                        html += "</del>";
                        break;
                    case "Link":
                        html += "</a>";
                        break;
                    case "Highlight":
                        html += "</mark>";
                        break;
                    case "Comment": {
                        html += options.withCommentTagHtml ? "</comment>" : "</mark>";
                        break;
                    }
                    default:
                        throw exhaustive(mark);
                }
            }

            // Update openMarks to just the shared prefix
            openMarks = openMarks.slice(0, sharedPrefixLength);

            // Open new marks that are not in the shared prefix
            for (let i = sharedPrefixLength; i < marks.length; i++) {
                const mark = marks[i]!;
                switch (mark.type) {
                    case "Bold":
                        html += "<strong>";
                        break;
                    case "Italic":
                        html += "<em>";
                        break;
                    case "Strike":
                        html += "<del>";
                        break;
                    case "Link": {
                        html += `<a href="${escapeHtml(mark.url)}">`;
                        break;
                    }
                    case "Highlight": {
                        const color = printApiContentInlineElementHighlightMarkColor(mark.color);
                        html += `<mark class="highlight-${color}">`;
                        break;
                    }
                    case "Comment": {
                        html += options.withCommentTagHtml
                            ? `<comment id="${mark.thread.id}">`
                            : `<mark data-comment="${mark.thread.id}">`;
                        break;
                    }
                    default:
                        throw exhaustive(mark);
                }
                openMarks.push(mark);
            }

            assert(!lineElement.text.includes("\n"));
            html += escapeHtml(lineElement.text);
        }

        // Close any remaining open marks at the end of the line
        for (let i = openMarks.length - 1; i >= 0; i--) {
            const mark = openMarks[i]!;
            switch (mark.type) {
                case "Bold":
                    html += "</strong>";
                    break;
                case "Italic":
                    html += "</em>";
                    break;
                case "Strike":
                    html += "</del>";
                    break;
                case "Link":
                    html += "</a>";
                    break;
                case "Highlight":
                    html += "</mark>";
                    break;
                case "Comment":
                    html += options.withCommentTagHtml ? "</comment>" : "</mark>";
                    break;
                default:
                    throw exhaustive(mark);
            }
        }

        // Add newline after each line.
        html += "\n";
    }

    html += "</code>\n</pre>";

    return {type: "html", value: html};
}

export function isSimpleApiContentTableBlockElementForTest(
    element: ApiContentTableBlockElement,
): boolean {
    assert(import.meta.jest);

    return printSimpleApiContentTableBlockElementToMarkdownIfPossible(element, {}) !== null;
}

function printSimpleApiContentTableBlockElementToMarkdownIfPossible(
    element: ApiContentTableBlockElement,
    options: ApiContentMarkdownPrinterOptions,
): BlockContent | null {
    // Simple GFM tables must have a header row.
    if (!element.hasHeaderRow) return null;

    // Simple GFM tables don't support a header column.
    if (element.hasHeaderColumn) return null;

    // We can't configure table or column width for simple GFM tables. So unfortunately
    // we fall back to HTML `<table>`s. This is quite a bummer but the alternatives are
    // difficult for agents and developers to work with. (e.g. Including a
    // `<span hidden>` in the table or a wrapper `<div>` that carries
    // `data-column-widths` is inconsistent with how we handle column widths for
    // `<table>`s.)
    //
    // Also, as we add more customizations to tables we'll just see more bail-out cases
    // to HTML `<table>` so we may live in a future where most tables need to be HTML
    // `<table>`s anyway.
    if (element.width !== 1 || element.columns.some(column => column.width !== 1)) return null;

    let columnCount: number | null = null;
    const rows: Array<TableRow> = [];

    for (let rowIndex = 0; rowIndex < Math.max(1, element.rows.length); rowIndex++) {
        const row = element.rows[rowIndex] ?? {cells: []};

        if (columnCount === null) {
            columnCount = row.cells.length;
        } else if (columnCount !== row.cells.length) {
            // Can't print table with uneven number of cells to GFM table.
            return null;
        }

        const cells: Array<TableCell> = [];
        rows.push({type: "tableRow", children: cells});

        for (let columnIndex = 0; columnIndex < Math.max(2, row.cells.length); columnIndex++) {
            const cell = row.cells[columnIndex] ?? {elements: []};

            let paragraphElement: ApiContentParagraphBlockElement | null;

            if (cell.elements.length === 0) {
                paragraphElement = null;
            } else if (cell.elements.length === 1 && cell.elements[0]!.type === "Paragraph") {
                paragraphElement = cell.elements[0]!;
            } else {
                // Simple tables must have a single paragraph in each cell!
                return null;
            }

            // For some reason the text `\|` in inline code breaks GFM table parsing. I haven't
            // investigated why specifically this breaks GFM table parsing but our generative
            // test has produced a test showing it does.
            //
            // Handle this edge case by switching to table HTML syntax.
            if (paragraphElement !== null) {
                for (const inlineElement of paragraphElement.elements) {
                    if (
                        inlineElement.type === "Text" &&
                        inlineElement.marks?.some(mark => mark.type === "Code") &&
                        inlineElement.text.includes("\\|")
                    ) {
                        return null;
                    }
                }
            }

            cells.push({
                type: "tableCell",
                children:
                    paragraphElement !== null
                        ? printApiContentInlineElementsToMarkdown(paragraphElement.elements, {
                              ...options,
                              // Can't have a line break character within a table cell. So use HTML syntax for
                              // breaks.
                              forceBreakHtml: true,
                          })
                        : [],
            });
        }
    }

    return {
        type: "table",
        align: createArrayWithLength(
            Math.max(columnCount ?? element.columns.length, 2),
            () => null,
        ),
        children: rows,
    };
}

function* printApiContentTableBlockElementToMarkdown(
    element: ApiContentTableBlockElement,
    options: ApiContentMarkdownPrinterOptions,
): IterableIterator<BlockContent> {
    const simpleTable = printSimpleApiContentTableBlockElementToMarkdownIfPossible(
        element,
        options,
    );
    if (simpleTable !== null) {
        yield simpleTable;
        return;
    }

    let tableTagHtml = "<table";

    if (element.width !== 1) {
        tableTagHtml += ` data-width="${JSON.stringify(element.width)}"`;
    }

    if (element.columns.some(column => column.width !== 1)) {
        tableTagHtml += ` data-column-widths="${JSON.stringify(
            element.columns.map(column => column.width),
        ).slice(1, -1)}"`;
    }

    tableTagHtml += ">";

    let pendingHtml = tableTagHtml;

    let hasOpenTbody = false;
    let hasOpenThead = false;

    for (let rowIndex = 0; rowIndex < Math.max(1, element.rows.length); rowIndex++) {
        const row = element.rows[rowIndex] ?? {cells: []};

        if (!element.hasHeaderRow) {
            if (rowIndex === 0) {
                pendingHtml += "\n<tbody>";
                hasOpenTbody = true;
            }
        } else {
            if (rowIndex === 0) {
                pendingHtml += "\n<thead>";
                hasOpenThead = true;
            } else if (rowIndex === 1) {
                assert(hasOpenThead);
                pendingHtml += "\n</thead>";
                pendingHtml += "\n<tbody>";
                hasOpenThead = false;
                hasOpenTbody = true;
            }
        }

        pendingHtml += "\n<tr>";

        for (let columnIndex = 0; columnIndex < Math.max(2, row.cells.length); columnIndex++) {
            const cell = row.cells[columnIndex] ?? {elements: []};

            if (element.hasHeaderRow && rowIndex === 0) {
                if (element.hasHeaderColumn && columnIndex !== 0) {
                    // In the case we have both a header column and a header row [then it's
                    // recommended][1] to include the `scope` attribute.
                    //
                    // [1]: https://www.w3.org/WAI/tutorials/tables/two-headers/
                    pendingHtml += '\n<th scope="col">';
                } else {
                    pendingHtml += "\n<th>";
                }
            } else if (columnIndex === 0 && element.hasHeaderColumn) {
                if (element.hasHeaderRow) {
                    // In the case we have both a header column and a header row [then it's
                    // recommended][1] to include the `scope` attribute.
                    //
                    // [1]: https://www.w3.org/WAI/tutorials/tables/two-headers/
                    pendingHtml += '\n<th scope="row">';
                } else {
                    pendingHtml += "\n<th>";
                }
            } else {
                pendingHtml += "\n<td>";
            }

            {
                yield {type: "html", value: pendingHtml};
                pendingHtml = "";

                if (
                    cell.elements.length === 0 ||
                    (cell.elements.length === 1 &&
                        cell.elements[0]!.type === "Paragraph" &&
                        cell.elements[0]!.elements.every(
                            element => element.type === "Text" && element.text.length === 0,
                        ))
                ) {
                    // Noop. We'll be able to parse an empty table cell as containing a single empty
                    // paragraph. We don't need to add `<p></p>` too.
                } else {
                    yield* printApiContentBlockElementsToMarkdown(cell.elements, {
                        ...options,
                        // Hard-break markdown can be ambiguous when nested in raw HTML table cells. For
                        // example, `_\\\n_` parses as italic.
                        forceBreakHtml: true,
                    });
                }
            }

            if (
                (rowIndex === 0 && element.hasHeaderRow) ||
                (columnIndex === 0 && element.hasHeaderColumn)
            ) {
                pendingHtml += "</th>";
            } else {
                pendingHtml += "</td>";
            }
        }

        pendingHtml += "\n</tr>";
    }

    if (hasOpenThead) pendingHtml += "\n</thead>";
    if (hasOpenTbody) pendingHtml += "\n</tbody>";
    pendingHtml += "\n</table>";

    yield {type: "html", value: pendingHtml};
    pendingHtml = "";
}

function printApiContentInlineElementsToMarkdown(
    elements: ReadonlyArray<ApiContentInlineElement>,
    options: ApiContentInternalMarkdownPrinterOptions,
): Array<PhrasingContent> {
    const contents: Array<PhrasingContent> = [];

    // Drop any empty text elements from the end of the inline elements we're printing.
    // We have some "last element" special cases (e.g. if we end with a break we handle
    // that specially) that's broken by empty text at the end of an inline elements
    // array.
    const lastIndexOfNonEmptyTextElement = elements.findLastIndex(
        element => element.type !== "Text" || element.text.length > 0,
    );
    if (lastIndexOfNonEmptyTextElement === -1) {
        elements = [];
    } else {
        elements = elements.slice(0, lastIndexOfNonEmptyTextElement + 1);
    }

    for (let index = 0; index < elements.length; index++) {
        const element = elements[index]!;

        // Ignore empty text elements.
        if (element.type === "Text" && element.text.length === 0) {
            continue;
        }

        if (isPlainBreakBetweenMatchingAttentionMarkers(elements, index, options)) {
            // The parser has compatibility handling for patterns like
            // `text "_" + html + text "_"`, treating them as italic content around the HTML.
            // Empty spans split that sequence while preserving the parsed text and break. See
            // the "HTML table with underscores around a break" test for the regression this
            // catches.
            contents.push(
                {type: "html", value: "<span></span>"},
                {type: "html", value: "<br/>"},
                {type: "html", value: "<span></span>"},
            );
            continue;
        }

        let elementOptions = options;

        // `mdast` struggles to parse breaks at the end of block content. So if this is the
        // last inline element (or all elements afterwards are breaks) then force breaks to
        // be output as HTML (`<br>`).
        if (
            element.type === "Break" &&
            elements.slice(index + 1).every(element => element.type === "Break")
        ) {
            elementOptions = {...elementOptions, forceBreakHtml: true};
        }

        for (const nextContent of printApiContentInlineElementToMarkdown(element, elementOptions)) {
            if (contents.length === 0) {
                contents.push(nextContent);
                continue;
            }

            let lastContent = contents[contents.length - 1]!;

            // Breaks can't be followed by HTML. So if we see a break followed by HTML then
            // replace the break with an HTML equivalent.
            if (
                lastContent.type === "break" &&
                (nextContent.type === "html" ||
                    nextContent.type === "emphasis" ||
                    nextContent.type === "strong" ||
                    nextContent.type === "delete")
            ) {
                lastContent = contents[contents.length - 1] = {type: "html", value: "<br />"};

                for (let i = contents.length - 2; i >= 0; i--) {
                    const lastContent = contents[i]!;
                    if (lastContent.type !== "break") break;
                    contents[i] = {type: "html", value: "<br />"};
                }
            }

            // If we have content that looks like:
            //
            // ```md
            // <mark data-comment="abc">123</mark><mark data-comment="abc">_456_</mark>
            // ```
            //
            // We want to remove the intermediate `</mark><mark data-comment="abc">` HTML. We
            // generate the original content because of how marks are represented on text nodes
            // in our `ApiContent` object.
            if (
                lastContent.type === "html" &&
                nextContent.type === "html" &&
                lastContent.data?.expectedOpenHtml !== undefined &&
                nextContent.data?.expectedCloseHtml !== undefined &&
                lastContent.data.expectedOpenHtml === nextContent.value &&
                nextContent.data.expectedCloseHtml === lastContent.value
            ) {
                // Remove `lastContent`, don't push `nextContent`, simply continue.
                contents.pop();
                continue;
            }

            if (mergePhrasingContent(lastContent, nextContent)) {
                // Merge successful. Don't yield anything.

                if (contents.length >= 2) {
                    const lastLastContent = contents[contents.length - 2]!;

                    // If we have an emphasis node immediately adjacent to a strong node then we want
                    // to use the `_` marker for the emphasis node instead of the `*` marker to avoid
                    // parsing ambiguities. `emphasisMarker` is added in a patch to
                    // `mdast-util-to-markdown`.
                    if (lastLastContent.type === "strong" && lastContent.type === "emphasis") {
                        lastContent.data ??= {};
                        lastContent.data.emphasisMarker = "_";
                    } else if (
                        lastLastContent.type === "emphasis" &&
                        lastContent.type === "strong"
                    ) {
                        lastLastContent.data ??= {};
                        lastLastContent.data.emphasisMarker = "_";
                    }
                }
            } else {
                // If we have an emphasis node immediately adjacent to a strong node then we want
                // to use the `_` marker for the emphasis node instead of the `*` marker to avoid
                // parsing ambiguities. `emphasisMarker` is added in a patch to
                // `mdast-util-to-markdown`.
                if (lastContent.type === "strong" && nextContent.type === "emphasis") {
                    nextContent.data ??= {};
                    nextContent.data.emphasisMarker = "_";
                } else if (lastContent.type === "emphasis" && nextContent.type === "strong") {
                    lastContent.data ??= {};
                    lastContent.data.emphasisMarker = "_";
                }

                contents.push(nextContent);
            }
        }
    }

    return contents;
}

/**
 * Detects a plain break that would be printed between matching Markdown attention
 * markers in a context where breaks must use HTML.
 *
 * For example, a raw HTML table cell containing `_`, a hard break, then `_` would
 * otherwise print escaped underscores around `<br/>`. By parse time, mdast
 * presents that as `text "_" + html + text "_"`. Our parser preserves support for
 * that shape as italic text around HTML, so the printer needs to disambiguate it.
 */
function isPlainBreakBetweenMatchingAttentionMarkers(
    elements: ReadonlyArray<ApiContentInlineElement>,
    index: number,
    options: ApiContentInternalMarkdownPrinterOptions,
): boolean {
    if (!options.forceBreakHtml) return false;

    const element = elements[index];
    if (element?.type !== "Break") return false;
    if (normalizeApiContentInlineElementMarks(element.marks) !== undefined) return false;

    const previousText = findAdjacentNonEmptyText(elements, index, -1);
    const nextText = findAdjacentNonEmptyText(elements, index, 1);
    if (previousText === null || nextText === null) return false;

    const attentionMarkers = ["*", "**", "_", "~~"];
    let previousMarker: string | null = null;
    let nextMarker: string | null = null;

    for (const attentionMarker of attentionMarkers) {
        previousMarker ??= previousText.endsWith(attentionMarker) ? attentionMarker : null;
        nextMarker ??= nextText.startsWith(attentionMarker) ? attentionMarker : null;
    }

    return previousMarker !== null && previousMarker === nextMarker;
}

/**
 * Finds the nearest non-empty text element on one side of an inline element,
 * stopping when any non-text element appears first.
 *
 * Empty text nodes are ignored because the inline printer drops them too, so they
 * cannot prevent neighboring visible text from forming a Markdown marker sequence
 * around a break.
 */
function findAdjacentNonEmptyText(
    elements: ReadonlyArray<ApiContentInlineElement>,
    startIndex: number,
    direction: -1 | 1,
): string | null {
    for (
        let index = startIndex + direction;
        index >= 0 && index < elements.length;
        index += direction
    ) {
        const element = elements[index]!;
        if (element.type !== "Text") return null;
        if (element.text.length > 0) return element.text;
    }

    return null;
}

function mergePhrasingContent(lastContent: PhrasingContent, nextContent: PhrasingContent): boolean {
    if (lastContent.type === "text" && nextContent.type === "text") {
        lastContent.value += nextContent.value;
        return true;
    }

    if (lastContent.type === "inlineCode" && nextContent.type === "inlineCode") {
        lastContent.value += nextContent.value;
        return true;
    }

    if (
        (lastContent.type === "strong" && nextContent.type === "strong") ||
        (lastContent.type === "emphasis" && nextContent.type === "emphasis") ||
        (lastContent.type === "delete" && nextContent.type === "delete")
    ) {
        let canMerge = true;

        for (const childContent of nextContent.children) {
            if (
                canMerge &&
                lastContent.children.length > 0 &&
                mergePhrasingContent(
                    lastContent.children[lastContent.children.length - 1]!,
                    childContent,
                )
            ) {
                // Merge successful. Don't push a new child.
            } else {
                canMerge = false;
                lastContent.children.push(childContent);
            }
        }

        return true;
    }

    // If we have a link that, inside, has the same marks as adjacent text then try
    // merging the link with that adjacent text so we don't close the styles outside
    // the link then open the styles again inside the link.
    {
        if (
            nextContent.type === "link" &&
            nextContent.children.length === 1 &&
            (lastContent.type === "strong" ||
                lastContent.type === "emphasis" ||
                lastContent.type === "delete") &&
            nextContent.children[0]!.type === lastContent.type
        ) {
            const newNextContent = {
                ...nextContent,
                children: nextContent.children[0]!.children,
            };

            if (
                lastContent.children.length === 0 ||
                !mergePhrasingContent(
                    lastContent.children[lastContent.children.length - 1]!,
                    newNextContent,
                )
            ) {
                lastContent.children.push(newNextContent);
            }

            return true;
        }

        if (
            lastContent.type === "link" &&
            lastContent.children.length === 1 &&
            (nextContent.type === "strong" ||
                nextContent.type === "emphasis" ||
                nextContent.type === "delete") &&
            lastContent.children[0]!.type === nextContent.type
        ) {
            const newLastContent = {
                ...lastContent,
                children: lastContent.children[0]!.children,
            };

            if (
                nextContent.children.length === 0 ||
                !mergePhrasingContent(newLastContent, nextContent.children[0]!)
            ) {
                nextContent.children.unshift(newLastContent);
            }

            // We can't just update `nextContent` and return true. When we return true the
            // calling function assumes we've merged into `lastContent`. So to merge into
            // `lastContent` we delete everything in `lastContent` then assign all the
            // properties from `nextContent` into `lastContent`.
            {
                for (const key of Object.keys(lastContent)) {
                    // @ts-expect-error: We're doing something strange that TypeScript doesn't like.
                    delete lastContent[key];
                }

                Object.assign(lastContent, nextContent);
            }

            return true;
        }
    }

    return false;
}

function* printApiContentInlineElementToMarkdown(
    element: ApiContentInlineElement,
    options: ApiContentInternalMarkdownPrinterOptions,
): IterableIterator<PhrasingContent> {
    switch (element.type) {
        case "Text": {
            let hasCodeMark = false;
            let marks: Array<Exclude<ApiContentInlineElementMark, ApiContentCodeMark>> | undefined;

            const actualMarks = normalizeApiContentInlineElementMarks(element.marks);
            if (actualMarks !== undefined) {
                for (const mark of actualMarks) {
                    if (mark.type === "Code") {
                        hasCodeMark = true;
                    } else {
                        marks ??= [];
                        marks.push(mark);
                    }
                }
            }

            if (!hasCodeMark) {
                yield* printApiContentInlineElementMarksToMarkdown(
                    marks,
                    {type: "text", value: element.text},
                    options,
                );
            } else {
                // If we have code inside a link and the link includes `]` then use `<code>` to
                // serialize the link. Since ``[`]:`](http://a.aa)`` is parsed as a definition. Our
                // markdown parser sees "[`]:" and thinks "that's a definition!" without
                // considering that it's in backticks.
                if (marks?.some(mark => mark.type === "Link") && element.text.includes("]")) {
                    const openHtml = "<code>";
                    const closeHtml = "</code>";

                    yield* printApiContentInlineElementMarksToMarkdown(
                        marks,
                        [
                            {type: "html", value: openHtml, data: {expectedCloseHtml: closeHtml}},
                            {type: "text", value: element.text},
                            {type: "html", value: closeHtml, data: {expectedOpenHtml: openHtml}},
                        ],
                        options,
                    );
                } else {
                    yield* printApiContentInlineElementMarksToMarkdown(
                        marks,
                        {type: "inlineCode", value: element.text},
                        options,
                    );
                }
            }
            break;
        }
        case "Break": {
            let hasCodeMark = false;
            let marks: Array<Exclude<ApiContentInlineElementMark, ApiContentCodeMark>> | undefined;

            const actualMarks = normalizeApiContentInlineElementMarks(element.marks);
            if (actualMarks !== undefined) {
                for (const mark of actualMarks) {
                    if (mark.type === "Code") {
                        hasCodeMark = true;
                    } else {
                        marks ??= [];
                        marks.push(mark);
                    }
                }
            }

            if (
                !hasCodeMark &&
                (marks === undefined || marks.length === 0) &&
                !options.forceBreakHtml
            ) {
                yield {type: "break"};
            } else {
                // `mdast` behaves oddly when the `break` node has marks. It can't always perfectly
                // print/parse a break between mark styles. So use HTML instead.
                yield* printApiContentInlineElementMarksToMarkdown(
                    marks,
                    hasCodeMark
                        ? {type: "html", value: "<code><br /></code>"}
                        : {type: "html", value: "<br />"},
                    options,
                );
            }
            break;
        }
        case "Mention": {
            let hasCodeMark = false;
            let linkMark: ApiContentLinkMark | undefined;
            let marks: Array<Exclude<ApiContentInlineElementMark, ApiContentCodeMark>> | undefined;

            const actualMarks = normalizeApiContentInlineElementMarks(element.marks);
            if (actualMarks !== undefined) {
                for (const mark of actualMarks) {
                    if (mark.type === "Code") {
                        hasCodeMark = true;
                    } else if (mark.type === "Link") {
                        linkMark = mark;
                    } else {
                        marks ??= [];
                        marks.push(mark);
                    }
                }
            }

            const childContent: Array<PhrasingContent> = [
                {
                    type: "link",
                    url: printApiMentionReferenceToMentionUrl(element.reference, {
                        isAccountShortName: element.isAccountShortName,
                    }),
                    children: [
                        {
                            type: "text",
                            value: printApiMentionReferenceToMentionLinkLabel(element.reference, {
                                isAccountShortName: element.isAccountShortName,
                            }),
                        },
                    ],
                    data: {mentionElement: element},
                },
            ];

            if (hasCodeMark) {
                const openHtml = "<code>";
                const closeHtml = "</code>";

                childContent.unshift({
                    type: "html",
                    value: openHtml,
                    data: {expectedCloseHtml: closeHtml},
                });

                childContent.push({
                    type: "html",
                    value: closeHtml,
                    data: {expectedOpenHtml: openHtml},
                });
            }

            const contents = printApiContentInlineElementMarksToMarkdown(
                marks,
                childContent,
                options,
            );

            if (!linkMark) {
                yield* contents;
            } else {
                const openHtml = `<a href="${escapeHtml(linkMark.url)}">`;
                const closeHtml = "</a>";

                yield {type: "html", value: openHtml, data: {expectedCloseHtml: closeHtml}};
                yield* contents;
                yield {type: "html", value: closeHtml, data: {expectedOpenHtml: openHtml}};
            }
            break;
        }
        default:
            throw exhaustive(element);
    }
}

export function printApiMentionReferenceToMentionLinkLabel(
    reference: ApiMentionReference,
    {isAccountShortName = false}: {isAccountShortName?: boolean} = {},
): string {
    if (reference.type === "Account" && isAccountShortName && reference.shortName !== undefined) {
        return reference.shortName;
    }

    const title =
        reference.title ??
        (reference.type === "Account"
            ? "Unknown"
            : `Unknown ${getApiMentionReferenceNoun(reference.type)}`);

    return title;
}

export function printApiMentionReferenceToMentionUrl(
    reference: ApiMentionReference,
    {isAccountShortName}: {isAccountShortName: boolean | undefined},
) {
    switch (reference.type) {
        case "Account": {
            return `https://alpine.inc/mention/${reference.id}${isAccountShortName ? "?short" : ""}`;
        }
        case "Channel":
            return `https://alpine.inc/channel/${reference.id}?mention`;
        case "Chat":
            return `https://alpine.inc/chat/${reference.id}?mention`;
        case "Document":
            return `https://alpine.inc/doc/${reference.id}?mention`;
        case "Post":
            return `https://alpine.inc/post/${reference.id}?mention`;
        case "Site":
            // TODO(#sites-api): This differs from the App! The question that we need to answer
            // is: "Should a Site API mention reroute the caller to the first entity in the
            // site?". Probably not
            return `https://alpine.inc/site/${reference.id}?mention`;
        case "Task":
            return `https://alpine.inc/task/${reference.id}?mention`;
        case "TaskCollection":
            return `https://alpine.inc/task-collection/${reference.id}?mention`;
        default:
            throw exhaustive(reference);
    }
}

// TODO: Implement this endpoint to serve the actual file content. The current URL
// points to our app which would render a custom previewer, but `<img>`, `<video>`,
// `<audio>`, and `<object>` tags need the raw file content to work. This should
// serve the file bytes directly (or redirect to a signed URL).
export function printApiFileContentUrl(fileId: string): string {
    return `https://alpine.inc/file/${fileId}/content`;
}

export function printApiPreviewReferenceToPreviewUrl(reference: ApiPreviewReference): string {
    // TODO(#sites): Add Site to PreviewTarget.
    switch (reference.type) {
        case "Channel":
            // TODO: Implement /preview endpoints that generate a PNG or similar image for each
            // previewable entity. Can also serve as OpenGraph images.
            return `https://alpine.inc/channel/${reference.id}/preview`;
        case "Chat":
            return `https://alpine.inc/chat/${reference.id}/preview`;
        case "Document":
            return `https://alpine.inc/doc/${reference.id}/preview`;
        case "Post":
            return `https://alpine.inc/post/${reference.id}/preview`;
        case "Task":
            return `https://alpine.inc/task/${reference.id}/preview`;
        case "TaskCollection":
            return `https://alpine.inc/task-collection/${reference.id}/preview`;
        case "Site":
            return `https://alpine.inc/site/${reference.id}/preview`;
        default:
            throw exhaustive(reference);
    }
}

/**
 * Web safe image content types that can be rendered in an `<img>` tag across all
 * major browsers. Based on MDN's "[Common image file types][1]."
 *
 * Duplicated from `shared/files/file_content_type.ts` to avoid a dependency on
 * `//shared/files` (we intend to open source this package).
 *
 * [1]:
 *     https://developer.mozilla.org/en-US/docs/Web/Media/Formats/Image_types#common_image_file_types
 */
function isWebSafeImageContentType(contentType: string): boolean {
    return (
        contentType === "image/apng" ||
        contentType === "image/avif" ||
        contentType === "image/gif" ||
        contentType === "image/jpeg" ||
        contentType === "image/png" ||
        contentType === "image/svg+xml" ||
        contentType === "image/webp"
    );
}

/**
 * Web safe audio content types that can be rendered in an `<audio>` tag across all
 * major browsers.
 *
 * Duplicated from `shared/files/file_content_type.ts` to avoid a dependency on
 * `//shared/files` (we intend to open source this package).
 *
 * [1]: https://developer.mozilla.org/en-US/docs/Web/HTML/Element/audio
 */
function isWebSafeAudioContentType(contentType: string): boolean {
    return (
        contentType === "audio/mpeg" || contentType === "audio/wav" || contentType === "audio/webm"
    );
}

/**
 * Web safe video content types that can be rendered in a `<video>` tag across all
 * major browsers.
 *
 * Duplicated from `shared/files/file_content_type.ts` to avoid a dependency on
 * `//shared/files` (we intend to open source this package).
 *
 * [1]: https://developer.mozilla.org/en-US/docs/Web/HTML/Element/video
 */
function isWebSafeVideoContentType(contentType: string): boolean {
    return contentType === "video/webm";
}

function* printApiContentInlineElementMarksToMarkdown(
    marks: ReadonlyArray<Exclude<ApiContentInlineElementMark, ApiContentCodeMark>> | undefined,
    content: PhrasingContent | Array<PhrasingContent>,
    options: ApiContentMarkdownPrinterOptions,
): IterableIterator<PhrasingContent> {
    marks = normalizeApiContentInlineElementMarks(marks);

    if (marks === undefined) {
        if (Array.isArray(content)) yield* content;
        else yield content;
        return;
    }

    let mentionishMark: ApiContentLinkMark | undefined;

    for (const mark of marks) {
        if (mark.type !== "Link") continue;

        // Try parsing URL.
        let url: URL;
        try {
            url = new URL(mark.url);
        } catch {
            continue;
        }

        if (
            url?.protocol === "https:" &&
            url.host === "alpine.inc" &&
            (url.searchParams.has("mention") || url.pathname.startsWith("/mention/"))
        ) {
            mentionishMark = mark;
        }
    }

    const markedContent = (
        mentionishMark ? marks.filter(mark => mark !== mentionishMark) : marks
    ).reduceRight(
        wrappedPrintApiContentInlineElementMarkToMarkdown,
        !Array.isArray(content) ? [content] : content,
    );

    if (!mentionishMark) {
        yield* markedContent;
    } else {
        // If the URL looks like a mention then we need to use the HTML `<a>` form to
        // serialize the link. So the Markdown link isn't parsed as a mention.
        const openHtml = `<a href="${escapeHtml(mentionishMark.url)}">`;
        const closeHtml = "</a>";

        yield {type: "html", value: openHtml, data: {expectedCloseHtml: closeHtml}};
        yield* markedContent;
        yield {type: "html", value: closeHtml, data: {expectedOpenHtml: openHtml}};
    }

    function* wrappedPrintApiContentInlineElementMarkToMarkdown(
        content: Iterable<PhrasingContent>,
        mark: Exclude<ApiContentInlineElementMark, ApiContentCodeMark>,
    ): IterableIterator<PhrasingContent> {
        yield* printApiContentInlineElementMarkToMarkdown(content, mark, options);
    }
}

function* printApiContentInlineElementMarkToMarkdown(
    content: Iterable<PhrasingContent>,
    mark: Exclude<ApiContentInlineElementMark, ApiContentCodeMark>,
    options: ApiContentMarkdownPrinterOptions,
): IterableIterator<PhrasingContent> {
    switch (mark.type) {
        case "Bold": {
            const contentArray = !Array.isArray(content) ? Array.from(content) : content;
            yield {type: "strong", children: contentArray};
            break;
        }
        case "Italic": {
            const contentArray = !Array.isArray(content) ? Array.from(content) : content;
            yield {type: "emphasis", children: contentArray};
            break;
        }
        case "Strike": {
            const contentArray = !Array.isArray(content) ? Array.from(content) : content;
            yield {type: "delete", children: contentArray};
            break;
        }
        case "Link": {
            const contentArray = !Array.isArray(content) ? Array.from(content) : content;
            yield {type: "link", url: mark.url, children: contentArray};
            break;
        }
        case "Highlight": {
            const color = printApiContentInlineElementHighlightMarkColor(mark.color);

            const openHtml = `<mark class="highlight-${escapeHtml(color)}">`;
            const closeHtml = `</mark>`;

            yield {type: "html", value: openHtml, data: {expectedCloseHtml: closeHtml}};
            yield* content;
            yield {type: "html", value: closeHtml, data: {expectedOpenHtml: openHtml}};
            break;
        }
        case "Comment": {
            const openHtml = options.withCommentTagHtml
                ? `<comment id="${mark.thread.id}">`
                : `<mark data-comment="${mark.thread.id}">`;
            const closeHtml = options.withCommentTagHtml ? "</comment>" : "</mark>";

            yield {type: "html", value: openHtml, data: {expectedCloseHtml: closeHtml}};
            yield* content;
            yield {type: "html", value: closeHtml, data: {expectedOpenHtml: openHtml}};
            break;
        }
        default:
            throw exhaustive(mark);
    }
}

function printApiContentInlineElementHighlightMarkColor(color: ApiContentHighlightMarkColor) {
    switch (color) {
        case "Red":
            return "red";
        case "Orange":
            return "orange";
        case "Green":
            return "green";
        case "Blue":
            return "blue";
        case "Purple":
            return "purple";
        default:
            throw exhaustive(color);
    }
}

/**
 * If the list has an orderStart of 1, we inject an empty html `span` element into
 * the list content so that something like `1. ` becomes
 * `1. <span data-start="1"></span>` or `1. first item` becomes
 * `1. <span data-start="1"></span>first item`.
 *
 * This ensures that we maintain the orderStart value from the original content and
 * can parse it back into the exact same content later. See the note below for more
 * details.
 *
 * **Importantly**, we only need to play this game when `orderStart = 1`. Markdown
 * will parse the following content:
 *
 * ```
 * doc(
 *   orderedListItem(null, [paragraph("first item")])
 *   orderedListItem(null, [paragraph("second item")])
 *   orderedListItem({orderStart: 5}, [paragraph("skip to 5")])
 * )
 * ```
 *
 * into the following markdown content:
 *
 * ```markdown
 * 1. first item
 * 2. second item
 *
 * 5) skip to 5
 * ```
 *
 * So when we parse that markdown back, we know that the list "resets" to 5 at the
 * third item because of the change in punctuation.
 */
// NOTE(ifitzsimmons, 2026-01-06): Our public API should maintain symmetry such
// that all content printed into Markdown should be able to be parsed back into the
// exact same content.
//
// If an ordered list has an explicit order start of `1`, we inject a span with the
// data-start attribute into the first item in the list. This is necessary in order
// to avoid lossiness when going from Prosemirror -> ApiContent -> Markdown ->
// ApiContent -> Prosemirror.
//
// For example, if we have the following list in prosemirror:
//
// ```
// doc(
//   orderedListItem({orderStart: 1}, [paragraph("first item")])
//   orderedListItem(null, [paragraph("second item")])
// )
// ```
//
// Should be printed as the following markdown:
//
// ```markdown
// 1. first item
// 2. second item
// ```
//
// However, when we parse this markdown back into Prosemirror (via ApiContent), how
// do we know that the ordered list must ALWAYS start with 1?
//
// What happens if the user changes that list to the following:
//
// ```markdown
// 1. new first item
// 1. first item
// 1. second item
// ```
//
// Well, the order start will be lost and this will get stored as
//
// ```
// doc(
//   orderedListItem(null, [paragraph("new first item")])
//   orderedListItem(null, [paragraph("first item")]) <------ WE LOST THE `orderStart`!!
//   orderedListItem(null, [paragraph("second item")])
// )
// ```
//
// We address this by injecting an empty html `span` element with the data-start
// attribute and look for it when parsing the content back from markdown
function addOrderedStartSpanToFirstItemInOrderedListIfNeeded(listContent: List): void {
    // If this is not an ordered list, or the order start is not 1, never add the span
    if (
        !listContent.ordered ||
        listContent.start === undefined ||
        listContent.start === null ||
        listContent.start !== 1
    ) {
        return;
    }

    const firstListItem = listContent.children[0];
    // It should be impossible to have a list element without any items -- they're only
    // created when we see a list item.
    assert(firstListItem, "Ordered list must have at least one item");

    const firstListItemContentElement = firstListItem.children[0];

    if (firstListItemContentElement?.type !== "paragraph") {
        // If the list item has no content or the first content element in the list item is
        // not a paragraph, then inject the span as the first element in the list item
        // content
        insertSpanIntoContent(firstListItem);
    } else {
        // Otherwise, inject the span in the first "paragraph" of the list item.
        insertSpanIntoContent(firstListItemContentElement);
    }

    function insertSpanIntoContent(content: ListItem | Paragraph) {
        content.children.unshift({
            type: "html",
            value: `<span data-start=\u201D${listContent.start}\u201D></span>`,
        });
    }
}
