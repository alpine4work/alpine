import {ApiContentKeyEncoder} from "~/shared/api/content/closed_source/api_content_key_encoder.js";
import {
    ApiContentBlockElementResponseWithoutKeys,
    ApiContentCheckListBlockElementItemResponseWithoutKeys,
    ApiContentCodeBlockElementLineResponseWithoutKeys,
    ApiContentFileBlockElementResponseWithoutKeys,
    ApiContentHeadingBlockElementResponseWithoutKeys,
    ApiContentListBlockElementItemResponseWithoutKeys,
    ApiContentListBlockElementResponseWithoutKeys,
    ApiContentParagraphBlockElementResponseWithoutKeys,
    ApiContentPreviewBlockElementResponseWithoutKeys,
    ApiContentResponseWithoutKeys,
} from "~/shared/api/specification/types/api_content_response_without_keys.js";
import {
    ApiContentBlockElementResponse,
    ApiContentCheckListBlockElementItemResponse,
    ApiContentFileBlockElementResponse,
    ApiContentInlineElementResponse,
    ApiContentListBlockElementItemResponse,
    ApiContentListBlockElementResponse,
    ApiContentParagraphBlockElementResponse,
    ApiContentPreviewBlockElementResponse,
    ApiContentQuoteBlockElementBlockElementResponse,
    ApiContentResponse,
    ApiContentTableBlockElementCellBlockElementResponse,
} from "~/shared/api/specification/types/api_specification_convenience_types.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";

type ApiContentFileOrPreviewBlockElementResponseWithoutKeys =
    | ApiContentFileBlockElementResponseWithoutKeys
    | ApiContentPreviewBlockElementResponseWithoutKeys;

type ApiContentPositionState = {
    pos: number;
};

/**
 * Add `ApiContentKey`s that match what you'd get from `intoApiContent()`. Useful
 * if you need to create an `ApiContentResponse` object in a test and you don't
 * have the underlying ProseMirror content.
 */
export function addKeysToApiContentForTest(
    content: ApiContentResponseWithoutKeys,
    {
        // We recommend these dummy options for tests since it doesn't matter for the keys
        // to be exactly accurate in most tests and having deterministic keys across test
        // runs is useful for debugging,
        entityId = "Test",
        version = 0,
    }: {
        entityId?: string;
        version?: number;
    } = {},
): ApiContentResponse {
    assert(process.env.NODE_ENV === "test");

    const encoder = new ApiContentKeyEncoder({entityId, version});

    const state: ApiContentPositionState = {pos: 0};

    return {
        elements: addKeysToApiContentBlockElements(encoder, content.elements, state),
    };
}

function addKeysToApiContentBlockElements(
    encoder: ApiContentKeyEncoder,
    elements: ReadonlyArray<ApiContentBlockElementResponseWithoutKeys>,
    state: ApiContentPositionState,
): Array<ApiContentBlockElementResponse> {
    return elements.map(element => addKeysToApiContentBlockElement(encoder, element, state));
}

