import {Mark, Node} from "prosemirror-model";
import {ApiContentKeyEncoder} from "~/shared/api/content/closed_source/api_content_key_encoder.js";
import {computeApiContentFileRowWidths} from "~/shared/api/content/closed_source/compute_api_content_file_row_widths.js";
import {intoApiTaskStatus} from "~/shared/api/content/closed_source/into_api_task_status.js";
import {unknownFileId} from "~/shared/api/content/closed_source/unknown_file_id.js";
import {getApiMentionReferenceNoun} from "~/shared/api/content/get_api_mention_reference_noun.js";
import {normalizeApiContentInlineElementMarks} from "~/shared/api/content/normalize_api_content.js";
import type {ApiContentKey} from "~/shared/api/specification/types/api_content_key.js";
import {
    ApiContentBlockElementResponseWithOptionalKeys,
    ApiContentCheckListBlockElementItemResponseWithOptionalKeys,
    ApiContentFileBlockElementResponseWithOptionalKeys,
    ApiContentListBlockElementItemResponseWithOptionalKeys,
    ApiContentListBlockElementResponseWithOptionalKeys,
    ApiContentParagraphBlockElementResponseWithOptionalKeys,
    ApiContentPreviewBlockElementResponseWithOptionalKeys,
    ApiContentResponseWithOptionalKeys,
    ApiContentResponseWithoutKeys,
    ApiContentTableBlockElementCellResponseWithOptionalKeys,
    ApiContentTableBlockElementRowResponseWithOptionalKeys,
} from "~/shared/api/specification/types/api_content_response_without_keys.js";
import {
    ApiContentBlockElementResponse,
    ApiContentCheckListBlockElementItemResponse,
    ApiContentCommentMark,
    ApiContentHighlightMarkColor,
    ApiContentInlineElementMark,
    ApiContentInlineElementResponse,
    ApiContentListBlockElementItemResponse,
    ApiContentResponse,
    ApiMentionReferenceResponse,
    ApiMessageContentPayloadParentContentSnippetInlineElementMark,
    ApiPreviewReferenceResponse,
} from "~/shared/api/specification/types/api_specification_convenience_types.js";
import {ContentMention} from "~/shared/content/content_mention.js";
import {
    ContentBlockNodeTypeName,
    ContentInlineNodeTypeName,
    ContentListItemNodeTypeName,
    ContentMarkTypeName,
} from "~/shared/content/content_node_type_name.js";
import {clampHeadingLevel} from "~/shared/content/content_schema.js";
import {HighlightColor} from "~/shared/design/core/highlight_color.js";
import {InternalError} from "~/shared/error/error.js";
import {isFileEntityId, parseFileEntityId} from "~/shared/files/file_entity_id.js";
import {FileModelData} from "~/shared/files/file_model.js";
import {createArrayWithLength} from "~/shared/helpers/array/create_array_with_length.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {quote} from "~/shared/helpers/string/quote.js";
import {Replace} from "~/shared/helpers/types/replace.js";
import {isId} from "~/shared/id/id.js";
import {AccountId, FileId, TaskId} from "~/shared/id/types/id_types.js";
import {
    SearchMentionEntityId,
    parseSearchMentionEntityId,
} from "~/shared/search/search_entity_id.js";
import {TaskDisplayStatus} from "~/shared/tasks/task_display_status.js";

export type ApiContentMarkdownIntoOptions = {
    readonly getAccountMentionTitleIfExists: (
        accountId: AccountId,
        options: {isShort: boolean},
    ) => string | undefined;
    readonly getSearchEntityMentionTitleIfExists: (
        entityId: SearchMentionEntityId,
    ) => string | undefined;
    readonly getSearchTaskEntityDisplayStatusIfExists: (
        taskId: TaskId,
    ) => TaskDisplayStatus | undefined;
    readonly getFileIfExists: (fileId: FileId) => FileModelData | undefined;
    readonly encoder: ApiContentKeyEncoder;
    readonly posOffset?: number;
};

export type ApiContentMarkdownIntoOptionsWithoutKeys = Replace<
    ApiContentMarkdownIntoOptions,
    {
        readonly encoder?: ApiContentKeyEncoder;
        readonly posOffset?: number;
    }
>;

