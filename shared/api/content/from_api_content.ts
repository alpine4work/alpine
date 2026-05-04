import {Mark, Node, Schema as ProsemirrorSchema} from "prosemirror-model";
import {ApiContentBlockElementWithFileRow} from "~/shared/api/content/api_content_block_element_with_file_row.js";
import {intoApiContentParagraphBlockElement} from "~/shared/api/markdown/parse_api_content_from_markdown.js";
import {
    ApiContent,
    ApiContentCheckListBlockElementItem,
    ApiContentInlineElement,
    ApiContentInlineElementHighlightMarkColor,
    ApiContentInlineElementMark,
    ApiContentListBlockElement,
    ApiContentListBlockElementItem,
    ApiContentMentionInlineElement,
} from "~/shared/api/specification/types/api_specification_convenience_types.js";
import {ContentMention} from "~/shared/content/content_mention.js";
import {ContentListItemNodeTypeName} from "~/shared/content/content_node_type_name.js";
import {maxContentListItemIndentation} from "~/shared/content/content_schema.js";
import {HighlightColor} from "~/shared/design/core/highlight_color.js";
import {InternalError} from "~/shared/error/error.js";
import {filterMapArray} from "~/shared/helpers/array/filter_map_array.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {concatIterables} from "~/shared/helpers/iterable/concat_iterables.js";
import {SearchMentionEntityId} from "~/shared/search/search_entity_id.js";

/**
 * Extended content type that includes FileRow elements.
 */
export interface ApiContentExtended {
    readonly elements: ReadonlyArray<ApiContentBlockElementWithFileRow>;
}

/**
 * Convert content from the API back into ProseMirror nodes.
 *
 * We pass a generic in order to support the extended content type for imports.
 * This allows us to use the extended content type for certain cases (like imports)
 * without having to support this for the base content type. TODO(#public-api):
 * Remove this generic once we support files in the public API
 */
export function fromApiContent<ApiContentType extends ApiContent | ApiContentExtended = ApiContent>(
    schema: ProsemirrorSchema,
    content: ApiContentType,
): Node {
    const blockNodes = Array.from(fromApiContentBlockElements(schema, content.elements));

    return schema.nodes.doc!.create(
        null,
        blockNodes.length > 0 ? blockNodes : [schema.nodes.paragraph!.create()],
    );
}

/**
 * Specialized version of `fromApiContent()` specifically optimized for the API
 * `PUT` document endpoint.
 */
export function fromApiContentForPutDocument(
    schema: ProsemirrorSchema,
    title: string,
    content: ApiContent,
): ReadonlyArray<Node> {
    const blockNodes = Array.from(
        concatIterables(
            [schema.nodes.title!.create(null, schema.text(title))],
            fromApiContentBlockElements(schema, content.elements),
        ),
    );

    if (blockNodes.length === 1) {
        blockNodes.push(schema.nodes.paragraph!.create());
    }

    return blockNodes;
}

