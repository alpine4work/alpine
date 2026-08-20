import {
    ApiContentBlockElementRequest,
    ApiContentBlockElementWithoutKeys,
    ApiContentCheckListBlockElementItemRequest,
    ApiContentCheckListBlockElementItemWithoutKeys,
    ApiContentCodeBlockElementRequest,
    ApiContentCodeBlockElementWithoutKeys,
    ApiContentInlineElement,
    ApiContentInlineElementRequest,
    ApiContentListBlockElementItemRequest,
    ApiContentListBlockElementItemWithoutKeys,
    ApiContentListBlockElementRequest,
    ApiContentListBlockElementWithoutKeys,
    ApiContentParagraphBlockElementRequest,
    ApiContentParagraphBlockElementWithoutKeys,
    ApiContentQuoteBlockElementBlockElementRequest,
    ApiContentQuoteBlockElementBlockElementWithoutKeys,
    ApiContentRequest,
    ApiContentTableBlockElementCellBlockElementRequest,
    ApiContentTableBlockElementCellBlockElementWithoutKeys,
    ApiContentTableBlockElementRequest,
    ApiContentTableBlockElementWithoutKeys,
    ApiContentWithoutKeys,
} from "~/shared/api/specification/types/api_specification_convenience_types.open_source.js";
import {InternalError} from "~/shared/error/error.open_source.js";
import {assert} from "~/shared/helpers/control/assert.open_source.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.open_source.js";
import {quote} from "~/shared/helpers/string/quote.open_source.js";

/**
 * Takes `ApiContentRequest` without response properties and turns it into
 * `ApiContentWithoutKeys`. Useful for tests if you want an `ApiContent` object.
 * You use `parseApiContentFromMarkdown()` to parse markdown then use this to make
 * sure the markdown doesn't contain elements that need response properties (like
 * `Mention`).
 *
 * This function throws if there are any elements that require response properties
 * (like `Mention` or `File`). But elements like `Text` which don't need response
 * properties are ok.
 */
export function assertApiContentIsResponseForTest(
    content: ApiContentRequest,
): ApiContentWithoutKeys {
    assert(process.env.NODE_ENV === "test");

    return {
        elements: content.elements.map(assertApiContentBlockElementIsResponseForTest),
    };
}

function assertApiContentBlockElementIsResponseForTest(
    element: ApiContentBlockElementRequest,
): ApiContentBlockElementWithoutKeys {
    switch (element.type) {
        case "Paragraph":
            return assertApiContentParagraphBlockElementIsResponseForTest(element);
        case "UnorderedList":
        case "OrderedList":
        case "CheckList":
            return assertApiContentListBlockElementIsResponseForTest(element);
        case "Quote": {
            return {
                type: "Quote",
                elements: element.elements.map(
                    assertApiContentQuoteBlockElementBlockElementIsResponseForTest,
                ),
            };
        }
        case "Heading": {
            return {
                type: "Heading",
                level: element.level,
                elements: element.elements.map(assertApiContentInlineElementIsResponseForTest),
            };
        }
        case "Divider":
            return element;
        case "Table":
            return assertApiContentTableBlockElementIsResponseForTest(element);
        case "Code":
            return assertApiContentCodeBlockElementIsResponseForTest(element);
        case "File":
        case "Preview":
        case "FileGallery":
        case "FileFloat":
            return throwMissingApiContentResponseProperties(element.type);
        default:
            throw exhaustive(element);
    }
}

function assertApiContentParagraphBlockElementIsResponseForTest(
    element: ApiContentParagraphBlockElementRequest,
): ApiContentParagraphBlockElementWithoutKeys {
    return {
        type: "Paragraph",
        elements: element.elements.map(assertApiContentInlineElementIsResponseForTest),
    };
}

