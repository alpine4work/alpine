import {ApiContentKey} from "~/shared/api/specification/types/api_content_key.open_source.js";
import {
    ApiContentAfterPosition,
    ApiContentBeforePosition,
    ApiContentInlinePosition,
    ApiContentPosition,
    ApiContentRange,
} from "~/shared/api/specification/types/api_content_position.open_source.js";
import {
    ApiContent,
    ApiContentBlockElement,
    ApiContentBlockElementWithoutKeys,
    ApiContentCheckListBlockElement,
    ApiContentCheckListBlockElementItem,
    ApiContentCheckListBlockElementItemWithoutKeys,
    ApiContentCodeBlockElement,
    ApiContentCodeBlockElementLine,
    ApiContentCodeBlockElementLineWithoutKeys,
    ApiContentCodeBlockElementTextInlineElement,
    ApiContentCodeBlockElementWithoutKeys,
    ApiContentDividerBlockElement,
    ApiContentDividerBlockElementWithoutKeys,
    ApiContentFileBlockElement,
    ApiContentFileBlockElementWithoutKeys,
    ApiContentFileFloatBlockElement,
    ApiContentFileFloatBlockElementWithoutKeys,
    ApiContentFileGalleryBlockElement,
    ApiContentFileGalleryBlockElementRowItemWithoutKeys,
    ApiContentFileGalleryBlockElementRowWithoutKeys,
    ApiContentFileGalleryBlockElementWithoutKeys,
    ApiContentInlineElement,
    ApiContentListBlockElement,
    ApiContentListBlockElementItem,
    ApiContentListBlockElementItemWithoutKeys,
    ApiContentListBlockElementWithoutKeys,
    ApiContentOrderedListBlockElement,
    ApiContentParagraphBlockElement,
    ApiContentParagraphBlockElementWithoutKeys,
    ApiContentPreviewBlockElement,
    ApiContentPreviewBlockElementWithoutKeys,
    ApiContentQuoteBlockElementBlockElement,
    ApiContentQuoteBlockElementBlockElementWithoutKeys,
    ApiContentTableBlockElement,
    ApiContentTableBlockElementCellBlockElement,
    ApiContentTableBlockElementCellBlockElementWithoutKeys,
    ApiContentTableBlockElementCellWithoutKeys,
    ApiContentTableBlockElementRowWithoutKeys,
    ApiContentTableBlockElementWithoutKeys,
    ApiContentUnorderedListBlockElement,
    ApiContentWithoutKeys,
} from "~/shared/api/specification/types/api_specification_convenience_types.open_source.js";
import {InternalError} from "~/shared/error/error.open_source.js";
import {cast} from "~/shared/helpers/control/cast.open_source.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.open_source.js";
import {Result} from "~/shared/helpers/control/result.open_source.js";
import {omitObject} from "~/shared/helpers/object/omit_object.open_source.js";
import {quote} from "~/shared/helpers/string/quote.open_source.js";

type SliceContext = {
    readonly range: ApiContentRange;
    state: "Before" | "Inside" | "After";
};

export function sliceApiContentRange(
    content: ApiContent,
    range: ApiContentRange,
): Result<ApiContentWithoutKeys, "StartNotFound" | "EndNotFound"> {
    const context: SliceContext = {range, state: "Before"};

    const elements = sliceBlockElements(context, content.elements);

    if (elements === undefined) return {ok: false, error: "StartNotFound"};
    if (context.state !== "After") return {ok: false, error: "EndNotFound"};

    return {ok: true, value: {elements}};
}