export function* fromApiContentBlockElements(
    schema: ProsemirrorSchema,
    elements: Iterable<ApiContentBlockElementWithFileRow>,
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
            case "OrderedList":
            case "CheckList": {
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
                        case "CheckList": {
                            // NOTE(ifitzsimmons, 2025-12-19): As of this writing, only documents support
                            // checklists. When a user passes a checklist into a content surface that doesn't
                            // support checklists, we have to decide what to do. In the app, if a user tries to
                            // copy and paste a checklist from a document into another surface, we paste it as
                            // an unordered list. We've decided to maintain the current behavior. If a user
                            // tries to create a checklist in a post/comment/message via the API, we'll convert
                            // it into an unordered list.
                            if (!schema.nodes.checkListItem) {
                                typeName = "unorderedListItem";
                            } else {
                                typeName = "checkListItem";
                            }
                            break;
                        }
                        default:
                            throw exhaustive(element);
                    }

                    for (let itemIndex = 0; itemIndex < element.items.length; itemIndex++) {
                        const item = element.items[itemIndex]!;

                        // Clamp indent to max allowed value
                        const clampedIndent = Math.min(indent, maxContentListItemIndentation);

                        if (item.elements.length > 0) {
                            const attrs: {indent: number; checked?: boolean; orderStart?: number} =
                                {indent: clampedIndent};

                            if (typeName === "checkListItem") {
                                attrs.checked = assertCheckListItem(item).checked;
                            }

                            // Only set orderStart for the first ordered list item. Subsequent items
                            // auto-increment naturally.
                            if (element.type === "OrderedList" && itemIndex === 0) {
                                attrs.orderStart = element.orderStart;
                            }

                            yield schema.nodes[typeName]!.create(
                                attrs,
                                Array.from(fromApiContentBlockElements(schema, item.elements)),
                            );
                        }

                        if (item.nestedListElements !== undefined) {
                            for (const nestedListElement of item.nestedListElements) {
                                yield* fromApiContentListBlockElement(
                                    nestedListElement,
                                    clampedIndent + 1,
                                );
                            }
                        }
                    }
                }

                yield* fromApiContentListBlockElement(element, 0);
                break;
            }
            case "Quote": {
                const quoteContent = Array.from(
                    fromApiContentBlockElements(schema, element.elements),
                );

                // Quote blocks require at least one block element ((paragraph | listItem)+) If the
                // quote is empty, add an empty paragraph
                if (quoteContent.length === 0) {
                    quoteContent.push(schema.nodes.paragraph!.create());
                }

                yield schema.nodes.quoteBlock!.create(null, quoteContent);
                break;
            }
            case "Heading": {
                assert(schema.nodes.heading, "All content surfaces should support headings");

                yield schema.nodes.heading.create(
                    {level: element.level},
                    fromApiContentInlineElements(schema, element.elements),
                );
                break;
            }
            case "Divider": {
                if (!schema.nodes.divider) {
                    yield* fromApiContentBlockElements(
                        schema,
                        intoApiContentParagraphBlockElement(element),
                    );
                    break;
                }

                yield schema.nodes.divider.create();
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
                                const cellContent = Array.from(
                                    fromApiContentBlockElements(schema, cell.elements),
                                );

                                // Table cells require at least one block element (tableBlock+) If the cell is
                                // empty, create an empty paragraph
                                if (cellContent.length === 0) {
                                    cellContent.push(schema.nodes.paragraph!.create());
                                }

                                return schema.nodes.tableCell!.create(null, cellContent);
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
            case "FileRow": {
                // TODO(#public-api): Remove this assertion once we support files in the public API
                // and decide if we want to automatically split rows into multiple rows if there
                // are more than 3 files.
                assert(element.files.length <= 3, "FileRow must have at most 3 files");

                // Create file nodes for each file in the row (max 3)
                const fileNodes = element.files.map(file =>
                    schema.nodes.file!.create({fileId: file.fileId}),
                );

                yield schema.nodes.fileRow!.create(null, fileNodes);
                break;
            }
            case "FileRowTable": {
                // FileRowTable is for files in table cells - uses fileRowTable node type
                yield schema.nodes.fileRowTable!.create(null, [
                    schema.nodes.file!.create({fileId: element.fileId}),
                ]);
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
    const mentionTarget = element.target;
    let mention: ContentMention;

    if (mentionTarget.type === "Account") {
        mention = {
            type: "Account",
            accountId: mentionTarget.id,
            isShort: element.isAccountShortName ?? false,
        };
    } else {
        let entityId: SearchMentionEntityId;

        switch (mentionTarget.type) {
            case "Document": {
                entityId = `Document:${mentionTarget.id}`;
                break;
            }
            case "Channel": {
                entityId = `Channel:${mentionTarget.id}`;
                break;
            }
            case "Task": {
                entityId = `Task:${mentionTarget.id}`;
                break;
            }
            case "TaskCollection": {
                entityId = `TaskCollection:${mentionTarget.id}`;
                break;
            }
            case "Post": {
                entityId = `Post:${mentionTarget.id}`;
                break;
            }
            default:
                throw new InternalError("Couldn\u2019t parse mention target path");
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
    return filterMapArray(marks, mark => fromApiContentInlineElementMark(schema, mark));
}

function fromApiContentInlineElementMark(
    schema: ProsemirrorSchema,
    mark: ApiContentInlineElementMark,
): Mark | undefined {
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

        case "Highlight": {
            if (!schema.marks.highlight) return;

            return schema.marks.highlight.create({
                color: fromApiContentInlineElementHighlightMarkColor(mark.color),
            });
        }
        case "Comment": {
            if (!schema.marks.comment) return;

            return schema.marks.comment.create({commentThreadId: mark.threadId});
        }
        default:
            throw exhaustive(mark);
    }
}

export function fromApiContentInlineElementHighlightMarkColor(
    color: ApiContentInlineElementHighlightMarkColor,
): HighlightColor {
    switch (color) {
        case "Red":
            return HighlightColor.Red;
        case "Orange":
            return HighlightColor.Orange;
        case "Green":
            return HighlightColor.Green;
        case "Blue":
            return HighlightColor.Blue;
        case "Purple":
            return HighlightColor.Purple;
        default:
            throw exhaustive(color);
    }
}

function assertCheckListItem(
    item: ApiContentCheckListBlockElementItem | ApiContentListBlockElementItem,
): ApiContentCheckListBlockElementItem {
    assert(typeof item.checked === "boolean");
    return item;
}