function assertApiContentListBlockElementIsResponseForTest(
    element: ApiContentListBlockElementRequest,
): ApiContentListBlockElementWithoutKeys {
    switch (element.type) {
        case "UnorderedList":
            return {
                type: "UnorderedList",
                items: element.items.map(assertApiContentListBlockElementItemIsResponseForTest),
            };
        case "OrderedList":
            return {
                type: "OrderedList",
                ...(element.orderStart !== undefined ? {orderStart: element.orderStart} : {}),
                items: element.items.map(assertApiContentListBlockElementItemIsResponseForTest),
            };
        case "CheckList":
            return {
                type: "CheckList",
                items: element.items.map(
                    assertApiContentCheckListBlockElementItemIsResponseForTest,
                ),
            };
        default:
            throw exhaustive(element);
    }
}

function assertApiContentListBlockElementItemIsResponseForTest(
    item: ApiContentListBlockElementItemRequest,
): ApiContentListBlockElementItemWithoutKeys {
    const nestedListElements =
        item.nestedListElements !== undefined
            ? item.nestedListElements.map(assertApiContentListBlockElementIsResponseForTest)
            : undefined;

    return {
        elements: item.elements.map(assertApiContentParagraphBlockElementIsResponseForTest),
        ...(nestedListElements !== undefined ? {nestedListElements} : {}),
    };
}

function assertApiContentCheckListBlockElementItemIsResponseForTest(
    item: ApiContentCheckListBlockElementItemRequest,
): ApiContentCheckListBlockElementItemWithoutKeys {
    const nestedListElements =
        item.nestedListElements !== undefined
            ? item.nestedListElements.map(assertApiContentListBlockElementIsResponseForTest)
            : undefined;

    return {
        checked: item.checked,
        elements: item.elements.map(assertApiContentParagraphBlockElementIsResponseForTest),
        ...(nestedListElements !== undefined ? {nestedListElements} : {}),
    };
}

function assertApiContentQuoteBlockElementBlockElementIsResponseForTest(
    element: ApiContentQuoteBlockElementBlockElementRequest,
): ApiContentQuoteBlockElementBlockElementWithoutKeys {
    switch (element.type) {
        case "Paragraph":
            return assertApiContentParagraphBlockElementIsResponseForTest(element);
        case "UnorderedList":
        case "OrderedList":
        case "CheckList":
            return assertApiContentListBlockElementIsResponseForTest(element);
        default:
            throw exhaustive(element);
    }
}

function assertApiContentTableBlockElementIsResponseForTest(
    element: ApiContentTableBlockElementRequest,
): ApiContentTableBlockElementWithoutKeys {
    return {
        ...element,
        rows: element.rows.map(row => ({
            ...row,
            cells: row.cells.map(cell => ({
                ...cell,
                elements: cell.elements.map(
                    assertApiContentTableBlockElementCellBlockElementIsResponseForTest,
                ),
            })),
        })),
    };
}

function assertApiContentTableBlockElementCellBlockElementIsResponseForTest(
    element: ApiContentTableBlockElementCellBlockElementRequest,
): ApiContentTableBlockElementCellBlockElementWithoutKeys {
    switch (element.type) {
        case "Paragraph":
            return assertApiContentParagraphBlockElementIsResponseForTest(element);
        case "UnorderedList":
        case "OrderedList":
        case "CheckList":
            return assertApiContentListBlockElementIsResponseForTest(element);
        case "Quote":
            return {
                ...element,
                elements: element.elements.map(
                    assertApiContentQuoteBlockElementBlockElementIsResponseForTest,
                ),
            };
        case "Code":
            return assertApiContentCodeBlockElementIsResponseForTest(element);
        case "File":
        case "Preview":
            return throwMissingApiContentResponseProperties(element.type);
        default:
            throw exhaustive(element);
    }
}

function assertApiContentCodeBlockElementIsResponseForTest(
    element: ApiContentCodeBlockElementRequest,
): ApiContentCodeBlockElementWithoutKeys {
    return {
        ...element,
        lines: element.lines.map(line => ({...line, elements: line.elements})),
    };
}

function assertApiContentInlineElementIsResponseForTest(
    element: ApiContentInlineElementRequest,
): ApiContentInlineElement {
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