function addKeysToApiContentBlockElement(
    encoder: ApiContentKeyEncoder,
    element: ApiContentBlockElementResponseWithoutKeys,
    state: ApiContentPositionState,
): ApiContentBlockElementResponse {
    switch (element.type) {
        case "Paragraph":
            return addKeysToApiContentParagraphBlockElement(encoder, element, state);
        case "UnorderedList":
        case "OrderedList":
        case "CheckList":
            return addKeysToApiContentListBlockElement(encoder, element, state);
        case "Quote": {
            state.pos += 1;

            const elements = addKeysToApiContentBlockElements(
                encoder,
                element.elements,
                state,
            ) as Array<ApiContentQuoteBlockElementBlockElementResponse>;

            state.pos += 1;

            return {...element, elements};
        }
        case "Heading":
            return addKeysToApiContentHeadingBlockElement(encoder, element, state);
        case "Divider": {
            const nodePos = state.pos;
            const nodeSize = 1;
            state.pos += nodeSize;

            return {
                ...element,
                key: encoder.encode({pos: nodePos, nodeSize, inlineContent: false}),
            };
        }
        case "Table": {
            state.pos += 1;

            const rows = element.rows.map(row => {
                state.pos += 1;

                const cells = row.cells.map(cell => {
                    state.pos += 1;

                    const elements = addKeysToApiContentBlockElements(
                        encoder,
                        cell.elements,
                        state,
                    ) as Array<ApiContentTableBlockElementCellBlockElementResponse>;

                    state.pos += 1;

                    return {...cell, elements};
                });

                state.pos += 1;

                return {...row, cells};
            });

            state.pos += 1;

            return {...element, rows};
        }
        case "Code": {
            state.pos += 1;

            const lines = element.lines.map(line => {
                const linePos = state.pos;
                const nodeSize = getApiContentCodeBlockElementLineNodeSize(line);
                state.pos += nodeSize;

                return {
                    ...line,
                    key: encoder.encode({pos: linePos, nodeSize, inlineContent: true}),
                };
            });

            state.pos += 1;

            return {...element, lines};
        }
        case "File":
        case "Preview": {
            const nodePos = state.pos;
            const keyedElement = addKeyToApiContentFileOrPreviewBlockElement(
                encoder,
                element,
                nodePos + 1,
            );
            state.pos = nodePos + 3;
            return keyedElement;
        }
        case "FileGallery": {
            const rows = element.rows.map(row => {
                state.pos += 1;

                const items = row.items.map(item => {
                    const itemPos = state.pos;
                    state.pos += 1;

                    return {
                        ...item,
                        element: addKeyToApiContentFileOrPreviewBlockElement(
                            encoder,
                            item.element,
                            itemPos,
                        ),
                    };
                });

                state.pos += 1;

                return {...row, items};
            });

            return {...element, rows};
        }
        case "FileFloat": {
            const nodePos = state.pos;
            const fileElement = addKeyToApiContentFileOrPreviewBlockElement(
                encoder,
                element.element,
                nodePos + 1,
            );
            state.pos = nodePos + 3;

            return {...element, element: fileElement};
        }
        default:
            throw exhaustive(element);
    }
}

function addKeysToApiContentParagraphBlockElements(
    encoder: ApiContentKeyEncoder,
    elements: ReadonlyArray<ApiContentParagraphBlockElementResponseWithoutKeys>,
    state: ApiContentPositionState,
): Array<ApiContentParagraphBlockElementResponse> {
    return elements.map(element =>
        addKeysToApiContentParagraphBlockElement(encoder, element, state),
    );
}

function addKeysToApiContentParagraphBlockElement(
    encoder: ApiContentKeyEncoder,
    element: ApiContentParagraphBlockElementResponseWithoutKeys,
    state: ApiContentPositionState,
): ApiContentParagraphBlockElementResponse {
    const nodePos = state.pos;
    const nodeSize = getApiContentInlineElementsNodeSize(element.elements) + 2;
    state.pos += nodeSize;

    return {...element, key: encoder.encode({pos: nodePos, nodeSize, inlineContent: true})};
}

function addKeysToApiContentHeadingBlockElement(
    encoder: ApiContentKeyEncoder,
    element: ApiContentHeadingBlockElementResponseWithoutKeys,
    state: ApiContentPositionState,
) {
    const nodePos = state.pos;
    const nodeSize = getApiContentInlineElementsNodeSize(element.elements) + 2;
    state.pos += nodeSize;

    return {...element, key: encoder.encode({pos: nodePos, nodeSize, inlineContent: true})};
}

function addKeysToApiContentListBlockElements(
    encoder: ApiContentKeyEncoder,
    elements: ReadonlyArray<ApiContentListBlockElementResponseWithoutKeys>,
    state: ApiContentPositionState,
): Array<ApiContentListBlockElementResponse> {
    return elements.map(element => addKeysToApiContentListBlockElement(encoder, element, state));
}

