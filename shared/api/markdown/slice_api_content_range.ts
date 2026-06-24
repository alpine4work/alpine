import {ApiContentKey} from "~/shared/api/specification/types/api_content_key.js";
import {
    ApiContentAfterPosition,
    ApiContentBeforePosition,
    ApiContentInlinePosition,
    ApiContentPosition,
    ApiContentRange,
} from "~/shared/api/specification/types/api_content_position.js";
import {
    ApiContentBlockElementResponse,
    ApiContentCheckListBlockElementItemResponse,
    ApiContentCheckListBlockElementResponse,
    ApiContentCodeBlockElementLineResponse,
    ApiContentCodeBlockElementResponse,
    ApiContentCodeBlockElementTextInlineElement,
    ApiContentDividerBlockElementResponse,
    ApiContentFileBlockElementResponse,
    ApiContentFileFloatBlockElementResponse,
    ApiContentFileGalleryBlockElementResponse,
    ApiContentFileGalleryBlockElementRowItemResponse,
    ApiContentFileGalleryBlockElementRowResponse,
    ApiContentInlineElementResponse,
    ApiContentListBlockElementItemResponse,
    ApiContentListBlockElementResponse,
    ApiContentOrderedListBlockElementResponse,
    ApiContentParagraphBlockElementResponse,
    ApiContentPreviewBlockElementResponse,
    ApiContentQuoteBlockElementBlockElementResponse,
    ApiContentResponse,
    ApiContentTableBlockElementCellBlockElementResponse,
    ApiContentTableBlockElementCellResponse,
    ApiContentTableBlockElementResponse,
    ApiContentTableBlockElementRowResponse,
    ApiContentUnorderedListBlockElementResponse,
} from "~/shared/api/specification/types/api_specification_convenience_types.js";
import {InternalError} from "~/shared/error/error.js";
import {cast} from "~/shared/helpers/control/cast.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {quote} from "~/shared/helpers/string/quote.js";

type SliceContext = {
    readonly range: ApiContentRange;
    state: "Before" | "Inside" | "After";
};

export function sliceApiContentRange(
    content: ApiContentResponse,
    range: ApiContentRange,
): ApiContentResponse | null {
    const context: SliceContext = {range, state: "Before"};

    const elements = sliceBlockElements(context, content.elements);
    if (elements === undefined) return null;
    return {elements};
}

function sliceBlockElements(
    context: SliceContext,
    elements: ReadonlyArray<ApiContentBlockElementResponse>,
): Array<ApiContentBlockElementResponse> | undefined {
    let slicedElements: Array<ApiContentBlockElementResponse> | undefined;

    for (const element of elements) {
        if (context.state === "After") break;

        const slicedElement = sliceBlockElement(context, element);
        if (slicedElement !== undefined) {
            slicedElements ??= [];
            slicedElements.push(slicedElement);
        }
    }

    return slicedElements;
}

function sliceBlockElement(
    context: SliceContext,
    element: ApiContentBlockElementResponse,
): ApiContentBlockElementResponse | undefined {
    switch (element.type) {
        case "Paragraph": {
            return sliceParagraphBlockElement(context, element);
        }
        case "Heading": {
            const elements = sliceInlineElements(context, element.key, element.elements);
            if (elements === undefined || elements.length === 0) return undefined;
            return {...element, elements};
        }
        case "Quote": {
            const elements = sliceQuoteBlockElements(context, element.elements);
            if (elements === undefined || elements.length === 0) return undefined;
            return {...element, elements};
        }
        case "UnorderedList":
        case "OrderedList":
        case "CheckList": {
            return sliceListBlockElement(context, element);
        }
        case "Code": {
            return sliceCodeBlockElement(context, element);
        }
        case "Divider": {
            return sliceDividerBlockElement(context, element);
        }
        case "File":
        case "Preview": {
            return sliceFileOrPreviewBlockElement(context, element);
        }
        case "FileGallery": {
            return sliceFileGalleryBlockElement(context, element);
        }
        case "FileFloat": {
            return sliceFileFloatBlockElement(context, element);
        }
        case "Table": {
            return sliceTableBlockElement(context, element);
        }
        default:
            throw exhaustive(element);
    }
}

