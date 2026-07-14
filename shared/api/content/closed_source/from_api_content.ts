import {Mark, Node} from "prosemirror-model";
import {assertApiCheckListBlockElementItem} from "~/shared/api/content/assert_api_check_list_block_element_item.js";
import {unknownFileId} from "~/shared/api/content/closed_source/unknown_file_id.js";
import {normalizeApiContentInlineElementMarks} from "~/shared/api/content/normalize_api_content.js";
import {intoApiContentParagraphBlockElement} from "~/shared/api/content/parse_api_content_from_markdown.js";
import {
    ApiContent,
    ApiContentBlockElement,
    ApiContentFileBlockElement,
    ApiContentHighlightMarkColor,
    ApiContentInlineElement,
    ApiContentInlineElementMark,
    ApiContentListBlockElement,
    ApiContentMentionInlineElement,
    ApiContentPreviewBlockElement,
    ApiContentTableBlockElementCellBlockElement,
    ApiPreviewReference,
} from "~/shared/api/specification/types/api_specification_convenience_types.js";
import {ContentMention} from "~/shared/content/content_mention.js";
import {ContentListItemNodeTypeName} from "~/shared/content/content_node_type_name.js";
import {
    ContentProsemirrorSchema,
    maxContentListItemIndentation,
} from "~/shared/content/content_schema.js";
import {HighlightColor} from "~/shared/design/core/highlight_color.js";
import {InvalidArgumentError} from "~/shared/error/error.js";
import {errorDisplayMessage} from "~/shared/error/error_display_message.js";
import {filterMapArray} from "~/shared/helpers/array/filter_map_array.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {concatIterables} from "~/shared/helpers/iterable/concat_iterables.js";
import {SearchMentionEntityId} from "~/shared/search/search_entity_id.js";

/**
 * Convert content from the API back into ProseMirror nodes.
 */
export function fromApiContent(schema: ContentProsemirrorSchema, content: ApiContent): Node {
    const blockNodes = Array.from(fromApiContentBlockElements(schema, content.elements));

    return schema.nodes.doc.create(
        null,
        blockNodes.length > 0 ? blockNodes : [schema.nodes.paragraph.create()],
    );
}

/**
 * Converts a title string and API content into the ordered child nodes of a
 * document `doc`: a `title` node followed by the body block nodes. Unlike
 * `fromApiContent()`, which returns a full `doc` node, this returns just the
 * children so callers can wrap them in a `doc` with the appropriate attributes
 * (e.g. the `accessPolicy` on document create).
 */
export function fromApiContentToDocumentChildNodes(
    schema: ContentProsemirrorSchema,
    title: string,
    content: ApiContent,
): ReadonlyArray<Node> {
    assert(schema.nodes.title);

    const blockNodes = Array.from(
        concatIterables(
            [schema.nodes.title.create(null, title.length > 0 ? schema.text(title) : null)],
            fromApiContentBlockElements(schema, content.elements),
        ),
    );

    if (blockNodes.length === 1) {
        blockNodes.push(schema.nodes.paragraph.create());
    }

    return blockNodes;
}