type ApiContentMarkdownIntoContext = Replace<
    ApiContentMarkdownIntoOptions,
    {
        readonly rootNode: Node;
        readonly posOffset: number;
        readonly encoder: ApiContentKeyEncoder | undefined;
    }
>;

/**
 * Converts content with required entity context and guarantees content keys on
 * paragraphs, headings, and code block lines in the returned API content.
 */
export function intoApiContent(
    node: Node,
    options: ApiContentMarkdownIntoOptions,
): ApiContentResponse;
/**
 * Converts content without entity context and omits content keys from the returned
 * paragraphs, headings, and code block lines.
 */
export function intoApiContent(
    node: Node,
    options: ApiContentMarkdownIntoOptionsWithoutKeys,
): ApiContentResponseWithoutKeys;
export function intoApiContent(
    node: Node,
    options: ApiContentMarkdownIntoOptions | ApiContentMarkdownIntoOptionsWithoutKeys,
): ApiContentResponseWithoutKeys | ApiContentResponse {
    assert(node.type.name === "doc");
    const posOffset = options.posOffset ?? 0;
    assert(posOffset >= 0);

    const context: ApiContentMarkdownIntoContext = {
        ...options,
        rootNode: node,
        posOffset,
        encoder: options.encoder,
    };

    const apiContent: ApiContentResponseWithOptionalKeys = {
        elements: Array.from(intoApiContentBlockElements(context, node.content.content, posOffset)),
    };

    if (context.encoder !== undefined) {
        assertApiContentResponseHasKeys(apiContent);
        return apiContent;
    }

    return apiContent;
}

type ApiContentListBlockElementWorkingItem =
    | ApiContentListBlockElementRealWorkingItem
    | ApiContentListBlockElementPhantomWorkingItem;

type ApiContentListBlockElementRealWorkingItem = {
    node: Node;
    pos: number;
    items: Array<ApiContentListBlockElementWorkingItem>;
};

/**
 * Private structural placeholder for floating indented list items.
 *
 * Alpine stores list items as flat ProseMirror siblings with an `indent` attr.
 * That means valid content can start at `indent: 2`, or jump from `indent: 1` to
 * `indent: 3`, without real parent nodes for the missing levels. API content is
 * nested, so we synthesize phantom parent items to preserve that shape.
 *
 * These phantom items do not correspond to source ProseMirror nodes and must not
 * carry positions or content keys. Keep this `null` state inside the private
 * working tree; real list items must always have a concrete `pos`.
 */
type ApiContentListBlockElementPhantomWorkingItem = {
    node: null;
    pos: null;
    items: Array<ApiContentListBlockElementWorkingItem>;
};

/**
 * Converts sibling ProseMirror block nodes into API block elements while tracking
 * absolute positions for keyed text containers.
 */