function sliceParagraphBlockElement(
    context: SliceContext,
    element: ApiContentParagraphBlockElementResponse,
): ApiContentParagraphBlockElementResponse | undefined {
    const elements = sliceInlineElements(context, element.key, element.elements);
    if (elements === undefined || elements.length === 0) return undefined;
    return {...element, elements};
}

function sliceInlineElements(
    context: SliceContext,
    key: ApiContentKey,
    elements: ReadonlyArray<ApiContentInlineElementResponse>,
): Array<ApiContentInlineElementResponse> | undefined {
    let slicedElements: Array<ApiContentInlineElementResponse> | undefined;
    let index = 0;

    for (const element of elements) {
        if (context.state === "After") break;

        switch (element.type) {
            case "Text": {
                let range: {startTextIndex: number; endTextIndex: number} | undefined;

                for (let textIndex = 0; textIndex < element.text.length; textIndex++) {
                    if (consumeInlineToken(context, key, index, index + 1)) {
                        if (range === undefined) {
                            range = {startTextIndex: textIndex, endTextIndex: textIndex + 1};
                        } else {
                            range.endTextIndex = textIndex + 1;
                        }
                    }

                    index++;

                    // @ts-expect-error: `consumeInlineToken()` may mutate `context.state`.
                    if (context.state === "After") break;
                }

                if (range !== undefined) {
                    slicedElements ??= [];
                    slicedElements.push({
                        ...element,
                        text: element.text.slice(range.startTextIndex, range.endTextIndex),
                    });
                }
                break;
            }
            case "Break":
            case "Mention": {
                if (consumeInlineToken(context, key, index, index + 1)) {
                    slicedElements ??= [];
                    slicedElements.push(element);
                }

                index++;
                break;
            }
            default:
                throw exhaustive(element);
        }
    }

    return slicedElements;
}

// An optimized variant of `consumeToken()` for checking inline tokens with the
// same `key` specifically. Avoids unneeded object allocations.
function consumeInlineToken(
    context: SliceContext,
    key: ApiContentKey,
    startIndex: number,
    endIndex: number,
): boolean {
    const {start, end} = context.range;

    if (context.state === "After") return false;

    if (context.state === "Before") {
        const isStartEqualToStartIndex =
            start.type === "Inline" && start.key === key && start.index === startIndex;

        if (!isStartEqualToStartIndex) {
            const isStartEqualToEndIndex =
                start.type === "Inline" && start.key === key && start.index === endIndex;

            if (isStartEqualToEndIndex) context.state = "Inside";
            return false;
        }
        context.state = "Inside";
    }

    const isEndEqualToStartIndex =
        end.type === "Inline" && end.key === key && end.index === startIndex;

    if (isEndEqualToStartIndex) {
        context.state = "After";
        return false;
    }

    const isEndEqualToEndIndex = end.type === "Inline" && end.key === key && end.index === endIndex;

    if (isEndEqualToEndIndex) {
        context.state = "After";
    }

    return true;
}

function sliceQuoteBlockElements(
    context: SliceContext,
    elements: ReadonlyArray<ApiContentQuoteBlockElementBlockElementResponse>,
): Array<ApiContentQuoteBlockElementBlockElementResponse> | undefined {
    let slicedElements: Array<ApiContentQuoteBlockElementBlockElementResponse> | undefined;

    for (const element of elements) {
        if (context.state === "After") break;

        const slicedElement = sliceBlockElement(context, element);
        if (slicedElement === undefined) continue;

        switch (slicedElement.type) {
            case "Paragraph":
            case "UnorderedList":
            case "OrderedList":
            case "CheckList": {
                slicedElements ??= [];
                slicedElements.push(slicedElement);
                break;
            }
            case "Quote":
            case "Heading":
            case "Divider":
            case "Table":
            case "Code":
            case "File":
            case "FileGallery":
            case "FileFloat":
            case "Preview": {
                // This `cast()` uses TypeScript to assert we're only matching block elements that
                // aren't supported in quote blocks. If we allow an element to be present in a
                // quote block (e.g. `Code`) then TypeScript will report an error and we'll have to
                // update this code.
                cast<
                    Exclude<
                        ApiContentBlockElementResponse["type"],
                        ApiContentQuoteBlockElementBlockElementResponse["type"]
                    >
                >(slicedElement.type);

                throw new InternalError(
                    quote`${slicedElement.type} isn\u2019t supported in a quote`,
                );
            }
            default:
                throw exhaustive(slicedElement);
        }
    }

    return slicedElements;
}

