import escapeHtml from "escape-html";
import {
    BlockContent,
    List,
    ListItem,
    Paragraph,
    PhrasingContent,
    Root,
    TableCell,
    TableRow,
} from "mdast";
import {frontmatterToMarkdown} from "mdast-util-frontmatter";
import {gfmStrikethroughToMarkdown} from "mdast-util-gfm-strikethrough";
import {gfmTableToMarkdown} from "mdast-util-gfm-table";
import {gfmTaskListItemToMarkdown} from "mdast-util-gfm-task-list-item";
import {mathToMarkdown} from "mdast-util-math";
import {toMarkdown} from "mdast-util-to-markdown";
import {assertApiChecklistBlockElementItem} from "~/server/api/markdown/assert_api_checklist_block_element_item.js";
import {getApiMentionTargetNoun} from "~/server/api/markdown/get_api_mention_target_noun.js";
import {normalizeApiContentInlineElementMarks} from "~/server/api/markdown/normalize_api_content.js";
import {ApiNotMentionPathObject} from "~/shared/api/parse_api_path.js";
import {
    ApiContent,
    ApiContentBlockElement,
    ApiContentCodeBlockElement,
    ApiContentCodeBlockElementTextInlineElementMark,
    ApiContentInlineElement,
    ApiContentInlineElementCodeMark,
    ApiContentInlineElementHighlightMarkColor,
    ApiContentInlineElementLinkMark,
    ApiContentInlineElementMark,
    ApiContentMentionInlineElement,
    ApiContentParagraphBlockElement,
    ApiContentTableBlockElement,
    ApiMentionTarget,
} from "~/shared/api/types/api_specification_convenience_types.js";
import {emptyArray} from "~/shared/helpers/array/empty_array.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {isDeepEqual} from "~/shared/helpers/control/is_deep_equal.js";
import {concatIterables} from "~/shared/helpers/iterable/concat_iterables.js";
import {generateId} from "~/shared/id/id.js";
import {SpaceId} from "~/shared/id/types/id_types.js";

declare module "mdast" {
    export interface EmphasisData {
        // NOTE(calebmer): We have a patch for `mdast-util-to-markdown` that checks this
        // property and uses it when printing emphasis nodes.
        emphasisMarker?: "*" | "_";
    }

    export interface LinkData {
        mentionElement?: ApiContentMentionInlineElement;
    }

    export interface HtmlData {
        expectedOpenHtml?: string;
        expectedCloseHtml?: string;
    }
}