function* intoApiContentBlockElements(
    context: ApiContentMarkdownIntoContext,
    nodes: ReadonlyArray<Node>,
    startPos: number,
): IterableIterator<ApiContentBlockElementResponseWithOptionalKeys> {
    let nodeIndex = 0;
    // Track each sibling's absolute ProseMirror start position. Encoded content keys
    // use that position so API ranges can resolve back into the document.
    let nodePos = startPos;
    while (nodeIndex < nodes.length) {
        const node = nodes[nodeIndex]!;
        const currentNodePos = nodePos;
        nodeIndex++;
        nodePos += node.nodeSize;

        if (node.type.name === "title") {
            // Ignore document title nodes. Document titles will be handled separately.
            continue;
        }

        const typeName = node.type.name as ContentBlockNodeTypeName;

        switch (typeName) {
            case "unorderedListItem":
            case "orderedListItem":
            case "checkListItem": {
                const items: Array<ApiContentListBlockElementWorkingItem> = [];

                // Make sure the while loop below sees the current node.
                nodeIndex--;
                nodePos -= node.nodeSize;

                while (nodeIndex < nodes.length) {
                    const listItemNode = nodes[nodeIndex]!;
                    const listItemPos = nodePos;
                    if (!listItemNode.type.groups.includes("listItem")) break;
                    nodeIndex++;
                    nodePos += listItemNode.nodeSize;

                    const indent: number = listItemNode.attrs.indent;
                    let indentedItems: Array<ApiContentListBlockElementWorkingItem> = items;

                    // ProseMirror stores nested list items as indented siblings. Build a tree first so
                    // the API can emit nested list elements.
                    for (let i = 0; i < indent; i++) {
                        if (indentedItems.length === 0) {
                            const phantomItem: ApiContentListBlockElementPhantomWorkingItem = {
                                node: null,
                                pos: null,
                                items: [],
                            };
                            indentedItems.push(phantomItem);
                            indentedItems = phantomItem.items;
                        } else {
                            indentedItems = indentedItems[indentedItems.length - 1]!.items;
                        }
                    }

                    indentedItems.push({
                        node: listItemNode,
                        pos: listItemPos,
                        items: [],
                    });
                }

                yield* intoApiContentListBlockElements(context, items);
                break;
            }
            case "fileRow": {
                // Merge adjacent fileRow nodes into a single FileGallery.
                const rows: Array<{
                    items: Array<{
                        width: number;
                        element:
                            | ApiContentFileBlockElementResponseWithOptionalKeys
                            | ApiContentPreviewBlockElementResponseWithOptionalKeys;
                    }>;
                }> = [];

                // Back up to include the current node.
                nodeIndex--;
                nodePos -= node.nodeSize;

                while (nodeIndex < nodes.length) {
                    const fileRowNode = nodes[nodeIndex]!;
                    if (fileRowNode.type.name !== "fileRow") break;
                    nodeIndex++;
                    nodePos++;

                    const rowElements = fileRowNode.content.content.map(child => {
                        const element = intoApiContentFileOrPreviewElement(context, child, nodePos);
                        nodePos += child.nodeSize;
                        return element;
                    });

                    nodePos++;

                    if (rowElements.length > 0) {
                        const widths = computeApiContentFileRowWidths(rowElements, context);
                        rows.push({
                            items: rowElements.map((element, i) => ({
                                width: widths[i]!,
                                element,
                            })),
                        });
                    }
                }

                if (rows.length === 0) {
                    throw new InternalError("File row must contain at least one file");
                }

                // Single row with single element unwraps to a standalone element.
                if (rows.length === 1 && rows[0]!.items.length === 1) {
                    yield assertExists(rows[0]!.items[0]).element;
                } else {
                    yield {
                        type: "FileGallery",
                        rows,
                    };
                }
                break;
            }
            default:
                yield intoApiContentBlockElement(context, typeName, node, currentNodePos);
                break;
        }
    }
}

/**
 * Converts the normalized list item tree into API list block elements.
 */
