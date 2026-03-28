import {sliceApiContentRange} from "~/shared/api/content/slice_api_content_range.js";
import {visitAndProduceApiContent} from "~/shared/api/content/visit_and_produce_api_content.js";
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
    ApiContentInlineElement,
    ApiContentInlineElementMark,
    ApiContentResponse,
} from "~/shared/api/specification/types/api_specification_convenience_types.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {DocumentCommentThreadId} from "~/shared/id/types/id_types.js";

/**
 * Takes `content` from an `ApiDocumentThread` and it slices out just the commented
 * content. Returns null if the comment isn't found in the content.
 */
export function extractCommentSliceFromApiContent(
    threadId: DocumentCommentThreadId,
    content: ApiContentResponse,
): {range: ApiContentRange; contentSlice: ApiContentResponse} | null {
    let range: {start: ApiContentPosition; end: ApiContentPosition} | null = null;

    for (const token of iterateApiContent(content)) {
        if (token.marks?.some(mark => mark.type === "Comment" && mark.thread.id === threadId)) {
            range ??= {start: token.position, end: token.endPosition};
            range.end = token.endPosition;
        } else if (range !== null) {
            // After we've started `range`, once we've found the last token that has the
            // comment mark then stop iterating since we've found the full commented content.
            break;
        }
    }

    if (range === null) return null;

    const contentSlice = sliceApiContentRange(content, range);
    assert(contentSlice.ok);

    return {
        range,
        contentSlice: visitAndProduceApiContent(contentSlice.value, {
            visitMark: (mark, {marks}) => {
                if (mark.type === "Comment" && mark.thread.id === threadId) {
                    const index = marks.indexOf(mark);
                    assert(index !== -1);
                    marks.splice(index, 1);
                }
            },
        }),
    };
}

type Token = {
    position: ApiContentInlinePosition | ApiContentBeforePosition;
    endPosition: ApiContentInlinePosition | ApiContentAfterPosition;
    marks: ReadonlyArray<ApiContentInlineElementMark> | undefined;
};

function* iterateApiContent(content: ApiContentResponse): IterableIterator<Token, undefined> {
    for (const element of content.elements) {
        yield* iterateApiContentBlockElement(element);
    }
}

function* iterateApiContentBlockElement(
    element: ApiContentBlockElementResponse,
): IterableIterator<Token, undefined> {
    switch (element.type) {
        case "Paragraph": {
            yield* iterateApiContentInlineElements(element.key, element.elements);
            break;
        }
        case "Heading": {
            yield* iterateApiContentInlineElements(element.key, element.elements);
            break;
        }
        case "Quote": {
            for (const childElement of element.elements) {
                yield* iterateApiContentBlockElement(childElement);
            }
            break;
        }
        case "UnorderedList":
        case "OrderedList": {
            for (let itemIndex = 0; itemIndex < element.items.length; itemIndex++) {
                const item = element.items[itemIndex]!;

                for (const childElement of item.elements) {
                    yield* iterateApiContentBlockElement(childElement);
                }

                if (item.nestedListElements) {
                    for (const nestedElement of item.nestedListElements) {
                        yield* iterateApiContentBlockElement(nestedElement);
                    }
                }
            }
            break;
        }
        case "CheckList": {
            for (let itemIndex = 0; itemIndex < element.items.length; itemIndex++) {
                const item = element.items[itemIndex]!;

                for (const childElement of item.elements) {
                    yield* iterateApiContentBlockElement(childElement);
                }

                if (item.nestedListElements) {
                    for (const nestedElement of item.nestedListElements) {
                        yield* iterateApiContentBlockElement(nestedElement);
                    }
                }
            }
            break;
        }
        case "Code": {
            for (const line of element.lines) {
                yield* iterateApiContentInlineElements(line.key, line.elements);
            }
            break;
        }
        case "Divider": {
            yield {
                position: {type: "Before", key: element.key},
                endPosition: {type: "After", key: element.key},
                marks: undefined,
            };
            break;
        }
        case "File":
        case "Preview": {
            yield {
                position: {type: "Before", key: element.key},
                endPosition: {type: "After", key: element.key},
                marks: element.marks,
            };
            break;
        }
        case "FileGallery": {
            for (const row of element.rows) {
                for (const {element: childElement} of row.items) {
                    yield {
                        position: {type: "Before", key: childElement.key},
                        endPosition: {type: "After", key: childElement.key},
                        marks: childElement.marks,
                    };
                }
            }
            break;
        }
        case "FileFloat": {
            yield {
                position: {type: "Before", key: element.element.key},
                endPosition: {type: "After", key: element.element.key},
                marks: element.element.marks,
            };
            break;
        }
        case "Table": {
            for (const row of element.rows) {
                for (const cell of row.cells) {
                    for (const childElement of cell.elements) {
                        yield* iterateApiContentBlockElement(childElement);
                    }
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
    elements: ReadonlyArray<ApiContentInlineElement>,
): IterableIterator<Token, undefined> {
    let index = 0;

    for (const element of elements) {
        switch (element.type) {
            case "Text": {
                yield {
                    position: {type: "Inline", key, index},
                    endPosition: {type: "Inline", key, index: index + element.text.length},
                    marks: element.marks,
                };
                index += element.text.length;
                break;
            }
            case "Break":
            case "Mention": {
                yield {
                    position: {type: "Inline", key, index},
                    endPosition: {type: "Inline", key, index: index + 1},
                    marks: element.marks,
                };
                index++;
                break;
            }
            default:
                throw exhaustive(element);
        }
    }
}
