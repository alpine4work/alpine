import {
    ApiContent,
    ApiContentBlockElement,
    ApiContentBlockElementResponseWithoutKeys,
    ApiContentCheckListBlockElementItem,
    ApiContentCheckListBlockElementItemResponseWithoutKeys,
    ApiContentCodeBlockElement,
    ApiContentCodeBlockElementResponseWithoutKeys,
    ApiContentInlineElement,
    ApiContentInlineElementResponse,
    ApiContentListBlockElement,
    ApiContentListBlockElementItem,
    ApiContentListBlockElementItemResponseWithoutKeys,
    ApiContentListBlockElementResponseWithoutKeys,
    ApiContentParagraphBlockElement,
    ApiContentParagraphBlockElementResponseWithoutKeys,
    ApiContentQuoteBlockElementBlockElement,
    ApiContentQuoteBlockElementBlockElementResponseWithoutKeys,
    ApiContentResponseWithoutKeys,
    ApiContentTableBlockElement,
    ApiContentTableBlockElementCellBlockElement,
    ApiContentTableBlockElementCellBlockElementResponseWithoutKeys,
    ApiContentTableBlockElementResponseWithoutKeys,
} from "~/shared/api/specification/types/api_specification_convenience_types.js";
import {InternalError} from "~/shared/error/error.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {quote} from "~/shared/helpers/string/quote.js";

/**
 * Takes `ApiContent` without response properties and turns it into
 * `ApiContentResponseWithoutKeys`. Useful for tests if you want an
 * `ApiContentResponse` object. You use `parseApiContentFromMarkdown()` to parse
 * markdown then use this to make sure the markdown doesn't contain elements that
 * need response properties (like `Mention`).
 *
 * This function throws if there are any elements that require response properties
 * (like `Mention` or `File`). But elements like `Text` which don't need response
 * properties are ok.
 */
export function assertApiContentAsResponseForTest(
    content: ApiContent,
): ApiContentResponseWithoutKeys {
    assert(process.env.NODE_ENV === "test");

    return {
        elements: content.elements.map(assertApiContentBlockElementAsResponseForTest),
    };
}

export {assertApiContentAsResponseForTest as assertApiContentIsResponseForTest};

function assertApiContentBlockElementAsResponseForTest(
    element: ApiContentBlockElement,
): ApiContentBlockElementResponseWithoutKeys {
    switch (element.type) {
        case "Paragraph":
            return assertApiContentParagraphBlockElementAsResponseForTest(element);
        case "UnorderedList":
        case "OrderedList":
        case "CheckList":
            return assertApiContentListBlockElementAsResponseForTest(element);
        case "Quote": {
            return {
                type: "Quote",
                elements: element.elements.map(
                    assertApiContentQuoteBlockElementBlockElementAsResponseForTest,
                ),
            };
        }
        case "Heading": {
            return {
                type: "Heading",
                level: element.level,
                elements: element.elements.map(assertApiContentInlineElementAsResponseForTest),
            };
        }
        case "Divider":
            return element;
        case "Table":
            return assertApiContentTableBlockElementAsResponseForTest(element);
        case "Code":
            return assertApiContentCodeBlockElementAsResponseForTest(element);
        case "File":
        case "Preview":
        case "FileGallery":
        case "FileFloat":
            return throwMissingApiContentResponseProperties(element.type);
        default:
            throw exhaustive(element);
    }
}

function assertApiContentParagraphBlockElementAsResponseForTest(
    element: ApiContentParagraphBlockElement,
): ApiContentParagraphBlockElementResponseWithoutKeys {
    return {
        type: "Paragraph",
        elements: element.elements.map(assertApiContentInlineElementAsResponseForTest),
    };
}

function assertApiContentListBlockElementAsResponseForTest(
    element: ApiContentListBlockElement,
): ApiContentListBlockElementResponseWithoutKeys {
    switch (element.type) {
        case "UnorderedList":
            return {
                type: "UnorderedList",
                items: element.items.map(assertApiContentListBlockElementItemAsResponseForTest),
            };
        case "OrderedList":
            return {
                type: "OrderedList",
                ...(element.orderStart !== undefined ? {orderStart: element.orderStart} : {}),
                items: element.items.map(assertApiContentListBlockElementItemAsResponseForTest),
            };
        case "CheckList":
            return {
                type: "CheckList",
                items: element.items.map(
                    assertApiContentCheckListBlockElementItemAsResponseForTest,
                ),
            };
        default:
            throw exhaustive(element);
    }
}