function* intoApiContentListBlockElements(
    context: ApiContentMarkdownIntoContext,
    items: Array<ApiContentListBlockElementWorkingItem>,
): IterableIterator<ApiContentListBlockElementResponseWithOptionalKeys> {
    let lastElement:
        | {
              type: "UnorderedList";
              items: Array<ApiContentListBlockElementItemResponseWithOptionalKeys>;
          }
        | {
              type: "OrderedList";
              orderStart?: number;
              items: Array<ApiContentListBlockElementItemResponseWithOptionalKeys>;
          }
        | {
              type: "CheckList";
              items: Array<ApiContentCheckListBlockElementItemResponseWithOptionalKeys>;
          }
        | null = null;

    for (const item of items) {
        const typeName = item.node?.type.name as ContentListItemNodeTypeName | undefined;

        // A list item's child content starts one position inside the item wrapper, which
        // is where nested paragraph keys should be rooted.
        const elements: Array<ApiContentParagraphBlockElementResponseWithOptionalKeys> =
            item.node !== null
                ? Array.from(
                      intoApiContentBlockElements(context, item.node.content.content, item.pos + 1),
                      element => {
                          if (element.type !== "Paragraph") {
                              throw new InternalError(
                                  quote`${element.type} block element isn\u2019t supported in list block element item`,
                              );
                          }
                          return element;
                      },
                  )
                : [];

        // The `item.node !== null` guard filters out internal phantom list items. Phantom
        // items preserve nested API shape for floating indents, but they do not correspond
        // to source ProseMirror nodes or content keys.
        if (item.node !== null && elements.length === 0) {
            const key = maybeEncodeApiContentKey(context, item.pos, item.node);
            const element = {
                type: "Paragraph" as const,
                ...(key !== undefined ? {key} : {}),
                elements: [],
            };
            elements.push(element);
        }

        const nestedListElements =
            item.items.length > 0
                ? Array.from(intoApiContentListBlockElements(context, item.items))
                : undefined;

        switch (typeName) {
            case undefined:
            case "unorderedListItem": {
                const elementItem: ApiContentListBlockElementItemResponseWithOptionalKeys = {
                    elements,
                    ...(nestedListElements !== undefined ? {nestedListElements} : {}),
                };

                if (lastElement?.type === "UnorderedList") {
                    lastElement.items.push(elementItem);
                } else {
                    if (lastElement !== null) yield lastElement;

                    lastElement = {
                        type: "UnorderedList",
                        items: [elementItem],
                    };
                }
                break;
            }
            case "orderedListItem": {
                const elementItem: ApiContentListBlockElementItemResponseWithOptionalKeys = {
                    elements,
                    ...(nestedListElements !== undefined ? {nestedListElements} : {}),
                };

                const itemOrderStart = item.node?.attrs.orderStart ?? undefined;

                // "Merge" the list item into the last element if
                //
                // 1. The last element is an ordered list
                // 2. The current list item has no explicit `orderStart` attribute.
                if (lastElement?.type === "OrderedList" && itemOrderStart === undefined) {
                    lastElement.items.push(elementItem);
                } else {
                    if (lastElement !== null) yield lastElement;

                    lastElement = {
                        type: "OrderedList",
                        ...(itemOrderStart !== undefined ? {orderStart: itemOrderStart} : {}),
                        items: [elementItem],
                    };
                }
                break;
            }
            case "checkListItem": {
                const elementItem: ApiContentCheckListBlockElementItemResponseWithOptionalKeys = {
                    checked: item.node?.attrs.checked ?? false,
                    elements,
                    ...(nestedListElements !== undefined ? {nestedListElements} : {}),
                };

                if (lastElement?.type === "CheckList") {
                    lastElement.items.push(elementItem);
                } else {
                    if (lastElement !== null) yield lastElement;

                    lastElement = {
                        type: "CheckList",
                        items: [elementItem],
                    };
                }
                break;
            }
            default:
                throw exhaustive(typeName);
        }
    }

    if (lastElement !== null) yield lastElement;
}