function sliceBlockElements(
    context: SliceContext,
    elements: ReadonlyArray<ApiContentBlockElement>,
): Array<ApiContentBlockElementWithoutKeys> | undefined {
    let slicedElements: Array<ApiContentBlockElementWithoutKeys> | undefined;

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
    element: ApiContentBlockElement,
): ApiContentBlockElementWithoutKeys | undefined {
    switch (element.type) {
        case "Paragraph": {
            return sliceParagraphBlockElement(context, element);
        }
        case "Heading": {
            const elements = sliceInlineElements(context, element.key, element.elements);
            if (elements === undefined || elements.length === 0) return undefined;
            return {...omitObject(element, ["key"]), elements};
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
    element: ApiContentParagraphBlockElement,
): ApiContentParagraphBlockElementWithoutKeys | undefined {
    const elements = sliceInlineElements(context, element.key, element.elements);
    if (elements === undefined || elements.length === 0) return undefined;

    // We remove `key`s because a `key` for a sliced paragraph won't be valid anymore
    // since the start/end of the node is different.
    return {...omitObject(element, ["key"]), elements};
}

function sliceInlineElements(
    context: SliceContext,
    key: ApiContentKey,
    elements: ReadonlyArray<ApiContentInlineElement>,
): Array<ApiContentInlineElement> | undefined {
    let slicedElements: Array<ApiContentInlineElement> | undefined;
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
    elements: ReadonlyArray<ApiContentQuoteBlockElementBlockElement>,
): Array<ApiContentQuoteBlockElementBlockElementWithoutKeys> | undefined {
    let slicedElements: Array<ApiContentQuoteBlockElementBlockElementWithoutKeys> | undefined;

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
                        ApiContentBlockElement["type"],
                        ApiContentQuoteBlockElementBlockElement["type"]
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
        | ApiContentUnorderedListBlockElement
        | ApiContentOrderedListBlockElement
        | ApiContentCheckListBlockElement,
): ApiContentListBlockElementWithoutKeys | undefined {
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
    items: ReadonlyArray<ApiContentListBlockElementItem>,
): Array<ApiContentListBlockElementItemWithoutKeys> | undefined {
    let slicedItems: Array<ApiContentListBlockElementItemWithoutKeys> | undefined;

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
    elements: ReadonlyArray<ApiContentParagraphBlockElement>,
): Array<ApiContentParagraphBlockElementWithoutKeys> {
    const slicedElements: Array<ApiContentParagraphBlockElementWithoutKeys> = [];

    for (const element of elements) {
        if (context.state === "After") break;

        const slicedElement = sliceParagraphBlockElement(context, element);
        if (slicedElement !== undefined) slicedElements.push(slicedElement);
    }

    return slicedElements;
}

function sliceListBlockElements(
    context: SliceContext,
    elements: ReadonlyArray<ApiContentListBlockElement>,
): Array<ApiContentListBlockElementWithoutKeys> {
    const slicedElements: Array<ApiContentListBlockElementWithoutKeys> = [];

    for (const element of elements) {
        if (context.state === "After") break;

        const slicedElement = sliceListBlockElement(context, element);
        if (slicedElement !== undefined) slicedElements.push(slicedElement);
    }

    return slicedElements;
}

function sliceCheckListBlockElementItems(
    context: SliceContext,
    items: ReadonlyArray<ApiContentCheckListBlockElementItem>,
): Array<ApiContentCheckListBlockElementItemWithoutKeys> | undefined {
    let slicedItems: Array<ApiContentCheckListBlockElementItemWithoutKeys> | undefined;

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
    element: ApiContentCodeBlockElement,
): ApiContentCodeBlockElementWithoutKeys | undefined {
    let lines: Array<ApiContentCodeBlockElementLineWithoutKeys> | undefined;

    let previousLine: {line: ApiContentCodeBlockElementLine; length: number} | undefined;

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

            // We remove `key`s because a `key` for a sliced code line won't be valid anymore
            // since the start/end of the node is different.
            lines.push({...omitObject(previousLine.line, ["key"]), elements: []});
        }

        const lineElements = sliceCodeLineElements(context, line.key, line.elements);

        if (selectedBreak || lineElements.length > 0) {
            lines ??= [];

            // We remove `key`s because a `key` for a sliced code line won't be valid anymore
            // since the start/end of the node is different.
            lines.push({...omitObject(line, ["key"]), elements: lineElements});
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
    element: ApiContentDividerBlockElement,
): ApiContentDividerBlockElementWithoutKeys | undefined {
    if (
        consumeToken(context, {type: "Before", key: element.key}, {type: "After", key: element.key})
    ) {
        return omitObject(element, ["key"]);
    }

    return undefined;
}

function sliceFileOrPreviewBlockElement(
    context: SliceContext,
    element: ApiContentFileBlockElement | ApiContentPreviewBlockElement,
): ApiContentFileBlockElementWithoutKeys | ApiContentPreviewBlockElementWithoutKeys | undefined {
    if (
        consumeToken(context, {type: "Before", key: element.key}, {type: "After", key: element.key})
    ) {
        return omitObject(element, ["key"]);
    }

    return undefined;
}

function sliceFileGalleryBlockElement(
    context: SliceContext,
    element: ApiContentFileGalleryBlockElement,
): ApiContentFileGalleryBlockElementWithoutKeys | undefined {
    let rows: Array<ApiContentFileGalleryBlockElementRowWithoutKeys> | undefined;

    for (const row of element.rows) {
        if (context.state === "After") break;

        let items: Array<ApiContentFileGalleryBlockElementRowItemWithoutKeys> | undefined;

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
    element: ApiContentFileFloatBlockElement,
): ApiContentFileFloatBlockElementWithoutKeys | undefined {
    const slicedElement = sliceFileOrPreviewBlockElement(context, element.element);
    if (slicedElement === undefined) return undefined;
    return {...element, element: slicedElement};
}

function sliceTableBlockElement(
    context: SliceContext,
    element: ApiContentTableBlockElement,
): ApiContentTableBlockElementWithoutKeys | undefined {
    let rows: Array<ApiContentTableBlockElementRowWithoutKeys> | undefined;

    for (const row of element.rows) {
        if (context.state === "After") break;

        let cells: Array<ApiContentTableBlockElementCellWithoutKeys> | undefined;

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
    elements: ReadonlyArray<ApiContentTableBlockElementCellBlockElement>,
): Array<ApiContentTableBlockElementCellBlockElementWithoutKeys> | undefined {
    let slicedElements: Array<ApiContentTableBlockElementCellBlockElementWithoutKeys> | undefined;

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
                        ApiContentBlockElement["type"],
                        ApiContentTableBlockElementCellBlockElement["type"]
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