function sliceListBlockElement(
    context: SliceContext,
    element:
        | ApiContentUnorderedListBlockElementResponse
        | ApiContentOrderedListBlockElementResponse
        | ApiContentCheckListBlockElementResponse,
): ApiContentListBlockElementResponse | undefined {
    switch (element.type) {
        case "UnorderedList":
        case "OrderedList": {
            const items = sliceListBlockElementItems(context, element.items);
            if (items === undefined || items.length === 0) return undefined;
            return {...element, items};
        }
        case "CheckList": {
            const items = sliceCheckListBlockElementItems(context, element.items);
            if (items === undefined || items.length === 0) return undefined;
            return {...element, items};
        }
        default:
            throw exhaustive(element);
    }
}

function sliceListBlockElementItems(
    context: SliceContext,
    items: ReadonlyArray<ApiContentListBlockElementItemResponse>,
): Array<ApiContentListBlockElementItemResponse> | undefined {
    let slicedItems: Array<ApiContentListBlockElementItemResponse> | undefined;

    for (const item of items) {
        if (context.state === "After") break;

        const elements = sliceParagraphBlockElements(context, item.elements);
        const nestedListElements =
            item.nestedListElements !== undefined
                ? sliceListBlockElements(context, item.nestedListElements)
                : undefined;

        if (
            elements.length > 0 ||
            (nestedListElements !== undefined && nestedListElements.length > 0)
        ) {
            slicedItems ??= [];
            slicedItems.push({
                elements,
                ...(nestedListElements !== undefined && nestedListElements.length > 0
                    ? {nestedListElements}
                    : {}),
            });
        }
    }

    return slicedItems;
}

function sliceParagraphBlockElements(
    context: SliceContext,
    elements: ReadonlyArray<ApiContentParagraphBlockElementResponse>,
): Array<ApiContentParagraphBlockElementResponse> {
    const slicedElements: Array<ApiContentParagraphBlockElementResponse> = [];

    for (const element of elements) {
        if (context.state === "After") break;

        const slicedElement = sliceParagraphBlockElement(context, element);
        if (slicedElement !== undefined) slicedElements.push(slicedElement);
    }

    return slicedElements;
}

function sliceListBlockElements(
    context: SliceContext,
    elements: ReadonlyArray<ApiContentListBlockElementResponse>,
): Array<ApiContentListBlockElementResponse> {
    const slicedElements: Array<ApiContentListBlockElementResponse> = [];

    for (const element of elements) {
        if (context.state === "After") break;

        const slicedElement = sliceListBlockElement(context, element);
        if (slicedElement !== undefined) slicedElements.push(slicedElement);
    }

    return slicedElements;
}

function sliceCheckListBlockElementItems(
    context: SliceContext,
    items: ReadonlyArray<ApiContentCheckListBlockElementItemResponse>,
): Array<ApiContentCheckListBlockElementItemResponse> | undefined {
    let slicedItems: Array<ApiContentCheckListBlockElementItemResponse> | undefined;

    for (const item of items) {
        if (context.state === "After") break;

        const elements = sliceParagraphBlockElements(context, item.elements);
        const nestedListElements =
            item.nestedListElements !== undefined
                ? sliceListBlockElements(context, item.nestedListElements)
                : undefined;

        if (
            elements.length > 0 ||
            (nestedListElements !== undefined && nestedListElements.length > 0)
        ) {
            slicedItems ??= [];
            slicedItems.push({
                checked: item.checked,
                elements,
                ...(nestedListElements !== undefined && nestedListElements.length > 0
                    ? {nestedListElements}
                    : {}),
            });
        }
    }

    return slicedItems;
}

