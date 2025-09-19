import {Draft, castDraft, produce} from "immer";
import {
    ApiContent,
    ApiContentBlockElement,
    ApiContentInlineElement,
    ApiContentInlineElementMark,
} from "~/server/api/specification/types/api_specification_convenience_types.js";
import {cast} from "~/shared/helpers/control/cast.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {isDeepEqual} from "~/shared/helpers/control/is_deep_equal.js";
import {hasOwnProperty} from "~/shared/helpers/object/has_own_property.js";
import {defaultCompareStrings} from "~/shared/helpers/string/default_compare_strings.js";

/**
 * If two `ApiContent` objects normalize to the same object (based on an
 * `isDeepEqual()` check) then the two `ApiContent`s are considered to be
 * equivalent.
 */
export function normalizeApiContent(content: ApiContent): ApiContent {
    return produce(content, content => {
        normalizeApiContentBlockElements(content.elements);
    });
}

function normalizeApiContentBlockElements(elements: Draft<ReadonlyArray<ApiContentBlockElement>>) {
    let index = 0;
    while (index < elements.length) {
        const element = elements[index]!;

        // Remove empty unordered and ordered lists.
        if (
            (element.type === "UnorderedList" || element.type === "OrderedList") &&
            element.items.length === 0
        ) {
            elements.splice(index, 1);
            continue;
        }

        // Merge adjacent lists of the same type.
        if (element.type === "UnorderedList" || element.type === "OrderedList") {
            while (index < elements.length - 1) {
                const nextElement = elements[index + 1]!;

                if (nextElement.type !== "UnorderedList" && nextElement.type !== "OrderedList") {
                    break;
                }

                // Remove empty unordered and ordered lists in between lists of the same type
                // we want to merge.
                if (nextElement.items.length === 0) {
                    elements.splice(index + 1, 1);
                    continue;
                }

                if (element.type !== nextElement.type) {
                    break;
                }

                for (const item of nextElement.items) {
                    element.items.push(item);
                }

                elements.splice(index + 1, 1);
            }
        }

        normalizeApiContentBlockElement(element);
        index++;
    }
}

function normalizeApiContentBlockElement(element: Draft<ApiContentBlockElement>) {
    switch (element.type) {
        case "Paragraph": {
            normalizeApiContentInlineElements(element.elements);
            break;
        }
        case "UnorderedList":
        case "OrderedList": {
            for (const item of element.items) {
                normalizeApiContentBlockElements(item.elements);

                if (item.nestedListElements !== undefined) {
                    normalizeApiContentBlockElements(item.nestedListElements);

                    if (item.nestedListElements.length === 0) {
                        item.nestedListElements = undefined;
                    }
                }
            }
            break;
        }
        case "Quote": {
            normalizeApiContentBlockElements(element.elements);
            break;
        }
        case "Heading": {
            normalizeApiContentInlineElements(element.elements);
            break;
        }
        case "Divider": {
            // Already normalized.
            break;
        }
        case "Code": {
            if (element.lines.length === 0) {
                element.lines.push({elements: []});
            } else {
                for (const line of element.lines) {
                    normalizeApiContentInlineElements(line.elements);
                }
            }
            break;
        }
        case "Table": {
            if (element.hasHeaderRow === false) element.hasHeaderRow = undefined;
            if (element.hasHeaderColumn === false) element.hasHeaderColumn = undefined;

            if (element.rows.length === 0) {
                element.rows.push({cells: []});
            }

            let columnCount = 0;

            for (const row of element.rows) {
                while (row.cells.length < 2) {
                    row.cells.push({elements: []});
                }

                columnCount = Math.max(columnCount, row.cells.length);

                for (const cell of row.cells) {
                    normalizeApiContentBlockElements(cell.elements);

                    if (
                        cell.elements.length === 1 &&
                        cell.elements[0]!.type === "Paragraph" &&
                        cell.elements[0]!.elements.length === 0
                    ) {
                        cell.elements.pop();
                    }
                }
            }

            for (const row of element.rows) {
                while (row.cells.length < columnCount) {
                    row.cells.push({elements: []});
                }
            }

            while (element.columns.length < columnCount) {
                element.columns.push({width: 1});
            }

            while (element.columns.length > columnCount) {
                element.columns.pop();
            }
            break;
        }
        default:
            throw exhaustive(element);
    }
}

function normalizeApiContentInlineElements(
    elements: Draft<ReadonlyArray<ApiContentInlineElement>>,
) {
    let index = 0;
    let lastElement: Draft<ApiContentInlineElement> | undefined;

    while (index < elements.length) {
        const element = elements[index]!;

        // Ignore empty text elements.
        if (element.type === "Text" && element.text.length === 0) {
            elements.splice(index, 1);
            continue;
        }

        if (element.type === "Mention") {
            // The mention title is only sometimes included as a convenience. It isn't
            // essential to the mention element.
            if (hasOwnProperty(element, "title")) {
                delete element.title;
            }

            // `isAccountShortName` can only be true for account targets. Otherwise set
            // to undefined.
            if (
                element.isAccountShortName === false ||
                (element.isAccountShortName && !element.targetPath.startsWith("/accounts/"))
            ) {
                element.isAccountShortName = undefined;
            }
        }

        const normalizedMarks = normalizeApiContentInlineElementMarks(element.marks);
        if (!isDeepEqual(normalizedMarks, element.marks))
            element.marks = castDraft(normalizedMarks);

        // Merge any adjacent text elements with the same marks.
        if (
            element.type === "Text" &&
            lastElement?.type === "Text" &&
            isDeepEqual(element.marks, lastElement.marks)
        ) {
            lastElement.text += element.text;
            elements.splice(index, 1);
            continue;
        }

        lastElement = element;
        index++;
    }
}

export const apiContentInlineElementMarkTypeNormalizedOrder = Object.keys(
    // We use an object so TypeScript makes sure we list each type once. Then
    // convert to an array with `Object.keys()`.
    cast<Record<ApiContentInlineElementMark["type"], true>>({
        // We put link first since this influences print order. We'll be able to merge
        // adjacent links since they're always wrapping all other marks.
        Link: true,

        Bold: true,
        Italic: true,
        Strike: true,
        Code: true,
    }),
);

export function normalizeApiContentInlineElementMarks<Mark extends ApiContentInlineElementMark>(
    marks: Iterable<Mark> | undefined,
): Array<Mark> | undefined {
    if (marks === undefined) return undefined;

    const markByKey = new Map<string, Mark>();

    for (const mark of marks) {
        let markKey: string;

        switch (mark.type) {
            // Only one mark of each type may exist in a marks array. When we introduce the
            // `Comment` mark there may be multiple comment marks with different
            // `DocumentCommentThreadId`s. Which is why this is an exhaustive switch, when
            // we add the comment mark we need to handle normalization differently.
            case "Bold":
            case "Italic":
            case "Strike":
            case "Link":
            case "Code":
                markKey = mark.type;
                break;
            default:
                throw exhaustive(mark);
        }

        markByKey.set(markKey, mark);
    }

    const sortedMarkKeys = Array.from(markByKey.keys()).sort(
        (markKey1, markKey2) =>
            apiContentInlineElementMarkTypeNormalizedOrder.indexOf(markKey1) -
                apiContentInlineElementMarkTypeNormalizedOrder.indexOf(markKey2) ||
            defaultCompareStrings(markKey1, markKey2),
    );

    const normalizedMarks = sortedMarkKeys.map(markKey => markByKey.get(markKey)!);

    if (normalizedMarks.length === 0) {
        return undefined;
    } else {
        return normalizedMarks;
    }
}