function intoApiContentBlockElement(
    context: ApiContentMarkdownIntoContext,
    typeName: Exclude<
        ContentBlockNodeTypeName,
        "unorderedListItem" | "orderedListItem" | "checkListItem" | "fileRow"
    >,
    node: Node,
    nodePos: number,
): ApiContentBlockElementResponseWithOptionalKeys {
    switch (typeName) {
        case "paragraph": {
            const elements = intoApiContentInlineElements(context, node.content.content);
            const key = maybeEncodeApiContentKey(context, nodePos, node);

            return {
                type: "Paragraph",
                ...(key !== undefined ? {key} : {}),
                elements,
            };
        }
        case "quoteBlock": {
            return {
                type: "Quote",
                elements: Array.from(
                    intoApiContentBlockElements(context, node.content.content, nodePos + 1),
                    element => {
                        switch (element.type) {
                            case "Paragraph":
                            case "UnorderedList":
                            case "OrderedList":
                            case "CheckList": {
                                return element;
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
                                throw new InternalError(
                                    quote`${element.type} block element isn\u2019t supported in \`Quote\` block element`,
                                );
                            }
                            default:
                                throw exhaustive(element);
                        }
                    },
                ),
            };
        }
        case "heading": {
            const elements = intoApiContentInlineElements(context, node.content.content);
            const key = maybeEncodeApiContentKey(context, nodePos, node);

            return {
                type: "Heading",
                ...(key !== undefined ? {key} : {}),
                level: clampHeadingLevel(node.attrs.level),
                elements,
            };
        }
        case "divider": {
            const key = maybeEncodeApiContentKey(context, nodePos, node);

            return {
                type: "Divider",
                ...(key !== undefined ? {key} : {}),
            };
        }
        case "table": {
            let columnWidth = 2;
            // Rows and cells are wrapper nodes. Advance through their sizes so child block
            // keys point at positions inside the correct cell.
            let rowPos = nodePos + 1;

            const rows = node.content.content.map(
                (rowNode): ApiContentTableBlockElementRowResponseWithOptionalKeys => {
                    assert(rowNode.type.name === "tableRow");
                    const currentRowPos = rowPos;
                    rowPos += rowNode.nodeSize;

                    columnWidth = Math.max(columnWidth, rowNode.content.content.length);
                    let cellPos = currentRowPos + 1;

                    return {
                        cells: rowNode.content.content.map(
                            (cellNode): ApiContentTableBlockElementCellResponseWithOptionalKeys => {
                                assert(cellNode.type.name === "tableCell");
                                const currentCellPos = cellPos;
                                cellPos += cellNode.nodeSize;

                                return {
                                    elements: Array.from(
                                        intoApiContentBlockElements(
                                            context,
                                            cellNode.content.content,
                                            currentCellPos + 1,
                                        ),
                                        element => {
                                            switch (element.type) {
                                                case "Paragraph":
                                                case "UnorderedList":
                                                case "OrderedList":
                                                case "Quote":
                                                case "CheckList":
                                                case "Code":
                                                case "File":
                                                case "Preview": {
                                                    return element;
                                                }
                                                case "Table":
                                                case "Heading":
                                                case "Divider":
                                                case "FileGallery":
                                                case "FileFloat": {
                                                    throw new InternalError(
                                                        quote`${element.type} block element isn\u2019t supported in \`Table\` block element`,
                                                    );
                                                }
                                                default:
                                                    throw exhaustive(element);
                                            }
                                        },
                                    ),
                                };
                            },
                        ),
                    };
                },
            );

            return {
                type: "Table",
                width: node.attrs.tableWidth,
                ...(node.attrs.hasHeaderRow === true ? {hasHeaderRow: true} : {}),
                ...(node.attrs.hasHeaderColumn === true ? {hasHeaderColumn: true} : {}),
                columns: createArrayWithLength(columnWidth, index => ({
                    width: node.attrs.columnWidths[index] ?? 1,
                })),
                rows,
            };
        }
        case "codeBlock": {
            // Code lines are addressable independently, so each key uses the line node's
            // position instead of the surrounding code block.
            let linePos = nodePos + 1;

            return {
                type: "Code",
                language: node.attrs.language,
                lines: node.content.content.map(lineNode => {
                    assert(lineNode.type.name === "codeBlockLine");
                    const currentLinePos = linePos;
                    linePos += lineNode.nodeSize;

                    const elements = lineNode.content.content.map(textNode => {
                        assert(textNode.type.name === "text");

                        // Code block text can carry formatting marks, but nested Code marks are not
                        // representable.
                        const marks =
                            textNode.marks.length > 0
                                ? textNode.marks.map(mark => {
                                      const apiMark = intoApiContentInlineElementMark(mark);
                                      if (apiMark.type === "Code") {
                                          throw new InternalError(
                                              quote`${apiMark.type} mark isn\u2019t supported in \`Code\` block element`,
                                          );
                                      }
                                      return apiMark;
                                  })
                                : undefined;

                        return {
                            type: "Text" as const,
                            text: textNode.text!,
                            ...(marks !== undefined ? {marks} : {}),
                        };
                    });

                    const key = maybeEncodeApiContentKey(context, currentLinePos, lineNode);

                    return {
                        ...(key !== undefined ? {key} : {}),
                        elements,
                    };
                }),
            };
        }
        case "fileFloat": {
            const fileChild = assertExists(node.content.content[0]);
            // NOCOMMIT: Test `findApiContentRanges()` with this
            const element = intoApiContentFileOrPreviewElement(context, fileChild, nodePos + 1);
            const direction = node.attrs.direction;
            assert(typeof direction === "string");
            return {
                type: "FileFloat",
                side: direction === "left" ? "Left" : "Right",
                element,
            };
        }
        case "fileRowTable": {
            const fileChild = assertExists(node.content.content[0]);
            // NOCOMMIT: Test `findApiContentRanges()` with this
            return intoApiContentFileOrPreviewElement(context, fileChild, nodePos + 1);
        }
        default:
            throw exhaustive(typeName);
    }
}

/**
 * Encodes a content key when the caller provided stable entity context. Keyless
 * conversion paths intentionally omit the property rather than inventing fake
 * provenance for content that cannot be used for API position mapping.
 */