export type ApiContentMarkdownPrinterOptions = {
    /**
     * The `SpaceId` of the content we're printing. The `SpaceId` is added to generated
     * mention links.
     */
    readonly spaceId: SpaceId;

    /**
     * If `true` then we don't add the `data-width` and `data-column-widths` attributes
     * to tables.
     */
    readonly withoutTableWidth?: boolean;

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
     * <comment>commented text</comment>
     * ```
     */
    readonly withSimpleCommentMarkHtml?: boolean;
};

export {actuallyPrintApiContentToMarkdown as printApiContentToMarkdown};
export {printApiContentToMarkdown as printApiContentToMarkdownTree};

function actuallyPrintApiContentToMarkdown(
    content: ApiContent,
    options: ApiContentMarkdownPrinterOptions,
): string {
    const root = printApiContentToMarkdown(content, options);
    return printMarkdownTree(root);
}

export function printMarkdownTree(root: Root): string {
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
            mathToMarkdown(),
            // NOTE(calebmer, 2025-09-02): We don't currently support frontmatter in our
            // Markdown but we want to reserve the syntax so we have the ability to use
            // frontmatter in the future.
            frontmatterToMarkdown("yaml"),
        ],
    });
}

function printApiContentToMarkdown(
    content: ApiContent,
    options: ApiContentMarkdownPrinterOptions,
): Root {
    return {
        type: "root",
        children:
            // If the first element in our content is a divider then we serialize it using the
            // HTML syntax `<hr/>` so the divider isn't confused with frontmatter.
            content.elements.length > 0 && content.elements[0]!.type === "Divider"
                ? Array.from(
                      concatIterables(
                          [{type: "html", value: "<hr/>"}],
                          printApiContentBlockElementsToMarkdown(
                              content.elements.slice(1),
                              options,
                          ),
                      ),
                  )
                : Array.from(printApiContentBlockElementsToMarkdown(content.elements, options)),
    };
}

function* printApiContentBlockElementsToMarkdown(
    elements: ReadonlyArray<ApiContentBlockElement>,
    options: ApiContentMarkdownPrinterOptions,
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
    options: ApiContentMarkdownPrinterOptions,
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
                children: element.items.map(item => {
                    const children = Array.from(
                        concatIterables(
                            printApiContentBlockElementsToMarkdown(
                                // NOTE(ifitzsimmons, 2025-12-29): We only allow UnorderedList to create phantom
                                // lists. `CheckList` and `OrderedList` can't support phantom lists in the same
                                // way.
                                //
                                // So while unordered phantom lists look like:
                                //
                                // ```markdown
                                // -   -   - item at 3rd level in a phantom unordered list
                                // ```
                                //
                                // Checklists and ordered phantom lists get an empty paragraph and look like:
                                //
                                // ```markdown
                                // 1. <p></p>
                                //
                                // - Mixed types with phantoms
                                //
                                // OR
                                //
                                // [ ] <p></p>
                                //
                                // - Mixed types with phantoms
                                // ```
                                item.elements.length > 0 || element.type === "UnorderedList"
                                    ? item.elements
                                    : [{type: "Paragraph", elements: []}],
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

    // The HTML specification itself recommends `class="language-*"` as a way to
    // signal the language we're using:
    // https://html.spec.whatwg.org/multipage/text-level-semantics.html#the-code-element
    //
    // eslint-disable-next-line cyberworlds/string-quotes
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
                        html += options.withSimpleCommentMarkHtml ? "</comment>" : "</mark>";
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
                        // eslint-disable-next-line cyberworlds/string-quotes
                        html += `<a href="${escapeHtml(mark.url)}">`;
                        break;
                    }
                    case "Highlight": {
                        const color = printApiContentInlineElementHighlightMarkColor(mark.color);
                        // eslint-disable-next-line cyberworlds/string-quotes
                        html += `<mark class="highlight-${color}">`;
                        break;
                    }
                    case "Comment": {
                        html += options.withSimpleCommentMarkHtml
                            ? "<comment>"
                            : // eslint-disable-next-line cyberworlds/string-quotes
                              `<mark data-comment="${mark.threadId}">`;
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
                    html += options.withSimpleCommentMarkHtml ? "</comment>" : "</mark>";
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

    return (
        printSimpleApiContentTableBlockElementToMarkdownIfPossible(element, {
            spaceId: generateId(),
        }) !== null
    );
}

