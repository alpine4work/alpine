import {ApiContentKey} from "~/shared/api/specification/types/api_content_key.js";
import {
    ApiContentAfterPosition,
    ApiContentBeforePosition,
    ApiContentInlinePosition,
    ApiContentRange,
} from "~/shared/api/specification/types/api_content_position.js";
import {
    ApiContentBlockElementResponse,
    ApiContentCodeBlockElementResponse,
    ApiContentInlineElementResponse,
    ApiContentResponse,
} from "~/shared/api/specification/types/api_specification_convenience_types.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";

/**
 * Returns the `ApiContentRange` which spans all of `content`. So
 * `sliceApiContentRange()` with the returned range will select all of the
 * sliceable content.
 *
 * Returns null if the content is empty and so has no spannable range. Empty
 * paragraphs at the start or end of the content are not included in the range
 * since a range can't be anchored inside an empty text block.
 */
export function getApiContentRangeSpanningContent(
    content: ApiContentResponse,
): ApiContentRange | null {
    let start: ApiContentInlinePosition | ApiContentBeforePosition | null = null;
    let end: ApiContentInlinePosition | ApiContentAfterPosition | null = null;

    for (const token of iterateApiContentBlockElements(content.elements)) {
        start ??= token.startPosition;
        end = token.endPosition;
    }

    if (start === null || end === null) return null;
    return {start, end};
}

type Token = {
    startPosition: ApiContentInlinePosition | ApiContentBeforePosition;
    endPosition: ApiContentInlinePosition | ApiContentAfterPosition;
};

function* iterateApiContentBlockElements(
    elements: ReadonlyArray<ApiContentBlockElementResponse>,
): IterableIterator<Token, undefined> {
    for (const element of elements) {
        yield* iterateApiContentBlockElement(element);
    }
}

function* iterateApiContentBlockElement(
    element: ApiContentBlockElementResponse,
): IterableIterator<Token, undefined> {
    switch (element.type) {
        case "Paragraph":
        case "Heading": {
            yield* iterateApiContentInlineElements(element.key, element.elements);
            break;
        }
        case "Quote": {
            yield* iterateApiContentBlockElements(element.elements);
            break;
        }
        case "UnorderedList":
        case "OrderedList":
        case "CheckList": {
            for (const item of element.items) {
                yield* iterateApiContentBlockElements(item.elements);

                if (item.nestedListElements) {
                    yield* iterateApiContentBlockElements(item.nestedListElements);
                }
            }
            break;
        }
        case "Code": {
            yield* iterateApiContentCodeBlockElement(element);
            break;
        }
        case "Divider":
        case "File":
        case "Preview": {
            yield {
                startPosition: {type: "Before", key: element.key},
                endPosition: {type: "After", key: element.key},
            };
            break;
        }
        case "FileGallery": {
            for (const row of element.rows) {
                for (const item of row.items) {
                    yield {
                        startPosition: {type: "Before", key: item.element.key},
                        endPosition: {type: "After", key: item.element.key},
                    };
                }
            }
            break;
        }
        case "FileFloat": {
            yield {
                startPosition: {type: "Before", key: element.element.key},
                endPosition: {type: "After", key: element.element.key},
            };
            break;
        }
        case "Table": {
            for (const row of element.rows) {
                for (const cell of row.cells) {
                    yield* iterateApiContentBlockElements(cell.elements);
                }
            }
            break;
        }
        default:
            throw exhaustive(element);
    }
}

function* iterateApiContentInlineElements(
    key: ApiContentKey,
    elements: ReadonlyArray<ApiContentInlineElementResponse>,
): IterableIterator<Token, undefined> {
    let index = 0;

    for (const element of elements) {
        switch (element.type) {
            case "Text": {
                yield {
                    startPosition: {type: "Inline", key, index},
                    endPosition: {type: "Inline", key, index: index + element.text.length},
                };
                index += element.text.length;
                break;
            }
            case "Break":
            case "Mention": {
                yield {
                    startPosition: {type: "Inline", key, index},
                    endPosition: {type: "Inline", key, index: index + 1},
                };
                index++;
                break;
            }
            default:
                throw exhaustive(element);
        }
    }
}

function* iterateApiContentCodeBlockElement(
    element: ApiContentCodeBlockElementResponse,
): IterableIterator<Token, undefined> {
    let previousLine: {key: ApiContentKey; length: number} | null = null;

    for (const line of element.lines) {
        // The line break between two code lines is itself a token. Matching how
        // `sliceApiContentRange()` selects code line breaks.
        if (previousLine !== null) {
            yield {
                startPosition: {type: "Inline", key: previousLine.key, index: previousLine.length},
                endPosition: {type: "Inline", key: line.key, index: 0},
            };
        }

        let index = 0;

        for (const lineElement of line.elements) {
            yield {
                startPosition: {type: "Inline", key: line.key, index},
                endPosition: {
                    type: "Inline",
                    key: line.key,
                    index: index + lineElement.text.length,
                },
            };
            index += lineElement.text.length;
        }

        previousLine = {key: line.key, length: index};
    }
}
