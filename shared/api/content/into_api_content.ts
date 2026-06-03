import {Mark, Node} from "prosemirror-model";
import {intoApiTaskStatus} from "~/shared/api/content/into_api_task_status.js";
import {unknownFileId} from "~/shared/api/content/unknown_file_id.js";
import {getApiMentionReferenceNoun} from "~/shared/api/markdown/get_api_mention_reference_noun.js";
import {
    ApiContentBlockElementResponse,
    ApiContentCheckListBlockElementItemResponse,
    ApiContentFileBlockElementResponse,
    ApiContentInlineElementHighlightMarkColor,
    ApiContentInlineElementMark,
    ApiContentInlineElementResponse,
    ApiContentListBlockElementItemResponse,
    ApiContentListBlockElementResponse,
    ApiContentPreviewBlockElementResponse,
    ApiContentResponse,
    ApiContentTableBlockElementCellResponse,
    ApiContentTableBlockElementRowResponse,
    ApiMentionReferenceResponse,
    ApiMessageContentPayloadParentContentSnippetInlineElementMark,
    ApiPreviewReferenceResponse,
} from "~/shared/api/specification/types/api_specification_convenience_types.js";
import {
    computeFileRowWidths,
    fileRowBlockWidthPxForServerAndClipboard,
    fileRowDefaultPreviewHeightPx,
} from "~/shared/content/compute_file_row_widths.js";
import {ContentMention} from "~/shared/content/content_mention.js";
import {
    ContentBlockNodeTypeName,
    ContentInlineNodeTypeName,
    ContentListItemNodeTypeName,
    ContentMarkTypeName,
} from "~/shared/content/content_node_type_name.js";
import {clampHeadingLevel} from "~/shared/content/content_schema.js";
import {getFileEntityPreviewHeight} from "~/shared/content/get_file_entity_preview_height.js";
import {getFilePreviewSizeForLayout} from "~/shared/content/get_file_preview_size.js";
import {HighlightColor} from "~/shared/design/core/highlight_color.js";
import {InternalError, UnimplementedError} from "~/shared/error/error.js";
import {FileContentType} from "~/shared/files/file_content_type.js";
import {isFileEntityId, parseFileEntityId} from "~/shared/files/file_entity_id.js";
import {createArrayWithLength} from "~/shared/helpers/array/create_array_with_length.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {quote} from "~/shared/helpers/string/quote.js";
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
    readonly getFileIfExists: (fileId: FileId) =>
        | {
              contentType: FileContentType;
              contentLength: number;
              size?: {width: number | null; height: number};
          }
        | undefined;
};

/**
 * Convert ProseMirror content into the format returned by the API.
 */
export function intoApiContent(
    node: Node,
    options: ApiContentMarkdownIntoOptions,
): ApiContentResponse {
    assert(node.type.name === "doc");
    return {elements: Array.from(intoApiContentBlockElements(node.content.content, options))};
}

type ApiContentListBlockElementWorkingItem = {
    node: Node | null;
    items: Array<ApiContentListBlockElementWorkingItem>;
};

