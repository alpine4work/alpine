import escapeHtml from "escape-html";
import {BlockContent, PhrasingContent, Root, TableCell, TableRow} from "mdast";
import {frontmatterToMarkdown} from "mdast-util-frontmatter";
import {gfmStrikethroughToMarkdown} from "mdast-util-gfm-strikethrough";
import {gfmTableToMarkdown} from "mdast-util-gfm-table";
import {gfmTaskListItemToMarkdown} from "mdast-util-gfm-task-list-item";
import {mathToMarkdown} from "mdast-util-math";
import {toMarkdown} from "mdast-util-to-markdown";
import {getApiContentMentionInlineElementTargetPathNoun} from "~/server/api/markdown/get_api_content_mention_inline_element_target_path_type_noun.js";
import {normalizeApiContentInlineElementMarks} from "~/server/api/markdown/normalize_api_content.js";
import {
    ApiContentMentionInlineElementTargetPathObject,
    parseApiContentMentionInlineElementTargetPath,
} from "~/server/api/specification/parse_api_path.js";
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
    ApiContentParagraphBlockElement,
    ApiContentTableBlockElement,
} from "~/server/api/specification/types/api_specification_convenience_types.js";
import {emptyArray} from "~/shared/helpers/array/empty_array.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {isDeepEqual} from "~/shared/helpers/control/is_deep_equal.js";
import {concatIterables} from "~/shared/helpers/iterable/concat_iterables.js";
import {generateId} from "~/shared/id/id.js";
import {SpaceId} from "~/shared/id/types/id_types.js";

declare module "mdast" {
    export interface EmphasisData {
        // NOTE(calebmer): We have a patch for `mdast-util-to-markdown` that checks
        // this property and uses it when printing emphasis nodes.
        emphasisMarker?: "*" | "_";
    }
}

export type ApiContentMarkdownPrinterOptions = {
    /**
     * The `SpaceId` of the content we're printing. The `SpaceId` is added to
     * generated mention links.
     */
    readonly spaceId: SpaceId;

    /**
     * If `true` then we don't add the `data-width` and `data-column-widths`
     * attributes to tables.
     */
    readonly withoutTableWidth?: boolean;
};

export {actuallyPrintApiContentToMarkdown as printApiContentToMarkdown};