function maybeEncodeApiContentKey(
    context: ApiContentMarkdownIntoContext,
    pos: number,
    node: Node,
): ApiContentKey | undefined {
    // Dev + test only validation: make sure `pos` correctly points to `node` in
    // `rootNode`. Defends against accidental blunders where we pass in the wrong pos.
    if (process.env.NODE_ENV !== "production") {
        // Stream content may encode an offset position, but the ProseMirror node still
        // lives at the local position inside this root node.
        const localPos = pos - context.posOffset;
        assert(localPos >= 0);
        assert(context.rootNode.resolve(localPos).nodeAfter === node);
    }

    if (!context.encoder) return undefined;

    return context.encoder.encode({pos, nodeSize: node.nodeSize});
}

function assertApiContentResponseHasKeys(
    content: ApiContentResponseWithOptionalKeys,
): asserts content is ApiContentResponse {
    if (process.env.NODE_ENV === "production") {
        // Missing keys are a bug, but not worth blocking a user API call in production.
        return;
    }

    for (const element of content.elements) {
        assertApiContentBlockElementHasKeys(element);
    }
}

function assertApiContentBlockElementHasKeys(
    element: ApiContentBlockElementResponseWithOptionalKeys,
): asserts element is ApiContentBlockElementResponse {
    switch (element.type) {
        case "Paragraph":
        case "Heading": {
            assert(element.key !== undefined);
            break;
        }
        case "UnorderedList":
        case "OrderedList": {
            for (const item of element.items) {
                assertApiContentListBlockElementItemHasKeys(item);
            }
            break;
        }
        case "CheckList": {
            for (const item of element.items) {
                assertApiContentCheckListBlockElementItemHasKeys(item);
            }
            break;
        }
        case "Quote": {
            for (const childElement of element.elements) {
                assertApiContentBlockElementHasKeys(childElement);
            }
            break;
        }
        case "Table": {
            for (const row of element.rows) {
                for (const cell of row.cells) {
                    for (const childElement of cell.elements) {
                        assertApiContentBlockElementHasKeys(childElement);
                    }
                }
            }
            break;
        }
        case "Code": {
            for (const line of element.lines) {
                assert(line.key !== undefined);
            }
            break;
        }
        case "Divider":
        case "File":
        case "FileGallery":
        case "FileFloat":
        case "Preview": {
            break;
        }
        default:
            throw exhaustive(element);
    }
}

function assertApiContentListBlockElementItemHasKeys(
    item: ApiContentListBlockElementItemResponseWithOptionalKeys,
): asserts item is ApiContentListBlockElementItemResponse {
    for (const element of item.elements) {
        assertApiContentBlockElementHasKeys(element);
    }
    for (const element of item.nestedListElements ?? []) {
        assertApiContentBlockElementHasKeys(element);
    }
}

function assertApiContentCheckListBlockElementItemHasKeys(
    item: ApiContentCheckListBlockElementItemResponseWithOptionalKeys,
): asserts item is ApiContentCheckListBlockElementItemResponse {
    for (const element of item.elements) {
        assertApiContentBlockElementHasKeys(element);
    }
    for (const element of item.nestedListElements ?? []) {
        assertApiContentBlockElementHasKeys(element);
    }
}