function printSimpleApiContentTableBlockElementToMarkdownIfPossible(
    element: ApiContentTableBlockElement,
    options: ApiContentMarkdownPrinterOptions,
): BlockContent | null {
    // Simple GFM tables must have a header row.
    if (!element.hasHeaderRow) return null;

    // Simple GFM tables don't support a header column.
    if (element.hasHeaderColumn) return null;

    const rows: Array<TableRow> = [];

    for (let rowIndex = 0; rowIndex < Math.max(1, element.rows.length); rowIndex++) {
        const row = element.rows[rowIndex] ?? {cells: []};

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

    // Add a `<span>` to the last cell of the table with information about the table's
    // width and the table's column widths. This is needed for reconstructing the input
    // content but unfortunately is not very aesthetic.
    if (
        !options.withoutTableWidth &&
        (element.width !== 1 || element.columns.some(column => column.width !== 1))
    ) {
        /* eslint-disable cyberworlds/string-quotes */

        let html = "<span hidden";

        if (element.width !== 1) {
            html += ` data-width="${escapeHtml(JSON.stringify(element.width))}"`;
        }

        if (element.columns.some(column => column.width !== 1)) {
            html += ` data-column-widths="${escapeHtml(
                JSON.stringify(element.columns.map(column => column.width)).slice(1, -1),
            )}"`;
        }

        html += "/>";

        /* eslint-enable cyberworlds/string-quotes */

        const lastRow = rows[rows.length - 1];
        if (lastRow !== undefined) {
            const lastCell = lastRow.children[lastRow.children.length - 1];
            if (lastCell !== undefined) {
                lastCell.children.push({type: "html", value: html});
            }
        }
    }

    return {
        type: "table",
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

    /* eslint-disable cyberworlds/string-quotes */

    if (!options.withoutTableWidth) {
        if (element.width !== 1) {
            tableTagHtml += ` data-width="${JSON.stringify(element.width)}"`;
        }

        if (element.columns.some(column => column.width !== 1)) {
            tableTagHtml += ` data-column-widths="${JSON.stringify(
                element.columns.map(column => column.width),
            ).slice(1, -1)}"`;
        }
    }

    /* eslint-enable cyberworlds/string-quotes */

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
                yield* printApiContentBlockElementsToMarkdown(cell.elements, options);
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
    options: ApiContentMarkdownPrinterOptions & {forceBreakHtml?: boolean},
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

        let elementOptions = options;

        // `mdast` struggles to parse breaks at the end of block content. So if this is the
        // last inline element (or all elements afterwards are breaks) then force breaks to
        // be output as HTML (`<br/>`).
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
                lastContent = contents[contents.length - 1] = {type: "html", value: "<br/>"};

                for (let i = contents.length - 2; i >= 0; i--) {
                    const lastContent = contents[i]!;
                    if (lastContent.type !== "break") break;
                    contents[i] = {type: "html", value: "<br/>"};
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
    options: ApiContentMarkdownPrinterOptions & {forceBreakHtml?: boolean},
): IterableIterator<PhrasingContent> {
    switch (element.type) {
        case "Text": {
            let hasCodeMark = false;
            let marks:
                | Array<Exclude<ApiContentInlineElementMark, ApiContentInlineElementCodeMark>>
                | undefined;

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
            let marks:
                | Array<Exclude<ApiContentInlineElementMark, ApiContentInlineElementCodeMark>>
                | undefined;

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
                        ? {type: "html", value: "<code><br/></code>"}
                        : {type: "html", value: "<br/>"},
                    options,
                );
            }
            break;
        }
        case "Mention": {
            let hasCodeMark = false;
            let linkMark: ApiContentInlineElementLinkMark | undefined;
            let marks:
                | Array<Exclude<ApiContentInlineElementMark, ApiContentInlineElementCodeMark>>
                | undefined;

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

            const mentionTarget = element.target;

            const title =
                element.title ??
                (mentionTarget.type === "Account"
                    ? "Unknown"
                    : `Unknown ${getApiMentionTargetNoun(mentionTarget.type)}`);

            const targetUrl = printApiMentionPathToMentionLinkUrl(mentionTarget, {
                spaceId: options.spaceId,
                isAccountShortName: element.isAccountShortName,
            });

            const childContent: Array<PhrasingContent> = [
                {
                    type: "link",
                    url: targetUrl,
                    children: [{type: "text", value: title}],
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
                // eslint-disable-next-line cyberworlds/string-quotes
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

export function printApiMentionPathToMentionLinkUrl(
    target: ApiMentionTarget,
    {spaceId, isAccountShortName}: {spaceId: SpaceId; isAccountShortName: boolean | undefined},
) {
    switch (target.type) {
        case "Account": {
            return `https://alpine.inc/s/${spaceId}/accounts/${target.id}?mention${
                isAccountShortName ? "=short" : ""
            }`;
        }
        case "Channel":
            return `https://alpine.inc/s/${spaceId}/channels/${target.id}?mention`;
        case "Chat":
            return `https://alpine.inc/s/${spaceId}/chats/${target.id}?mention`;
        case "Document":
            return `https://alpine.inc/s/${spaceId}/documents/${target.id}?mention`;
        case "Post":
            return `https://alpine.inc/s/${spaceId}/posts/${target.id}?mention`;
        case "Task":
            return `https://alpine.inc/s/${spaceId}/tasks/${target.id}?mention`;
        case "TaskCollection":
            return `https://alpine.inc/s/${spaceId}/tasks/collections/${target.id}?mention`;
        default:
            throw exhaustive(target);
    }
}

export function printAppUrlFromApiNotMentionPath(
    targetPathObject: ApiNotMentionPathObject,
    {spaceId}: {spaceId: SpaceId},
): string {
    switch (targetPathObject.type) {
        case "ChatMessages":
            return `https://alpine.inc/s/${spaceId}/chats/${targetPathObject.id}`;
        case "ChatMessage":
            return `https://alpine.inc/s/${spaceId}/chats/${targetPathObject.id}?message=${targetPathObject.index}`;
        case "DocumentComment":
            return `https://alpine.inc/s/${spaceId}/documents/${targetPathObject.id}?comments=${targetPathObject.threadId}&comment=${targetPathObject.index}`;
        case "DocumentCommentThread":
        case "DocumentCommentThreadComments":
            return `https://alpine.inc/s/${spaceId}/documents/${targetPathObject.id}?comments=${targetPathObject.threadId}`;
        case "PostComment":
            return `https://alpine.inc/s/${spaceId}/posts/${targetPathObject.id}?comment=${targetPathObject.index}`;
        case "PostComments":
            // Redirect to the post itself. This is mentionable.
            return `https://alpine.inc/s/${spaceId}/posts/${targetPathObject.id}?mention`;
        case "TaskComment":
            return `https://alpine.inc/s/${spaceId}/tasks/${targetPathObject.id}?comment=${targetPathObject.index}`;
        case "TaskComments":
            return `https://alpine.inc/s/${spaceId}/tasks/${targetPathObject.id}?comments=show`;
        default:
            throw exhaustive(targetPathObject);
    }
}

function* printApiContentInlineElementMarksToMarkdown(
    marks:
        | ReadonlyArray<Exclude<ApiContentInlineElementMark, ApiContentInlineElementCodeMark>>
        | undefined,
    content: PhrasingContent | Array<PhrasingContent>,
    options: ApiContentMarkdownPrinterOptions,
): IterableIterator<PhrasingContent> {
    marks = normalizeApiContentInlineElementMarks(marks);

    if (marks === undefined) {
        if (Array.isArray(content)) yield* content;
        else yield content;
        return;
    }

    let mentionishMark: ApiContentInlineElementLinkMark | undefined;

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
            url.pathname.startsWith(`/s/${options.spaceId}/`) &&
            url.searchParams.has("mention")
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
        //
        // eslint-disable-next-line cyberworlds/string-quotes
        const openHtml = `<a href="${escapeHtml(mentionishMark.url)}">`;
        const closeHtml = "</a>";

        yield {type: "html", value: openHtml, data: {expectedCloseHtml: closeHtml}};
        yield* markedContent;
        yield {type: "html", value: closeHtml, data: {expectedOpenHtml: openHtml}};
    }

    function* wrappedPrintApiContentInlineElementMarkToMarkdown(
        content: Iterable<PhrasingContent>,
        mark: Exclude<ApiContentInlineElementMark, ApiContentInlineElementCodeMark>,
    ): IterableIterator<PhrasingContent> {
        yield* printApiContentInlineElementMarkToMarkdown(content, mark, options);
    }
}

function* printApiContentInlineElementMarkToMarkdown(
    content: Iterable<PhrasingContent>,
    mark: Exclude<ApiContentInlineElementMark, ApiContentInlineElementCodeMark>,
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

            // eslint-disable-next-line cyberworlds/string-quotes
            const openHtml = `<mark class="highlight-${escapeHtml(color)}">`;
            const closeHtml = `</mark>`;

            yield {type: "html", value: openHtml, data: {expectedCloseHtml: closeHtml}};
            yield* content;
            yield {type: "html", value: closeHtml, data: {expectedOpenHtml: openHtml}};
            break;
        }
        case "Comment": {
            const openHtml = options.withSimpleCommentMarkHtml
                ? "<comment>"
                : // eslint-disable-next-line cyberworlds/string-quotes
                  `<mark data-comment="${mark.threadId}">`;
            const closeHtml = options.withSimpleCommentMarkHtml ? "</comment>" : "</mark>";

            yield {type: "html", value: openHtml, data: {expectedCloseHtml: closeHtml}};
            yield* content;
            yield {type: "html", value: closeHtml, data: {expectedOpenHtml: openHtml}};
            break;
        }
        default:
            throw exhaustive(mark);
    }
}

function printApiContentInlineElementHighlightMarkColor(
    color: ApiContentInlineElementHighlightMarkColor,
) {
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
 * `1. <span data-start="1"/>` or `1. first item` becomes
 * `1. <span data-start="1"/>first item`.
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
            value: `<span data-start=\u201D${listContent.start}\u201D/>`,
        });
    }
}