function sliceCodeBlockElement(
    context: SliceContext,
    element: ApiContentCodeBlockElementResponse,
): ApiContentCodeBlockElementResponse | undefined {
    let lines: Array<ApiContentCodeBlockElementLineResponse> | undefined;

    let previousLine: {line: ApiContentCodeBlockElementLineResponse; length: number} | undefined;

    // NOCOMMIT: Can this be simplified at all?
    for (const line of element.lines) {
        if (context.state === "After") break;

        const selectedBreak =
            previousLine !== undefined &&
            consumeToken(
                context,
                {type: "Inline", key: previousLine.line.key, index: previousLine.length},
                {type: "Inline", key: line.key, index: 0},
            );

        if (
            selectedBreak &&
            previousLine !== undefined &&
            (lines === undefined || lines.length === 0)
        ) {
            lines ??= [];
            lines.push({...previousLine.line, elements: []});
        }

        const lineElements = sliceCodeLineElements(context, line.key, line.elements);

        if (selectedBreak || lineElements.length > 0) {
            lines ??= [];
            lines.push({...line, elements: lineElements});
        }

        previousLine = {
            line,
            length: getCodeLineElementsLength(line.elements),
        };
    }

    if (lines === undefined) return undefined;
    return {...element, lines};
}

function consumeToken(
    context: SliceContext,
    start: ApiContentInlinePosition | ApiContentBeforePosition,
    end: ApiContentInlinePosition | ApiContentAfterPosition,
): boolean {
    if (context.state === "After") return false;

    if (context.state === "Before") {
        if (!arePositionsEqual(start, context.range.start)) {
            if (arePositionsEqual(end, context.range.start)) context.state = "Inside";
            return false;
        }
        context.state = "Inside";
    }

    if (arePositionsEqual(start, context.range.end)) {
        context.state = "After";
        return false;
    }

    if (arePositionsEqual(end, context.range.end)) {
        context.state = "After";
    }

    return true;
}

function arePositionsEqual(position1: ApiContentPosition, position2: ApiContentPosition): boolean {
    if (position1.type !== position2.type) return false;

    switch (position1.type) {
        case "Inline": {
            return (
                position2.type === "Inline" &&
                position1.key === position2.key &&
                position1.index === position2.index
            );
        }
        case "Before": {
            return position2.type === "Before" && position1.key === position2.key;
        }
        case "After": {
            return position2.type === "After" && position1.key === position2.key;
        }
        default:
            throw exhaustive(position1);
    }
}

function sliceCodeLineElements(
    context: SliceContext,
    key: ApiContentKey,
    elements: ReadonlyArray<ApiContentCodeBlockElementTextInlineElement>,
): Array<ApiContentCodeBlockElementTextInlineElement> {
    const slicedElements: Array<ApiContentCodeBlockElementTextInlineElement> = [];
    let index = 0;

    for (const element of elements) {
        if (context.state === "After") break;

        let text = "";

        for (let i = 0; i < element.text.length; i++) {
            if (consumeInlineToken(context, key, index, index + 1)) {
                text += element.text[i]!;
            }

            index++;

            // @ts-expect-error: `consumeInlineToken()` may mutate `context.state`.
            if (context.state === "After") break;
        }

        if (text !== "") slicedElements.push({...element, text});
    }

    return slicedElements;
}

function getCodeLineElementsLength(
    elements: ReadonlyArray<ApiContentCodeBlockElementTextInlineElement>,
): number {
    let length = 0;

    for (const element of elements) {
        length += element.text.length;
    }

    return length;
}

function sliceDividerBlockElement(
    context: SliceContext,
    element: ApiContentDividerBlockElementResponse,
): ApiContentDividerBlockElementResponse | undefined {
    if (
        consumeToken(context, {type: "Before", key: element.key}, {type: "After", key: element.key})
    ) {
        return element;
    }

    return undefined;
}