// IMPORTANT: This code is copied to `into_api_message.ts`, specifically
// `intoApiMessagePayloadFiles()`. If you make a change to this code you probably
// need to make a change there too.
function intoApiContentFileOrPreviewElement(
    context: ApiContentMarkdownIntoContext,
    node: Node,
    nodePos: number,
):
    | ApiContentFileBlockElementResponseWithOptionalKeys
    | ApiContentPreviewBlockElementResponseWithOptionalKeys {
    const key = maybeEncodeApiContentKey(context, nodePos, node);

    const marks =
        node.marks.length > 0
            ? normalizeApiContentInlineElementMarks(
                  node.marks.map((mark): ApiContentCommentMark => {
                      assert(mark.type.name === "comment");

                      return {
                          type: "Comment",
                          thread: {id: mark.attrs.commentThreadId},
                      };
                  }),
              )
            : undefined;

    const fileId: string | null = node.attrs.fileId;
    if (fileId === null) {
        // IMPORTANT: This code is copied to `into_api_message.ts`, specifically
        // `intoApiMessagePayloadFiles()`. If you make a change to this code you probably
        // need to make a change there too.
        return {
            type: "File",
            // NOCOMMIT: Test with unknown file id?
            ...(key !== undefined ? {key} : {}),
            id: unknownFileId,
            contentType: "application/octet-stream",
            contentLength: 0,
            ...(marks !== undefined ? {marks} : {}),
        };
    }

    if (isFileEntityId(fileId)) {
        const entityIdObject = parseFileEntityId(fileId);

        // IMPORTANT: This code is copied to `into_api_message.ts`, specifically
        // `intoApiMessagePayloadFiles()`. If you make a change to this code you probably
        // need to make a change there too.
        const title =
            context.getSearchEntityMentionTitleIfExists(fileId) ??
            `Unknown ${getApiMentionReferenceNoun(entityIdObject.type)}`;

        let reference: ApiPreviewReferenceResponse;

        switch (entityIdObject.type) {
            case "Channel": {
                reference = {
                    type: "Channel",
                    id: entityIdObject.channelId,
                    title,
                };
                break;
            }
            case "Chat": {
                reference = {
                    type: "Chat",
                    id: entityIdObject.chatId,
                    title,
                };
                break;
            }
            case "Document": {
                reference = {
                    type: "Document",
                    id: entityIdObject.documentId,
                    title,
                };
                break;
            }
            case "Post": {
                reference = {
                    type: "Post",
                    id: entityIdObject.postId,
                    title,
                };
                break;
            }
            case "Task": {
                reference = {
                    type: "Task",
                    id: entityIdObject.taskId,
                    title,
                    status: intoApiTaskStatus(
                        context.getSearchTaskEntityDisplayStatusIfExists(entityIdObject.taskId) ??
                            "Closed",
                    ),
                };
                break;
            }
            case "TaskCollection": {
                reference = {
                    type: "TaskCollection",
                    id: entityIdObject.collectionId,
                    title,
                };
                break;
            }
            case "Site": {
                reference = {
                    type: "Site",
                    id: entityIdObject.siteId,
                    title,
                };
                break;
            }
            default:
                throw exhaustive(entityIdObject);
        }

        // IMPORTANT: This code is copied to `into_api_message.ts`, specifically
        // `intoApiMessagePayloadFiles()`. If you make a change to this code you probably
        // need to make a change there too.
        return {
            type: "Preview",
            ...(key !== undefined ? {key} : {}),
            reference,
            ...(marks !== undefined ? {marks} : {}),
        };
    }

    assert(isId<FileId>(fileId));
    const file = context.getFileIfExists(fileId);
    return {
        type: "File",
        ...(key !== undefined ? {key} : {}),
        id: fileId,
        contentType: file?.contentType ?? "application/octet-stream",
        contentLength: file?.contentLength ?? 0,
        ...(marks !== undefined ? {marks} : {}),
    };
}

function intoApiContentInlineElements(
    context: ApiContentMarkdownIntoContext,
    nodes: ReadonlyArray<Node>,
): ReadonlyArray<ApiContentInlineElementResponse> {
    return nodes.map(node => intoApiContentInlineElement(context, node));
}