function actuallyPrintApiContentToMarkdown(
    content: ApiContent,
    options: ApiContentMarkdownPrinterOptions,
): string {
    const root = printApiContentToMarkdown(content, options);

    return toMarkdown(root, {
        bullet: "-",
        rule: "-",
        extensions: [
            gfmStrikethroughToMarkdown(),
            // Disable `tablePipeAlign` since we can have arbitrarily long content in
            // tables. We don't want to add a ton of spaces and dashes for one really long
            // cell. The Markdown we print is optimized for machine (AI or API) readability
            // not human readability. Extra spaces aren't useful for machines, only humans.
            //
            // If you want human readable Markdown run Prettier on the Markdown output.
            gfmTableToMarkdown({tablePipeAlign: false}),
            gfmTaskListItemToMarkdown(),
            // NOTE(calebmer, 2025-08-08): We don't currently support math symbols in
            // content but we might want to support math in the future. So make sure we
            // escape `$` and `$$` to reserve them.
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
            // If the first element in our content is a divider then we serialize it using
            // the HTML syntax `<hr/>` so the divider isn't confused with frontmatter.
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
                pendingContent.ordered === content.ordered
            ) {
                for (const childContent of content.children)
                    pendingContent.children.push(childContent);
                continue;
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
        case "OrderedList": {
            if (element.items.length === 0) break;

            yield {
                type: "list",
                ordered: element.type === "OrderedList",
                children: element.items.map(item => {
                    return {
                        type: "listItem",
                        children: Array.from(
                            concatIterables(
                                printApiContentBlockElementsToMarkdown(item.elements, options),
                                item.nestedListElements
                                    ? printApiContentBlockElementsToMarkdown(
                                          item.nestedListElements,
                                          options,
                                      )
                                    : emptyArray,
                            ),
                        ),
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
            yield printApiContentCodeBlockElementToMarkdown(element);
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
    // eslint-disable-next-line string-quotes
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
                    case "Comment":
                        html += "</mark>";
                        break;
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
                        // eslint-disable-next-line string-quotes
                        html += `<a href="${escapeHtml(mark.url)}">`;
                        break;
                    }
                    case "Highlight": {
                        const color = printApiContentInlineElementHighlightMarkColor(mark.color);
                        // eslint-disable-next-line string-quotes
                        html += `<mark class="highlight-${color}">`;
                        break;
                    }
                    case "Comment": {
                        // eslint-disable-next-line string-quotes
                        html += `<mark data-comment="${mark.threadId}">`;
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
                case "Comment":
                    html += "</mark>";
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

            // For some reason the text `\|` in inline code breaks GFM table parsing. I
            // haven't investigated why specifically this breaks GFM table parsing but our
            // generative test has produced a test showing it does.
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
                              // Can't have a line break character within a table cell. So use HTML syntax
                              // for breaks.
                              forceBreakHtml: true,
                          })
                        : [],
            });
        }
    }

    // Add a `<span>` to the last cell of the table with information about the
    // table's width and the table's column widths. This is needed for
    // reconstructing the input content but unfortunately is not very aesthetic.
    if (
        !options.withoutTableWidth &&
        (element.width !== 1 || element.columns.some(column => column.width !== 1))
    ) {
        /* eslint-disable string-quotes */

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

        /* eslint-enable string-quotes */

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

    /* eslint-disable string-quotes */

    if (element.width !== 1) {
        tableTagHtml += ` data-width="${JSON.stringify(element.width)}"`;
    }

    if (element.columns.some(column => column.width !== 1)) {
        tableTagHtml += ` data-column-widths="${JSON.stringify(
            element.columns.map(column => column.width),
        ).slice(1, -1)}"`;
    }

    /* eslint-enable string-quotes */

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
                    //
                    // eslint-disable-next-line string-quotes
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
                    //
                    // eslint-disable-next-line string-quotes
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
                // Noop. We'll be able to parse an empty table cell as containing a single
                // empty paragraph. We don't need to add `<p></p>` too.
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

    // Drop any empty text elements from the end of the inline elements we're
    // printing. We have some "last element" special cases (e.g. if we end with a
    // break we handle that specially) that's broken by empty text at the end of an
    // inline elements array.
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

        // `mdast` struggles to parse breaks at the end of block content. So if this
        // is the last inline element (or all elements afterwards are breaks) then
        // force breaks to be output as HTML (`<br/>`).
        if (
            element.type === "Break" &&
            elements.slice(index + 1).every(element => element.type === "Break")
        ) {
            elementOptions = {...elementOptions, forceBreakHtml: true};
        }

        for (const nextContent of printApiContentInlineElementToMarkdown(element, elementOptions)) {
            if (contents.length === 0) {
                contents.push(nextContent);
            } else {
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

                if (mergePhrasingContent(lastContent, nextContent)) {
                    // Merge successful. Don't yield anything.

                    if (contents.length >= 2) {
                        const lastLastContent = contents[contents.length - 2]!;

                        // If we have an emphasis node immediately adjacent to a strong node then we
                        // want to use the `_` marker for the emphasis node instead of the `*` marker
                        // to avoid parsing ambiguities. `emphasisMarker` is added in a patch to
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
                    // If we have an emphasis node immediately adjacent to a strong node then we
                    // want to use the `_` marker for the emphasis node instead of the `*` marker
                    // to avoid parsing ambiguities. `emphasisMarker` is added in a patch to
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
    // merging the link with that adjacent text so we don't close the styles
    // outside the link then open the styles again inside the link.
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
                // serialize the link. Since ``[`]:`](http://a.aa)`` is parsed as a definition.
                // Our markdown parser sees "[`]:" and thinks "that's a definition!" without
                // considering that it's in backticks.
                if (marks?.some(mark => mark.type === "Link") && element.text.includes("]")) {
                    yield* printApiContentInlineElementMarksToMarkdown(
                        marks,
                        [
                            {type: "html", value: "<code>"},
                            {type: "text", value: element.text},
                            {type: "html", value: "</code>"},
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
                // `mdast` behaves oddly when the `break` node has marks. It can't always
                // perfectly print/parse a break between mark styles. So use HTML instead.
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

            const targetPathObject = parseApiContentMentionInlineElementTargetPath(
                element.targetPath,
            );

            const title =
                element.title ??
                (targetPathObject.type === "Account"
                    ? "Unknown"
                    : `Unknown ${getApiContentMentionInlineElementTargetPathNoun(
                          targetPathObject.type,
                      )}`);

            const targetUrl = printApiContentMentionInlineElementTargetPathToMentionLinkUrl(
                targetPathObject,
                {spaceId: options.spaceId, isAccountShortName: element.isAccountShortName},
            );

            const childContent: Array<PhrasingContent> = [
                {
                    type: "link",
                    url: targetUrl,
                    children: [{type: "text", value: title}],
                },
            ];

            if (hasCodeMark) {
                childContent.unshift({type: "html", value: "<code>"});
                childContent.push({type: "html", value: "</code>"});
            }

            if (linkMark) {
                // eslint-disable-next-line string-quotes
                yield {type: "html", value: `<a href="${escapeHtml(linkMark.url)}">`};
            }

            yield* printApiContentInlineElementMarksToMarkdown(marks, childContent, options);

            if (linkMark) {
                yield {type: "html", value: "</a>"};
            }
            break;
        }
        default:
            throw exhaustive(element);
    }
}

export function printApiContentMentionInlineElementTargetPathToMentionLinkUrl(
    targetPathObject: ApiContentMentionInlineElementTargetPathObject,
    {spaceId, isAccountShortName}: {spaceId: SpaceId; isAccountShortName: boolean | undefined},
) {
    switch (targetPathObject.type) {
        case "Account": {
            return `https://alpine.inc/s/${spaceId}/accounts/${targetPathObject.accountId}?mention${
                isAccountShortName ? "=short" : ""
            }`;
        }
        case "Channel":
            return `https://alpine.inc/s/${spaceId}/channels/${targetPathObject.channelId}?mention`;
        case "Document":
            return `https://alpine.inc/s/${spaceId}/documents/${targetPathObject.documentId}?mention`;
        case "Post":
            return `https://alpine.inc/s/${spaceId}/posts/${targetPathObject.postId}?mention`;
        case "Task":
            return `https://alpine.inc/s/${spaceId}/tasks/${targetPathObject.taskId}?mention`;
        case "TaskCollection":
            return `https://alpine.inc/s/${spaceId}/tasks/collections/${targetPathObject.collectionId}?mention`;
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
        printApiContentInlineElementMarkToMarkdown,
        !Array.isArray(content) ? [content] : content,
    );

    // If the URL looks like a mention then we need to use the HTML `<a>` form to
    // serialize the link. So the Markdown link isn't parsed as a mention.
    //
    // eslint-disable-next-line string-quotes
    if (mentionishMark) yield {type: "html", value: `<a href="${escapeHtml(mentionishMark.url)}">`};

    yield* markedContent;

    if (mentionishMark) yield {type: "html", value: `</a>`};
}

function* printApiContentInlineElementMarkToMarkdown(
    content: Iterable<PhrasingContent>,
    mark: Exclude<ApiContentInlineElementMark, ApiContentInlineElementCodeMark>,
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
            // eslint-disable-next-line string-quotes
            yield {type: "html", value: `<mark class="highlight-${escapeHtml(color)}">`};
            yield* content;
            yield {type: "html", value: `</mark>`};
            break;
        }
        case "Comment": {
            // eslint-disable-next-line string-quotes
            yield {type: "html", value: `<mark data-comment="${escapeHtml(mark.threadId)}">`};
            yield* content;
            yield {type: "html", value: `</mark>`};
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