function sliceFileOrPreviewBlockElement(
    context: SliceContext,
    element: ApiContentFileBlockElementResponse | ApiContentPreviewBlockElementResponse,
): ApiContentFileBlockElementResponse | ApiContentPreviewBlockElementResponse | undefined {
    if (
        consumeToken(context, {type: "Before", key: element.key}, {type: "After", key: element.key})
    ) {
        return element;
    }

    return undefined;
}

function sliceFileGalleryBlockElement(
    context: SliceContext,
    element: ApiContentFileGalleryBlockElementResponse,
): ApiContentFileGalleryBlockElementResponse | undefined {
    let rows: Array<ApiContentFileGalleryBlockElementRowResponse> | undefined;

    for (const row of element.rows) {
        if (context.state === "After") break;

        let items: Array<ApiContentFileGalleryBlockElementRowItemResponse> | undefined;

        for (const item of row.items) {
            // @ts-expect-error: `sliceFileOrPreviewBlockElement()` may mutate `context.state`.
            if (context.state === "After") break;

            const slicedElement = sliceFileOrPreviewBlockElement(context, item.element);
            if (slicedElement !== undefined) {
                items ??= [];
                items.push({...item, element: slicedElement});
            }
        }

        if (items !== undefined) {
            rows ??= [];
            rows.push({...row, items});
        }
    }

    if (rows === undefined) return undefined;
    return {...element, rows};
}

function sliceFileFloatBlockElement(
    context: SliceContext,
    element: ApiContentFileFloatBlockElementResponse,
): ApiContentFileFloatBlockElementResponse | undefined {
    const slicedElement = sliceFileOrPreviewBlockElement(context, element.element);
    if (slicedElement === undefined) return undefined;
    return {...element, element: slicedElement};
}

function sliceTableBlockElement(
    context: SliceContext,
    element: ApiContentTableBlockElementResponse,
): ApiContentTableBlockElementResponse | undefined {
    let rows: Array<ApiContentTableBlockElementRowResponse> | undefined;

    for (const row of element.rows) {
        if (context.state === "After") break;

        let cells: Array<ApiContentTableBlockElementCellResponse> | undefined;

        for (const cell of row.cells) {
            // @ts-expect-error: `sliceTableCellBlockElements()` may mutate `context.state`.
            if (context.state === "After") break;

            const elements = sliceTableCellBlockElements(context, cell.elements);
            if (elements !== undefined) {
                cells ??= [];
                cells.push({...cell, elements});
            }
        }

        if (cells !== undefined) {
            rows ??= [];
            rows.push({...row, cells});
        }
    }

    if (rows === undefined) return undefined;
    return {...element, rows};
}

function sliceTableCellBlockElements(
    context: SliceContext,
    elements: ReadonlyArray<ApiContentTableBlockElementCellBlockElementResponse>,
): Array<ApiContentTableBlockElementCellBlockElementResponse> | undefined {
    let slicedElements: Array<ApiContentTableBlockElementCellBlockElementResponse> | undefined;

    for (const element of elements) {
        if (context.state === "After") break;

        const slicedElement = sliceBlockElement(context, element);
        if (slicedElement === undefined) continue;

        switch (slicedElement.type) {
            case "Paragraph":
            case "UnorderedList":
            case "OrderedList":
            case "CheckList":
            case "Quote":
            case "Code":
            case "File":
            case "Preview": {
                slicedElements ??= [];
                slicedElements.push(slicedElement);
                break;
            }
            case "Heading":
            case "Divider":
            case "Table":
            case "FileGallery":
            case "FileFloat": {
                // This `cast()` uses TypeScript to assert we're only matching block elements that
                // aren't supported in quote blocks. If we allow an element to be present in a
                // quote block (e.g. `Code`) then TypeScript will report an error and we'll have to
                // update this code.
                cast<
                    Exclude<
                        ApiContentBlockElementResponse["type"],
                        ApiContentTableBlockElementCellBlockElementResponse["type"]
                    >
                >(slicedElement.type);

                throw new InternalError(
                    quote`${slicedElement.type} isn\u2019t supported in a table cell`,
                );
            }
            default:
                throw exhaustive(slicedElement);
        }
    }

    return slicedElements;
}