function intoApiContentInlineElement(
    context: ApiContentMarkdownIntoContext,
    node: Node,
): ApiContentInlineElementResponse {
    const typeName = node.type.name as ContentInlineNodeTypeName;

    switch (typeName) {
        case "text": {
            const marks =
                node.marks.length > 0 ? intoApiContentInlineElementMarks(node.marks) : undefined;

            return {
                type: "Text",
                text: node.text!,
                ...(marks !== undefined ? {marks} : {}),
            };
        }
        case "break": {
            const marks =
                node.marks.length > 0 ? intoApiContentInlineElementMarks(node.marks) : undefined;

            return {
                type: "Break",
                ...(marks !== undefined ? {marks} : {}),
            };
        }
        case "mention": {
            const mention: ContentMention = node.attrs.mention;

            if (mention.type === "Account") {
                const title =
                    context.getAccountMentionTitleIfExists(mention.accountId, {isShort: false}) ??
                    "Unknown";
                const shortName =
                    context.getAccountMentionTitleIfExists(mention.accountId, {isShort: true}) ??
                    title;

                const marks =
                    node.marks.length > 0
                        ? intoApiContentInlineElementMarks(node.marks)
                        : undefined;

                return {
                    type: "Mention",
                    reference: {
                        type: "Account",
                        id: mention.accountId,
                        title,
                        shortName,
                    },
                    ...(mention.isShort ? {isAccountShortName: true} : {}),
                    ...(marks !== undefined ? {marks} : {}),
                };
            } else {
                const entityIdObject = parseSearchMentionEntityId(mention.entityId);

                const title =
                    context.getSearchEntityMentionTitleIfExists(mention.entityId) ??
                    `Unknown ${getApiMentionReferenceNoun(entityIdObject.type)}`;

                let reference: ApiMentionReferenceResponse;

                switch (entityIdObject.type) {
                    case "Document": {
                        reference = {
                            type: "Document",
                            id: entityIdObject.documentId,
                            title,
                        };
                        break;
                    }
                    case "Channel": {
                        reference = {
                            type: "Channel",
                            id: entityIdObject.channelId,
                            title,
                        };
                        break;
                    }
                    case "Chat": {
                        reference = {
                            type: "Chat",
                            id: entityIdObject.chatId,
                            title,
                        };
                        break;
                    }
                    case "Task": {
                        reference = {
                            type: "Task",
                            id: entityIdObject.taskId,
                            title,
                            status: intoApiTaskStatus(
                                context.getSearchTaskEntityDisplayStatusIfExists(
                                    entityIdObject.taskId,
                                    // Default deleted tasks and private tasks to `Closed`.
                                ) ?? "Closed",
                            ),
                        };
                        break;
                    }
                    case "TaskCollection": {
                        reference = {
                            type: "TaskCollection",
                            id: entityIdObject.collectionId,
                            title,
                        };
                        break;
                    }
                    case "Post": {
                        reference = {
                            type: "Post",
                            id: entityIdObject.postId,
                            title,
                        };
                        break;
                    }
                    case "Site": {
                        reference = {
                            type: "Site",
                            id: entityIdObject.siteId,
                            title,
                        };
                        break;
                    }
                    default:
                        throw exhaustive(entityIdObject);
                }

                const marks =
                    node.marks.length > 0
                        ? intoApiContentInlineElementMarks(node.marks)
                        : undefined;

                return {
                    type: "Mention",
                    reference,
                    ...(marks !== undefined ? {marks} : {}),
                };
            }
        }
        default:
            throw exhaustive(typeName);
    }
}

function intoApiContentInlineElementMarks(
    marks: ReadonlyArray<Mark>,
): ReadonlyArray<ApiContentInlineElementMark> | undefined {
    return normalizeApiContentInlineElementMarks(marks.map(intoApiContentInlineElementMark));
}

function intoApiContentInlineElementMark(mark: Mark): ApiContentInlineElementMark {
    const typeName = mark.type.name as ContentMarkTypeName;

    switch (typeName) {
        case "link":
            return {type: "Link", url: mark.attrs.url};
        case "italic":
            return {type: "Italic"};
        case "bold":
            return {type: "Bold"};
        case "code":
            return {type: "Code"};
        case "strike":
            return {type: "Strike"};

        case "highlight": {
            return {
                type: "Highlight",
                color: intoApiContentInlineElementHighlightMarkColor(mark.attrs.color),
            };
        }
        case "comment": {
            return {
                type: "Comment",
                thread: {id: mark.attrs.commentThreadId},
            };
        }
        default:
            throw exhaustive(typeName);
    }
}

export function intoApiContentSnippetInlineElementMarks(
    marks: ReadonlyArray<Mark>,
): ReadonlyArray<ApiMessageContentPayloadParentContentSnippetInlineElementMark> {
    return marks.map(intoApiContentSnippetInlineElementMark);
}

function intoApiContentSnippetInlineElementMark(
    mark: Mark,
): ApiMessageContentPayloadParentContentSnippetInlineElementMark {
    switch (mark.type.name) {
        case "strike":
            return {type: "Strike"};
        case "code":
            return {type: "Code"};
        default:
            throw new InternalError(
                quote`${mark.type.name} mark isn\u2019t supported in \`ContentSnippet\` inline element`,
            );
    }
}

export function intoApiContentInlineElementHighlightMarkColor(
    color: HighlightColor,
): ApiContentHighlightMarkColor {
    switch (color) {
        case HighlightColor.Red:
            return "Red";
        case HighlightColor.Orange:
            return "Orange";
        case HighlightColor.Green:
            return "Green";
        case HighlightColor.Blue:
            return "Blue";
        case HighlightColor.Purple:
            return "Purple";
        default:
            throw exhaustive(color);
    }
}