function addKeysToApiContentListBlockElement(
    encoder: ApiContentKeyEncoder,
    element: ApiContentListBlockElementResponseWithoutKeys,
    state: ApiContentPositionState,
): ApiContentListBlockElementResponse {
    switch (element.type) {
        case "UnorderedList":
        case "OrderedList": {
            const items = element.items.map(item =>
                addKeysToApiContentListBlockElementItem(encoder, item, state),
            );

            return {...element, items};
        }
        case "CheckList": {
            const items = element.items.map(item =>
                addKeysToApiContentCheckListBlockElementItem(encoder, item, state),
            );

            return {...element, items};
        }
        default:
            throw exhaustive(element);
    }
}

function addKeysToApiContentListBlockElementItem(
    encoder: ApiContentKeyEncoder,
    item: ApiContentListBlockElementItemResponseWithoutKeys,
    state: ApiContentPositionState,
): ApiContentListBlockElementItemResponse {
    const itemPos = state.pos;
    state.pos = itemPos + 1;

    const elements = addKeysToApiContentParagraphBlockElements(encoder, item.elements, state);

    if (elements.length > 0) {
        state.pos += 1;
    } else {
        state.pos = itemPos;
    }

    const nestedListElements =
        item.nestedListElements !== undefined
            ? addKeysToApiContentListBlockElements(encoder, item.nestedListElements, state)
            : undefined;

    return {
        elements,
        ...(nestedListElements !== undefined ? {nestedListElements} : {}),
    };
}

function addKeysToApiContentCheckListBlockElementItem(
    encoder: ApiContentKeyEncoder,
    item: ApiContentCheckListBlockElementItemResponseWithoutKeys,
    state: ApiContentPositionState,
): ApiContentCheckListBlockElementItemResponse {
    const itemPos = state.pos;
    state.pos = itemPos + 1;

    const elements = addKeysToApiContentParagraphBlockElements(encoder, item.elements, state);

    if (elements.length > 0) {
        state.pos += 1;
    } else {
        state.pos = itemPos;
    }

    const nestedListElements =
        item.nestedListElements !== undefined
            ? addKeysToApiContentListBlockElements(encoder, item.nestedListElements, state)
            : undefined;

    return {
        checked: item.checked,
        elements,
        ...(nestedListElements !== undefined ? {nestedListElements} : {}),
    };
}

function addKeyToApiContentFileOrPreviewBlockElement(
    encoder: ApiContentKeyEncoder,
    element: ApiContentFileOrPreviewBlockElementResponseWithoutKeys,
    pos: number,
): ApiContentFileBlockElementResponse | ApiContentPreviewBlockElementResponse {
    const key = encoder.encode({pos, nodeSize: 1, inlineContent: false});

    switch (element.type) {
        case "File":
        case "Preview":
            return {...element, key};
        default:
            throw exhaustive(element);
    }
}

function getApiContentInlineElementsNodeSize(
    elements: ReadonlyArray<ApiContentInlineElementResponse>,
): number {
    let nodeSize = 0;

    for (const element of elements) {
        switch (element.type) {
            case "Text":
                nodeSize += element.text.length;
                break;
            case "Break":
            case "Mention":
                nodeSize += 1;
                break;
            default:
                throw exhaustive(element);
        }
    }

    return nodeSize;
}

function getApiContentCodeBlockElementLineNodeSize(
    line: ApiContentCodeBlockElementLineResponseWithoutKeys,
): number {
    return getApiContentCodeBlockElementLineInlineNodeSize(line.elements) + 2;
}

function getApiContentCodeBlockElementLineInlineNodeSize(
    elements: ApiContentCodeBlockElementLineResponseWithoutKeys["elements"],
): number {
    let nodeSize = 0;

    for (const element of elements) {
        nodeSize += element.text.length;
    }

    return nodeSize;
}