function* intoApiContentBlockElements(
    nodes: ReadonlyArray<Node>,
    options: ApiContentMarkdownIntoOptions,
): IterableIterator<ApiContentBlockElementResponse> {
    let nodeIndex = 0;
    while (nodeIndex < nodes.length) {
        const node = nodes[nodeIndex]!;
        nodeIndex++;

        if (node.type.name === "title") {
            // Noop. Ignore document title nodes. Document titles will be handled separately.
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

                while (nodeIndex < nodes.length) {
                    const listItemNode = nodes[nodeIndex]!;
                    if (!listItemNode.type.groups.includes("listItem")) break;
                    nodeIndex++;

                    const indent: number = listItemNode.attrs.indent;
                    let indentedItems: Array<ApiContentListBlockElementWorkingItem> = items;

                    for (let i = 0; i < indent; i++) {
                        if (indentedItems.length === 0) {
                            const phantomItem = {node: null, items: []};
                            indentedItems.push(phantomItem);
                            indentedItems = phantomItem.items;
                        } else {
                            indentedItems = indentedItems[indentedItems.length - 1]!.items;
                        }
                    }

                    indentedItems.push({
                        node: listItemNode,
                        items: [],
                    });
                }

                yield* intoApiContentListBlockElements(items, options);
                break;
            }
            case "fileRow": {
                // Merge adjacent fileRow nodes into a single FileGallery.
                const rows: Array<{
                    items: Array<{
                        width: number;
                        element:
                            | ApiContentFileBlockElementResponse
                            | ApiContentPreviewBlockElementResponse;
                    }>;
                }> = [];

                // Back up to include the current node.
                nodeIndex--;

                while (nodeIndex < nodes.length) {
                    const fileRowNode = nodes[nodeIndex]!;
                    if (fileRowNode.type.name !== "fileRow") break;
                    nodeIndex++;

                    const rowElements = fileRowNode.content.content.map(child =>
                        intoApiContentFileOrPreviewElement(child, options),
                    );

                    if (rowElements.length > 0) {
                        const widths = computeGalleryRowWidths(rowElements, options);
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
                yield intoApiContentBlockElement(typeName, node, options);
                break;
        }
    }
}

function* intoApiContentListBlockElements(
    items: Array<ApiContentListBlockElementWorkingItem>,
    options: ApiContentMarkdownIntoOptions,
): IterableIterator<ApiContentListBlockElementResponse> {
    let lastElement:
        | {type: "UnorderedList"; items: Array<ApiContentListBlockElementItemResponse>}
        | {
              type: "OrderedList";
              orderStart?: number;
              items: Array<ApiContentListBlockElementItemResponse>;
          }
        | {type: "CheckList"; items: Array<ApiContentCheckListBlockElementItemResponse>}
        | null = null;

    for (const item of items) {
        const typeName = item.node?.type.name as ContentListItemNodeTypeName | undefined;

        const elements =
            item.node !== null
                ? Array.from(
                      intoApiContentBlockElements(item.node.content.content, options),
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

        if (item.node !== null && elements.length === 0) {
            elements.push({type: "Paragraph", elements: []});
        }

        const nestedListElements =
            item.items.length > 0
                ? Array.from(intoApiContentListBlockElements(item.items, options))
                : undefined;

        switch (typeName) {
            case undefined:
            case "unorderedListItem": {
                const elementItem: ApiContentListBlockElementItemResponse = {
                    elements,
                    nestedListElements,
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
                const elementItem: ApiContentListBlockElementItemResponse = {
                    elements,
                    nestedListElements,
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
                        orderStart: itemOrderStart,
                        items: [elementItem],
                    };
                }
                break;
            }
            case "checkListItem": {
                const elementItem: ApiContentCheckListBlockElementItemResponse = {
                    checked: item.node?.attrs.checked ?? false,
                    elements,
                    nestedListElements,
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
    typeName: Exclude<
        ContentBlockNodeTypeName,
        "unorderedListItem" | "orderedListItem" | "checkListItem" | "fileRow"
    >,
    node: Node,
    options: ApiContentMarkdownIntoOptions,
): ApiContentBlockElementResponse {
    switch (typeName) {
        case "paragraph": {
            return {
                type: "Paragraph",
                elements: intoApiContentInlineElements(node.content.content, options),
            };
        }
        case "quoteBlock": {
            return {
                type: "Quote",
                elements: Array.from(
                    intoApiContentBlockElements(node.content.content, options),
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
            return {
                type: "Heading",
                level: clampHeadingLevel(node.attrs.level),
                elements: intoApiContentInlineElements(node.content.content, options),
            };
        }
        case "divider": {
            return {type: "Divider"};
        }
        case "table": {
            let columnWidth = 2;

            const rows = node.content.content.map(
                (rowNode): ApiContentTableBlockElementRowResponse => {
                    assert(rowNode.type.name === "tableRow");

                    columnWidth = Math.max(columnWidth, rowNode.content.content.length);

                    return {
                        cells: rowNode.content.content.map(
                            (cellNode): ApiContentTableBlockElementCellResponse => {
                                assert(cellNode.type.name === "tableCell");

                                return {
                                    elements: Array.from(
                                        intoApiContentBlockElements(
                                            cellNode.content.content,
                                            options,
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
                hasHeaderRow: node.attrs.hasHeaderRow === true ? true : undefined,
                hasHeaderColumn: node.attrs.hasHeaderColumn === true ? true : undefined,
                columns: createArrayWithLength(columnWidth, index => ({
                    width: node.attrs.columnWidths[index] ?? 1,
                })),
                rows,
            };
        }
        case "codeBlock": {
            return {
                type: "Code",
                language: node.attrs.language,
                lines: node.content.content.map(lineNode => {
                    assert(lineNode.type.name === "codeBlockLine");

                    return {
                        elements: lineNode.content.content.map(textNode => {
                            assert(textNode.type.name === "text");

                            return {
                                type: "Text",
                                text: textNode.text!,
                                marks:
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
                                        : undefined,
                            };
                        }),
                    };
                }),
            };
        }
        case "fileFloat": {
            const fileChild = assertExists(node.content.content[0]);
            const element = intoApiContentFileOrPreviewElement(fileChild, options);
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
            return intoApiContentFileOrPreviewElement(fileChild, options);
        }
        default:
            throw exhaustive(typeName);
    }
}

function intoApiContentFileOrPreviewElement(
    fileNode: Node,
    options: ApiContentMarkdownIntoOptions,
): ApiContentFileBlockElementResponse | ApiContentPreviewBlockElementResponse {
    const fileId: string | null = fileNode.attrs.fileId;
    if (fileId === null) {
        return {
            type: "File",
            id: unknownFileId,
            contentType: "application/octet-stream",
            contentLength: 0,
        };
    }

    if (isFileEntityId(fileId)) {
        const entityIdObject = parseFileEntityId(fileId);

        // TODO(#sites): Add support for Site previews.
        if (entityIdObject.type === "Site") {
            throw new UnimplementedError("Site previews aren\u2019t supported yet");
        }

        const reference = fileEntityIdObjectToPreviewReference(entityIdObject, options);

        const title =
            options.getSearchEntityMentionTitleIfExists(fileId) ??
            `Unknown ${getApiMentionReferenceNoun(entityIdObject.type)}`;

        return {type: "Preview", reference};
    }

    assert(isId<FileId>(fileId));
    const file = options.getFileIfExists(fileId);
    return {
        type: "File",
        id: fileId,
        contentType: file?.contentType ?? "application/octet-stream",
        contentLength: file?.contentLength ?? 0,
    };
}

function fileEntityIdObjectToPreviewReference(
    entityIdObject: Exclude<ReturnType<typeof parseFileEntityId>, {type: "Site"}>,
    options: ApiContentMarkdownIntoOptions,
): ApiPreviewReferenceResponse {
    switch (entityIdObject.type) {
        case "Channel":
            return {type: "Channel", id: entityIdObject.channelId};
        case "Chat":
            return {type: "Chat", id: entityIdObject.chatId};
        case "Document":
            return {type: "Document", id: entityIdObject.documentId};
        case "Post":
            return {type: "Post", id: entityIdObject.postId};
        case "Task":
            return {
                type: "Task",
                id: entityIdObject.taskId,
                status: intoApiTaskStatus(
                    options.getSearchTaskEntityDisplayStatusIfExists(entityIdObject.taskId) ??
                        "Closed",
                ),
            };
        case "TaskCollection":
            return {type: "TaskCollection", id: entityIdObject.collectionId};
        default:
            throw exhaustive(entityIdObject);
    }
}

/**
 * Compute fractional widths (0 to 1) for a gallery row using the Cassowary
 * constraint solver. Uses `getFilePreviewSizeForLayout` so that audio, code, and
 * image files get content-type-appropriate aspect ratios matching the client-side
 * renderer.
 */
function computeGalleryRowWidths(
    elements: ReadonlyArray<
        ApiContentFileBlockElementResponse | ApiContentPreviewBlockElementResponse
    >,
    options: ApiContentMarkdownIntoOptions,
): Array<number> {
    const files = elements.map(element => {
        if (element.type === "File" && element.id !== null) {
            const file = options.getFileIfExists(element.id);
            if (file) {
                return getFilePreviewSizeForLayout({
                    contentType: file.contentType,
                    size: file.size,
                });
            }
        }
        // File entity previews and files without data have flexible width. Use null width
        // so the layout solver treats them as flexible, with a height that varies by how
        // many items are in the row (matching client-side
        // `getFileOrFileEntityPreviewSize`).
        return {
            width: null,
            height: getFileEntityPreviewHeight({
                fileCount: elements.length,
                maxFileCount: 3,
                blockWidth: fileRowBlockWidthPxForServerAndClipboard,
                defaultPreviewHeight: fileRowDefaultPreviewHeightPx,
            }),
        };
    });

    return computeFileRowWidths(files, {
        containerWidth: fileRowBlockWidthPxForServerAndClipboard,
    });
}

function intoApiContentInlineElements(
    nodes: ReadonlyArray<Node>,
    options: ApiContentMarkdownIntoOptions,
): ReadonlyArray<ApiContentInlineElementResponse> {
    return nodes.map(node => intoApiContentInlineElement(node, options));
}

function intoApiContentInlineElement(
    node: Node,
    options: ApiContentMarkdownIntoOptions,
): ApiContentInlineElementResponse {
    const typeName = node.type.name as ContentInlineNodeTypeName;

    switch (typeName) {
        case "text": {
            return {
                type: "Text",
                text: node.text!,
                marks:
                    node.marks.length > 0
                        ? intoApiContentInlineElementMarks(node.marks)
                        : undefined,
            };
        }
        case "break": {
            return {
                type: "Break",
                marks:
                    node.marks.length > 0
                        ? intoApiContentInlineElementMarks(node.marks)
                        : undefined,
            };
        }
        case "mention": {
            const mention: ContentMention = node.attrs.mention;

            if (mention.type === "Account") {
                return {
                    type: "Mention",
                    reference: {
                        type: "Account",
                        id: mention.accountId,
                    },
                    title:
                        options.getAccountMentionTitleIfExists(mention.accountId, mention) ??
                        "Unknown",
                    isAccountShortName: mention.isShort,
                    marks:
                        node.marks.length > 0
                            ? intoApiContentInlineElementMarks(node.marks)
                            : undefined,
                };
            } else {
                const entityIdObject = parseSearchMentionEntityId(mention.entityId);

                let reference: ApiMentionReferenceResponse;

                switch (entityIdObject.type) {
                    case "Document": {
                        reference = {
                            type: "Document",
                            id: entityIdObject.documentId,
                        };
                        break;
                    }
                    case "Channel": {
                        reference = {
                            type: "Channel",
                            id: entityIdObject.channelId,
                        };
                        break;
                    }
                    case "Chat": {
                        reference = {
                            type: "Chat",
                            id: entityIdObject.chatId,
                        };
                        break;
                    }
                    case "Task": {
                        reference = {
                            type: "Task",
                            id: entityIdObject.taskId,
                            status: intoApiTaskStatus(
                                options.getSearchTaskEntityDisplayStatusIfExists(
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
                        };
                        break;
                    }
                    case "Post": {
                        reference = {
                            type: "Post",
                            id: entityIdObject.postId,
                        };
                        break;
                    }
                    case "Site": {
                        // TODO(#sites): Implement site mentions.
                        throw new UnimplementedError("Site mentions aren\u2019t implemented");
                    }
                    default:
                        throw exhaustive(entityIdObject);
                }

                return {
                    type: "Mention",
                    reference,
                    title:
                        options.getSearchEntityMentionTitleIfExists(mention.entityId) ??
                        `Unknown ${getApiMentionReferenceNoun(reference.type)}`,
                    marks:
                        node.marks.length > 0
                            ? intoApiContentInlineElementMarks(node.marks)
                            : undefined,
                };
            }
        }
        default:
            throw exhaustive(typeName);
    }
}

function intoApiContentInlineElementMarks(
    marks: ReadonlyArray<Mark>,
): ReadonlyArray<ApiContentInlineElementMark> {
    return marks.map(intoApiContentInlineElementMark);
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
                threadId: mark.attrs.commentThreadId,
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
): ApiContentInlineElementHighlightMarkColor {
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