export function* fromApiContentBlockElements(
    schema: ContentProsemirrorSchema,
    elements: Iterable<ApiContentBlockElement>,
): IterableIterator<Node> {
    for (const element of elements) {
        switch (element.type) {
            case "Paragraph": {
                yield schema.nodes.paragraph.create(
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

                        const attrs: {indent: number; checked?: boolean; orderStart?: number} = {
                            indent: clampedIndent,
                        };

                        if (typeName === "checkListItem") {
                            attrs.checked = assertApiCheckListBlockElementItem(item).checked;
                        }

                        // Only set orderStart for the first ordered list item. Subsequent items
                        // auto-increment naturally.
                        if (element.type === "OrderedList" && itemIndex === 0) {
                            attrs.orderStart = element.orderStart;
                        }

                        if (item.elements.length === 0) {
                            if (
                                element.type !== "UnorderedList" ||
                                itemIndex > 0 ||
                                item.nestedListElements === undefined ||
                                item.nestedListElements.every(
                                    nestedElement => nestedElement.items.length === 0,
                                )
                            ) {
                                const nodeType = schema.nodes[typeName];

                                if (!nodeType) {
                                    throw new InvalidArgumentError(
                                        "Unsupported node type in this content schema",
                                        {
                                            displayMessage: errorDisplayMessage`\`${element.type}\` elements aren\u2019t supported in this type of content. Try again without \`${element.type}\` elements.`,
                                        },
                                    );
                                }

                                yield nodeType.create(attrs, schema.nodes.paragraph.create());
                            }
                        } else {
                            const nodeType = schema.nodes[typeName];

                            if (!nodeType) {
                                throw new InvalidArgumentError(
                                    "Unsupported node type in this content schema",
                                    {
                                        displayMessage: errorDisplayMessage`\`${element.type}\` elements aren\u2019t supported in this type of content. Try again without \`${element.type}\` elements.`,
                                    },
                                );
                            }

                            yield nodeType.create(
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
                    quoteContent.push(schema.nodes.paragraph.create());
                }

                yield schema.nodes.quoteBlock.create(null, quoteContent);
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
                const rows = element.rows.map(row => {
                    const cells = row.cells.map(cell => {
                        const cellContent = Array.from(
                            fromApiContentTableCellBlockElements(schema, cell.elements),
                        );

                        // Table cells require at least one block element (tableBlock+) If the cell is
                        // empty, create an empty paragraph
                        if (cellContent.length === 0) {
                            cellContent.push(schema.nodes.paragraph.create());
                        }

                        return schema.nodes.tableCell.create(null, cellContent);
                    });

                    while (cells.length < 2) {
                        cells.push(
                            schema.nodes.tableCell.create(null, schema.nodes.paragraph.create()),
                        );
                    }

                    return schema.nodes.tableRow.create(null, cells);
                });

                if (rows.length < 1) {
                    rows.push(
                        schema.nodes.tableRow.create(null, [
                            schema.nodes.tableCell.create(null, schema.nodes.paragraph.create()),
                            schema.nodes.tableCell.create(null, schema.nodes.paragraph.create()),
                        ]),
                    );
                }

                yield schema.nodes.table.create(
                    {
                        tableWidth: element.width,
                        columnWidths: element.columns.map(column => column.width),
                        hasHeaderRow: element.hasHeaderRow,
                        hasHeaderColumn: element.hasHeaderColumn,
                    },
                    rows,
                );
                break;
            }
            case "Code": {
                const lines = element.lines.map(line => {
                    return schema.nodes.codeBlockLine.create(
                        null,
                        fromApiContentInlineElements(schema, line.elements),
                    );
                });

                if (lines.length < 1) {
                    lines.push(schema.nodes.codeBlockLine.create());
                }

                yield schema.nodes.codeBlock.create({language: element.language}, lines);
                break;
            }
            case "File":
            case "Preview": {
                if (!schema.nodes.fileRow) {
                    throw new InvalidArgumentError("Unsupported node type in this content schema", {
                        displayMessage: errorDisplayMessage`\`${element.type}\` elements aren\u2019t supported in this type of content. Try again without \`${element.type}\` elements.`,
                    });
                }

                yield schema.nodes.fileRow.create(null, [
                    fromApiContentFileOrPreviewElement(schema, element),
                ]);
                break;
            }
            case "FileGallery": {
                if (!schema.nodes.fileRow) {
                    throw new InvalidArgumentError("Unsupported node type in this content schema", {
                        displayMessage: errorDisplayMessage`\`${element.type}\` elements aren\u2019t supported in this type of content. Try again without \`${element.type}\` elements.`,
                    });
                }

                for (const row of element.rows) {
                    const fileNodes = row.items.map(item =>
                        fromApiContentFileOrPreviewElement(schema, item.element),
                    );

                    yield schema.nodes.fileRow.create(null, fileNodes);
                }
                break;
            }
            case "FileFloat": {
                if (!schema.nodes.fileFloat) {
                    throw new InvalidArgumentError("Unsupported node type in this content schema", {
                        displayMessage: errorDisplayMessage`\`${element.type}\` elements aren\u2019t supported in this type of content. Try again without \`${element.type}\` elements.`,
                    });
                }

                const fileNode = fromApiContentFileOrPreviewElement(schema, element.element);
                yield schema.nodes.fileFloat.create(
                    {direction: element.side === "Left" ? "left" : "right"},
                    [fileNode],
                );
                break;
            }
            default:
                throw exhaustive(element);
        }
    }
}

/**
 * Convert table cell block elements to ProseMirror nodes. File and Preview
 * elements inside table cells use the `fileRowTable` node type instead of the
 * top-level `fileRow` node type.
 */
function* fromApiContentTableCellBlockElements(
    schema: ContentProsemirrorSchema,
    elements: Iterable<ApiContentTableBlockElementCellBlockElement>,
): IterableIterator<Node> {
    for (const element of elements) {
        switch (element.type) {
            case "File":
            case "Preview": {
                if (!schema.nodes.fileRowTable) {
                    throw new InvalidArgumentError("Unsupported node type in this content schema", {
                        displayMessage: errorDisplayMessage`\`${element.type}\` elements aren\u2019t supported in this type of content. Try again without \`${element.type}\` elements.`,
                    });
                }

                yield schema.nodes.fileRowTable.create(null, [
                    fromApiContentFileOrPreviewElement(schema, element),
                ]);
                break;
            }
            default:
                yield* fromApiContentBlockElements(schema, [element]);
                break;
        }
    }
}

function fromApiContentFileOrPreviewElement(
    schema: ContentProsemirrorSchema,
    element: ApiContentFileBlockElement | ApiContentPreviewBlockElement,
): Node {
    switch (element.type) {
        case "File": {
            if (!schema.nodes.file) {
                throw new InvalidArgumentError("Unsupported node type in this content schema", {
                    displayMessage: errorDisplayMessage`\`${element.type}\` elements aren\u2019t supported in this type of content. Try again without \`${element.type}\` elements.`,
                });
            }

            const marks = normalizeApiContentInlineElementMarks(element.marks);

            return schema.nodes.file.create(
                {fileId: element.file.id === unknownFileId ? null : element.file.id},
                undefined,
                marks?.map(mark => {
                    if (!schema.marks.comment) {
                        throw new InvalidArgumentError(
                            "Unsupported node type in this content schema",
                            {
                                displayMessage: errorDisplayMessage`\`${mark.type}\` marks aren\u2019t supported in this type of content. Try again without \`${mark.type}\`marks.`,
                            },
                        );
                    }

                    return schema.marks.comment.create({commentThreadId: mark.thread.id});
                }),
            );
        }
        case "Preview": {
            if (!schema.nodes.file) {
                throw new InvalidArgumentError("Unsupported node type in this content schema", {
                    displayMessage: errorDisplayMessage`\`${element.type}\` elements aren\u2019t supported in this type of content. Try again without \`${element.type}\` elements.`,
                });
            }

            const marks = normalizeApiContentInlineElementMarks(element.marks);

            return schema.nodes.file.create(
                {fileId: previewReferenceToFileEntityId(element.reference)},
                undefined,
                marks?.map(mark => {
                    if (!schema.marks.comment) {
                        throw new InvalidArgumentError(
                            "Unsupported node type in this content schema",
                            {
                                displayMessage: errorDisplayMessage`\`${mark.type}\` marks aren\u2019t supported in this type of content. Try again without \`${mark.type}\`marks.`,
                            },
                        );
                    }

                    return schema.marks.comment.create({commentThreadId: mark.thread.id});
                }),
            );
        }
        default:
            throw exhaustive(element);
    }
}

function previewReferenceToFileEntityId(target: ApiPreviewReference): string {
    // Construct a FileEntityId (`Type:id`) from the preview target.
    switch (target.type) {
        case "Channel":
        case "Chat":
        case "Document":
        case "Post":
        case "Site":
        case "Task":
        case "TaskCollection":
            return `${target.type}:${target.id}`;
        default:
            throw exhaustive(target);
    }
}

function fromApiContentInlineElements(
    schema: ContentProsemirrorSchema,
    elements: ReadonlyArray<ApiContentInlineElement>,
): ReadonlyArray<Node> {
    return filterMapArray(elements, element => {
        if (element.type === "Text" && element.text === "") return;
        return fromApiContentInlineElement(schema, element);
    });
}

function fromApiContentInlineElement(
    schema: ContentProsemirrorSchema,
    element: ApiContentInlineElement,
): Node {
    const marks = fromApiContentInlineElementMarks(schema, element.marks);

    switch (element.type) {
        case "Text": {
            return schema.text(element.text, marks);
        }
        case "Break": {
            return schema.nodes.break.create(null, null, marks);
        }
        case "Mention": {
            return fromApiContentMentionInlineElement(schema, element, marks);
        }
        default:
            throw exhaustive(element);
    }
}

function fromApiContentMentionInlineElement(
    schema: ContentProsemirrorSchema,
    element: ApiContentMentionInlineElement,
    marks: ReadonlyArray<Mark> | undefined,
) {
    if (!schema.nodes.mention) {
        throw new InvalidArgumentError("Unsupported node type in this content schema", {
            displayMessage: errorDisplayMessage`\`${element.type}\` elements aren\u2019t supported in this type of content. Try again without \`${element.type}\` elements.`,
        });
    }

    const mentionReference = element.reference;
    let mention: ContentMention;

    if (mentionReference.type === "Account") {
        mention = {
            type: "Account",
            accountId: mentionReference.id,
            isShort: element.isAccountShortName ?? false,
        };
    } else {
        let entityId: SearchMentionEntityId;

        switch (mentionReference.type) {
            case "Document": {
                entityId = `Document:${mentionReference.id}`;
                break;
            }
            case "Channel": {
                entityId = `Channel:${mentionReference.id}`;
                break;
            }
            case "Chat": {
                entityId = `Chat:${mentionReference.id}`;
                break;
            }
            case "Task": {
                entityId = `Task:${mentionReference.id}`;
                break;
            }
            case "TaskCollection": {
                entityId = `TaskCollection:${mentionReference.id}`;
                break;
            }
            case "Post": {
                entityId = `Post:${mentionReference.id}`;
                break;
            }
            case "Site": {
                entityId = `Site:${mentionReference.id}`;
                break;
            }
            default:
                throw exhaustive(mentionReference);
        }

        mention = {
            type: "SearchEntity",
            entityId,
        };
    }

    return schema.nodes.mention.create({mention}, null, marks);
}

function fromApiContentInlineElementMarks(
    schema: ContentProsemirrorSchema,
    marks: ReadonlyArray<ApiContentInlineElementMark> | undefined,
): ReadonlyArray<Mark> | undefined {
    marks = normalizeApiContentInlineElementMarks(marks);
    if (marks === undefined) return undefined;
    return filterMapArray(marks, mark => fromApiContentInlineElementMark(schema, mark));
}

function fromApiContentInlineElementMark(
    schema: ContentProsemirrorSchema,
    mark: ApiContentInlineElementMark,
): Mark | undefined {
    switch (mark.type) {
        case "Link":
            return schema.marks.link.create({url: mark.url});
        case "Italic":
            return schema.marks.italic.create();
        case "Bold":
            return schema.marks.bold.create();
        case "Code":
            return schema.marks.code.create();
        case "Strike":
            return schema.marks.strike.create();

        case "Highlight": {
            if (!schema.marks.highlight) return;

            return schema.marks.highlight.create({
                color: fromApiContentInlineElementHighlightMarkColor(mark.color),
            });
        }
        case "Comment": {
            if (!schema.marks.comment) return;

            return schema.marks.comment.create({commentThreadId: mark.thread.id});
        }
        default:
            throw exhaustive(mark);
    }
}

export function fromApiContentInlineElementHighlightMarkColor(
    color: ApiContentHighlightMarkColor,
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
