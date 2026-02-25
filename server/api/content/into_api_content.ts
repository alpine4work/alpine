import {Mark, Node} from "prosemirror-model";
import {intoApiTaskStatus} from "~/server/api/content/into_api_task_status.js";
import {getApiMentionTargetNoun} from "~/server/api/markdown/get_api_mention_target_noun.js";
import {
    ApiContentBlockElementResponse,
    ApiContentCheckListBlockElementItemResponse,
    ApiContentInlineElementHighlightMarkColor,
    ApiContentInlineElementMark,
    ApiContentInlineElementResponse,
    ApiContentListBlockElementItemResponse,
    ApiContentListBlockElementResponse,
    ApiContentResponse,
    ApiContentTableBlockElementCellResponse,
    ApiContentTableBlockElementRowResponse,
    ApiMentionTargetResponse,
    ApiMessageContentPayloadParentContentSnippetInlineElementMark,
} from "~/shared/api/types/api_specification_convenience_types.js";
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
import {createArrayWithLength} from "~/shared/helpers/array/create_array_with_length.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {quote} from "~/shared/helpers/string/quote.js";
import {AccountId, TaskId} from "~/shared/id/types/id_types.js";
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
            // Noop. Ignore document title nodes. Document titles will be
            // handled separately.
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
        "unorderedListItem" | "orderedListItem" | "checkListItem"
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
                            case "Code": {
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
                                                case "Code": {
                                                    return element;
                                                }
                                                case "Table":
                                                case "Heading":
                                                case "Divider": {
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
        case "fileRow":
        case "fileFloat":
        case "fileRowTable": {
            // TODO(ifitzsimmons, #ai): Add support for file attachments. Currently,
            // the agent has no way to actually read file attachments, so there's no
            // need to spend time implementing this conversion right now. My primary
            // concern is that I don't want the agent to fail any time it reads content
            // with attachments.
            //
            // If we were to publish our API, we'd also need to make sure that this is
            // implemented.
            //
            // In any case, I'm deprioritizing this work for launch. I'll get back to this
            // if I have time.
            //
            // https://alpine.inc/s/c2pwxmpv3z7b3db19tsn6y1qfg/tasks/55rd1cnzfvcqeq21qceb4pzpfw
            return {
                type: "Paragraph",
                elements: [
                    {
                        type: "Text",
                        text: "(There\u2019s a file attachment here but ChatGPT can\u2019t currently see files in Alpine.)",
                    },
                ],
            };
        }
        default:
            throw exhaustive(typeName);
    }
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
                    target: {
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

                let target: ApiMentionTargetResponse;

                switch (entityIdObject.type) {
                    case "Document": {
                        target = {
                            type: "Document",
                            id: entityIdObject.documentId,
                        };
                        break;
                    }
                    case "Channel": {
                        target = {
                            type: "Channel",
                            id: entityIdObject.channelId,
                        };
                        break;
                    }
                    case "Chat": {
                        target = {
                            type: "Chat",
                            id: entityIdObject.chatId,
                        };
                        break;
                    }
                    case "Task": {
                        target = {
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
                        target = {
                            type: "TaskCollection",
                            id: entityIdObject.collectionId,
                        };
                        break;
                    }
                    case "Post": {
                        target = {
                            type: "Post",
                            id: entityIdObject.postId,
                        };
                        break;
                    }
                    default:
                        throw exhaustive(entityIdObject);
                }

                return {
                    type: "Mention",
                    target,
                    title:
                        options.getSearchEntityMentionTitleIfExists(mention.entityId) ??
                        `Unknown ${getApiMentionTargetNoun(target.type)}`,
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
