import {Mark, Node, Schema as ProsemirrorSchema} from "prosemirror-model";
import {
    ApiContent,
    ApiContentBlockElement,
    ApiContentInlineElement,
    ApiContentInlineElementMark,
    ApiContentListBlockElement,
    ApiContentMentionInlineElement,
} from "~/server/api/specification/types/api_specification_convenience_types.js";
import {ContentMention} from "~/shared/content/content_mention.js";
import {ContentListItemNodeTypeName} from "~/shared/content/content_node_type_name.js";
import {InternalError} from "~/shared/error/error.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {assertId} from "~/shared/id/id.js";
import {
    AccountId,
    ChannelId,
    DocumentId,
    PostId,
    TaskCollectionId,
    TaskId,
} from "~/shared/id/types/id_types.js";
import {SearchMentionEntityId} from "~/shared/search/search_entity_id.js";

/**
 * Convert content from the API back into ProseMirror nodes.
 */
export function fromApiContent(schema: ProsemirrorSchema, content: ApiContent): Node {
    const blockNodes = Array.from(fromApiContentBlockElements(schema, content.elements));
    return schema.nodes.doc!.create(null, blockNodes);
}

function* fromApiContentBlockElements(
    schema: ProsemirrorSchema,
    elements: ReadonlyArray<ApiContentBlockElement>,
): IterableIterator<Node> {
    for (const element of elements) {
        switch (element.type) {
            case "Paragraph": {
                yield schema.nodes.paragraph!.create(
                    null,
                    fromApiContentInlineElements(schema, element.elements),
                );
                break;
            }
            case "UnorderedList":
            case "OrderedList": {
                function* fromApiContentListBlockElement(
                    element: ApiContentListBlockElement,
                    indent: number,
                ): IterableIterator<Node> {
                    let typeName: ContentListItemNodeTypeName;

                    switch (element.type) {
                        case "UnorderedList":
                            typeName = "unorderedListItem";
                            break;
                        case "OrderedList":
                            typeName = "orderedListItem";
                            break;
                        default:
                            throw exhaustive(element);
                    }

                    for (const item of element.items) {
                        if (item.elements.length > 0) {
                            yield schema.nodes[typeName]!.create(
                                {indent},
                                Array.from(fromApiContentBlockElements(schema, item.elements)),
                            );
                        }

                        if (item.nestedListElements !== undefined) {
                            for (const nestedListElement of item.nestedListElements) {
                                yield* fromApiContentListBlockElement(
                                    nestedListElement,
                                    indent + 1,
                                );
                            }
                        }
                    }
                }

                yield* fromApiContentListBlockElement(element, 0);
                break;
            }
            case "Quote": {
                yield schema.nodes.quoteBlock!.create(
                    null,
                    Array.from(fromApiContentBlockElements(schema, element.elements)),
                );
                break;
            }
            case "Table": {
                yield schema.nodes.table!.create(
                    {
                        tableWidth: element.width,
                        columnWidths: element.columns.map(column => column.width),
                        hasHeaderRow: element.hasHeaderRow,
                        hasHeaderColumn: element.hasHeaderColumn,
                    },
                    element.rows.map(row => {
                        return schema.nodes.tableRow!.create(
                            null,
                            row.cells.map(cell => {
                                return schema.nodes.tableCell!.create(
                                    null,
                                    Array.from(fromApiContentBlockElements(schema, cell.elements)),
                                );
                            }),
                        );
                    }),
                );
                break;
            }
            case "Code": {
                yield schema.nodes.codeBlock!.create(
                    {language: element.language},
                    element.lines.map(line => {
                        return schema.nodes.codeBlockLine!.create(
                            null,
                            fromApiContentInlineElements(schema, line.elements),
                        );
                    }),
                );
                break;
            }
            default:
                throw exhaustive(element);
        }
    }
}

function fromApiContentInlineElements(
    schema: ProsemirrorSchema,
    elements: ReadonlyArray<ApiContentInlineElement>,
): ReadonlyArray<Node> {
    return elements.map(element => fromApiContentInlineElement(schema, element));
}

function fromApiContentInlineElement(
    schema: ProsemirrorSchema,
    element: ApiContentInlineElement,
): Node {
    const marks =
        element.marks !== undefined
            ? fromApiContentInlineElementMarks(schema, element.marks)
            : undefined;

    switch (element.type) {
        case "Text": {
            return schema.text(element.text, marks);
        }
        case "Break": {
            return schema.nodes.break!.create(null, null, marks);
        }
        case "Mention": {
            return fromApiContentMentionInlineElement(schema, element, marks);
        }
        default:
            throw exhaustive(element);
    }
}

function fromApiContentMentionInlineElement(
    schema: ProsemirrorSchema,
    element: ApiContentMentionInlineElement,
    marks: ReadonlyArray<Mark> | undefined,
) {
    assert(element.targetPath.startsWith("/"));
    const targetPathSegments = element.targetPath.slice(1).split("/");

    let mention: ContentMention;

    if (targetPathSegments[0] === "accounts") {
        mention = {
            type: "Account",
            accountId: assertId<AccountId>(targetPathSegments[1] ?? ""),
            isShort: element.isAccountShortName ?? false,
        };
    } else {
        let entityId: SearchMentionEntityId;

        switch (targetPathSegments[0]) {
            case "documents": {
                entityId = `Document:${assertId<DocumentId>(targetPathSegments[1] ?? "")}`;
                break;
            }
            case "channels": {
                entityId = `Channel:${assertId<ChannelId>(targetPathSegments[1] ?? "")}`;
                break;
            }
            case "tasks": {
                entityId = `Task:${assertId<TaskId>(targetPathSegments[1] ?? "")}`;
                break;
            }
            case "task-collections": {
                entityId = `TaskCollection:${assertId<TaskCollectionId>(
                    targetPathSegments[1] ?? "",
                )}`;
                break;
            }
            case "posts": {
                entityId = `Post:${assertId<PostId>(targetPathSegments[1] ?? "")}`;
                break;
            }
            default:
                throw new InternalError("Couldn’t parse mention target path");
        }

        mention = {
            type: "SearchEntity",
            entityId,
        };
    }

    return schema.nodes.mention!.create({mention}, null, marks);
}

function fromApiContentInlineElementMarks(
    schema: ProsemirrorSchema,
    marks: ReadonlyArray<ApiContentInlineElementMark>,
): ReadonlyArray<Mark> {
    return marks.map(mark => fromApiContentInlineElementMark(schema, mark));
}

function fromApiContentInlineElementMark(
    schema: ProsemirrorSchema,
    mark: ApiContentInlineElementMark,
): Mark {
    switch (mark.type) {
        case "Link":
            return schema.marks.link!.create({url: mark.url});
        case "Italic":
            return schema.marks.italic!.create();
        case "Bold":
            return schema.marks.bold!.create();
        case "Code":
            return schema.marks.code!.create();
        case "Strike":
            return schema.marks.strike!.create();
        default:
            throw exhaustive(mark);
    }
}