function assertApiContentListBlockElementItemAsResponseForTest(
    item: ApiContentListBlockElementItem,
): ApiContentListBlockElementItemResponseWithoutKeys {
    const nestedListElements =
        item.nestedListElements !== undefined
            ? item.nestedListElements.map(assertApiContentListBlockElementAsResponseForTest)
            : undefined;

    return {
        elements: item.elements.map(assertApiContentParagraphBlockElementAsResponseForTest),
        ...(nestedListElements !== undefined ? {nestedListElements} : {}),
    };
}

function assertApiContentCheckListBlockElementItemAsResponseForTest(
    item: ApiContentCheckListBlockElementItem,
): ApiContentCheckListBlockElementItemResponseWithoutKeys {
    const nestedListElements =
        item.nestedListElements !== undefined
            ? item.nestedListElements.map(assertApiContentListBlockElementAsResponseForTest)
            : undefined;

    return {
        checked: item.checked,
        elements: item.elements.map(assertApiContentParagraphBlockElementAsResponseForTest),
        ...(nestedListElements !== undefined ? {nestedListElements} : {}),
    };
}

function assertApiContentQuoteBlockElementBlockElementAsResponseForTest(
    element: ApiContentQuoteBlockElementBlockElement,
): ApiContentQuoteBlockElementBlockElementResponseWithoutKeys {
    switch (element.type) {
        case "Paragraph":
            return assertApiContentParagraphBlockElementAsResponseForTest(element);
        case "UnorderedList":
        case "OrderedList":
        case "CheckList":
            return assertApiContentListBlockElementAsResponseForTest(element);
        default:
            throw exhaustive(element);
    }
}

function assertApiContentTableBlockElementAsResponseForTest(
    element: ApiContentTableBlockElement,
): ApiContentTableBlockElementResponseWithoutKeys {
    return {
        ...element,
        rows: element.rows.map(row => ({
            ...row,
            cells: row.cells.map(cell => ({
                ...cell,
                elements: cell.elements.map(
                    assertApiContentTableBlockElementCellBlockElementAsResponseForTest,
                ),
            })),
        })),
    };
}

function assertApiContentTableBlockElementCellBlockElementAsResponseForTest(
    element: ApiContentTableBlockElementCellBlockElement,
): ApiContentTableBlockElementCellBlockElementResponseWithoutKeys {
    switch (element.type) {
        case "Paragraph":
            return assertApiContentParagraphBlockElementAsResponseForTest(element);
        case "UnorderedList":
        case "OrderedList":
        case "CheckList":
            return assertApiContentListBlockElementAsResponseForTest(element);
        case "Quote":
            return {
                ...element,
                elements: element.elements.map(
                    assertApiContentQuoteBlockElementBlockElementAsResponseForTest,
                ),
            };
        case "Code":
            return assertApiContentCodeBlockElementAsResponseForTest(element);
        case "File":
        case "Preview":
            return throwMissingApiContentResponseProperties(element.type);
        default:
            throw exhaustive(element);
    }
}

function assertApiContentCodeBlockElementAsResponseForTest(
    element: ApiContentCodeBlockElement,
): ApiContentCodeBlockElementResponseWithoutKeys {
    return {
        ...element,
        lines: element.lines.map(line => ({...line, elements: line.elements})),
    };
}

function assertApiContentInlineElementAsResponseForTest(
    element: ApiContentInlineElement,
): ApiContentInlineElementResponse {
    switch (element.type) {
        case "Text":
        case "Break": {
            return element;
        }
        case "Mention": {
            return throwMissingApiContentResponseProperties(element.type);
        }
        default:
            throw exhaustive(element);
    }
}

function throwMissingApiContentResponseProperties(elementType: string): never {
    throw new InternalError(quote`Content element ${elementType} has missing response properties`);
}
