import {Mark, Node} from "prosemirror-model";
import {
    ApiContent,
    ApiContentBlockElement,
    ApiContentInlineElement,
    ApiContentInlineElementMark,
    ApiContentListBlockElement,
    ApiContentListBlockElementItem,
    ApiContentMentionInlineElement,
    ApiContentTableBlockElementCell,
    ApiContentTableBlockElementRow,
} from "~/server/api/specification/types/api_specification_convenience_types.js";
import {ContentMention} from "~/shared/content/content_mention.js";
import {
    ContentBlockNodeTypeName,
    ContentInlineNodeTypeName,
    ContentListItemNodeTypeName,
    ContentMarkTypeName,
} from "~/shared/content/content_node_type_name.js";
import {InternalError, UnimplementedError} from "~/shared/error/error.js";
import {createArrayWithLength} from "~/shared/helpers/array/create_array_with_length.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {quote} from "~/shared/helpers/string/quote.js";
import {AccountId} from "~/shared/id/types/id_types.js";
import {
    SearchMentionEntityId,
    parseSearchMentionEntityId,
} from "~/shared/search/search_entity_id.js";

export type ApiContentMarkdownIntoOptions = {
    readonly getAccountMentionTitleIfExists: (
        accountId: AccountId,
        options: {isShort: boolean},
    ) => string | undefined;
    readonly getSearchEntityMentionTitleIfExists: (
        entityId: SearchMentionEntityId,
    ) => string | undefined;
};

/**
 * Convert ProseMirror content into the format returned by the API.
 */
export function intoApiContent(node: Node, options: ApiContentMarkdownIntoOptions): ApiContent {
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
): IterableIterator<ApiContentBlockElement> {
    let nodeIndex = 0;
    while (nodeIndex < nodes.length) {
        const node = nodes[nodeIndex]!;
        nodeIndex++;

        const typeName = node.type.name as ContentBlockNodeTypeName;

        switch (typeName) {
            case "unorderedListItem":
            case "orderedListItem": {
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
): IterableIterator<ApiContentListBlockElement> {
    let lastElement:
        | {type: "UnorderedList"; items: Array<ApiContentListBlockElementItem>}
        | {type: "OrderedList"; items: Array<ApiContentListBlockElementItem>}
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
                                  quote`${element.type} block element isn’t supported in list block element item`,
                              );
                          }
                          return element;
                      },
                  )
                : [];

        const nestedListElements =
            item.items.length > 0
                ? Array.from(intoApiContentListBlockElements(item.items, options))
                : undefined;

        switch (typeName) {
            case undefined:
            case "unorderedListItem": {
                const elementItem: ApiContentListBlockElementItem = {
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
                const elementItem: ApiContentListBlockElementItem = {
                    elements,
                    nestedListElements,
                };

                if (lastElement?.type === "OrderedList") {
                    lastElement.items.push(elementItem);
                } else {
                    if (lastElement !== null) yield lastElement;

                    lastElement = {
                        type: "OrderedList",
                        items: [elementItem],
                    };
                }
                break;
            }
            case "checkListItem": {
                throw new UnimplementedError(`${typeName} node isn’t available in the API yet`);
            }
            default:
                throw exhaustive(typeName);
        }
    }

    if (lastElement !== null) yield lastElement;
}

function intoApiContentBlockElement(
    typeName: Exclude<ContentBlockNodeTypeName, "unorderedListItem" | "orderedListItem">,
    node: Node,
    options: ApiContentMarkdownIntoOptions,
): ApiContentBlockElement {
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
                            case "OrderedList": {
                                return element;
                            }
                            case "Quote":
                            case "Table":
                            case "Code": {
                                throw new InternalError(
                                    quote`${element.type} block element isn’t supported in \`Quote\` block element`,
                                );
                            }
                            default:
                                throw exhaustive(element);
                        }
                    },
                ),
            };
        }
        case "table": {
            let columnWidth = 2;

            const rows = node.content.content.map((rowNode): ApiContentTableBlockElementRow => {
                assert(rowNode.type.name === "tableRow");

                columnWidth = Math.max(columnWidth, rowNode.content.content.length);

                return {
                    cells: rowNode.content.content.map(
                        (cellNode): ApiContentTableBlockElementCell => {
                            assert(cellNode.type.name === "tableCell");

                            return {
                                elements: Array.from(
                                    intoApiContentBlockElements(cellNode.content.content, options),
                                    element => {
                                        switch (element.type) {
                                            case "Paragraph":
                                            case "UnorderedList":
                                            case "OrderedList":
                                            case "Quote":
                                            case "Code": {
                                                return element;
                                            }
                                            case "Table": {
                                                throw new InternalError(
                                                    quote`${element.type} block element isn’t supported in \`Table\` block element`,
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
            });

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
                                                      quote`${apiMark.type} mark isn’t supported in \`Code\` block element`,
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
        case "checkListItem":
        case "heading":
        case "divider":
        case "fileRow":
        case "fileFloat":
        case "fileRowTable": {
            throw new UnimplementedError(`${typeName} node isn’t available in the API yet`);
        }
        default:
            throw exhaustive(typeName);
    }
}

function intoApiContentInlineElements(
    nodes: ReadonlyArray<Node>,
    options: ApiContentMarkdownIntoOptions,
): ReadonlyArray<ApiContentInlineElement> {
    return nodes.map(node => intoApiContentInlineElement(node, options));
}

function intoApiContentInlineElement(
    node: Node,
    options: ApiContentMarkdownIntoOptions,
): ApiContentInlineElement {
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
                    targetPath: `/accounts/${mention.accountId}`,
                    title: options.getAccountMentionTitleIfExists(mention.accountId, mention),
                    isAccountShortName: mention.isShort,
                    marks:
                        node.marks.length > 0
                            ? intoApiContentInlineElementMarks(node.marks)
                            : undefined,
                };
            } else {
                let targetPath: ApiContentMentionInlineElement["targetPath"];
                const entityIdObject = parseSearchMentionEntityId(mention.entityId);

                switch (entityIdObject.type) {
                    case "Document":
                        targetPath = `/documents/${entityIdObject.documentId}`;
                        break;
                    case "Channel":
                        targetPath = `/channels/${entityIdObject.channelId}`;
                        break;
                    case "Task":
                        targetPath = `/tasks/${entityIdObject.taskId}`;
                        break;
                    case "TaskCollection":
                        targetPath = `/task-collections/${entityIdObject.collectionId}`;
                        break;
                    case "Post":
                        targetPath = `/posts/${entityIdObject.postId}`;
                        break;
                    default:
                        throw exhaustive(entityIdObject);
                }

                return {
                    type: "Mention",
                    targetPath,
                    title: options.getSearchEntityMentionTitleIfExists(mention.entityId),
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
        case "comment":
        case "highlight":
            throw new UnimplementedError(`${typeName} mark isn’t available in the API yet`);
        default:
            throw exhaustive(typeName);
    }
}
