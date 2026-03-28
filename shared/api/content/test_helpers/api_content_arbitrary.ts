import fc, {Arbitrary, MaybeWeightedArbitrary} from "fast-check";
import {produce} from "immer";
import {ApiContentKeyEncoder} from "~/shared/api/content/closed_source/api_content_key_encoder.js";
import {unknownFileId} from "~/shared/api/content/closed_source/unknown_file_id.js";
import {apiContentInlineElementMarkTypeNormalizedOrder} from "~/shared/api/content/normalize_api_content.js";
import {
    isSimpleApiContentTableBlockElementForTest,
    printApiMentionReferenceToMentionUrl,
} from "~/shared/api/content/print_api_content_to_markdown.js";
import {visitDraftApiContent} from "~/shared/api/content/visit_and_produce_api_content.js";
import {apiContentCodeBlockLanguageDefinition} from "~/shared/api/specification/api_content_code_block_language_definition.js";
import {
    ApiAccountReferenceResponse,
    ApiChannelReferenceResponse,
    ApiChatReferenceResponse,
    ApiContentBlockElementResponse,
    ApiContentBreakInlineElement,
    ApiContentCheckListBlockElementItemResponse,
    ApiContentCheckListBlockElementResponse,
    ApiContentCodeBlockElementResponse,
    ApiContentCodeBlockElementTextInlineElement,
    ApiContentCodeBlockElementTextInlineElementMark,
    ApiContentCommentMark,
    ApiContentDividerBlockElementResponse,
    ApiContentFileBlockElementResponse,
    ApiContentFileFloatBlockElementResponse,
    ApiContentFileGalleryBlockElementResponse,
    ApiContentHeadingBlockElementResponse,
    ApiContentHighlightMark,
    ApiContentInlineElementMark,
    ApiContentInlineElementResponse,
    ApiContentLinkMark,
    ApiContentListBlockElementItemResponse,
    ApiContentListBlockElementResponse,
    ApiContentMentionInlineElementResponse,
    ApiContentOrderedListBlockElementResponse,
    ApiContentParagraphBlockElementResponse,
    ApiContentPreviewBlockElementResponse,
    ApiContentQuoteBlockElementBlockElementResponse,
    ApiContentQuoteBlockElementResponse,
    ApiContentResponse,
    ApiContentTableBlockElementCellBlockElementResponse,
    ApiContentTableBlockElementResponse,
    ApiContentTextInlineElement,
    ApiContentUnorderedListBlockElementResponse,
    ApiDocumentReferenceResponse,
    ApiMentionReferenceResponse,
    ApiPreviewReferenceResponse,
    ApiTaskCollectionReferenceResponse,
    ApiTaskReferenceResponse,
    ApiTaskStatus,
} from "~/shared/api/specification/types/api_specification_convenience_types.js";
import {createArrayWithLength} from "~/shared/helpers/array/create_array_with_length.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {mapIterable} from "~/shared/helpers/iterable/map_iterable.js";
import {getObjectKeysWithKeyofType} from "~/shared/helpers/object/get_object_keys_with_keyof_type.js";
import {Id, encodeId, generateId, idByteLength} from "~/shared/id/id.js";
import {
    AccountId,
    BotId,
    ChannelId,
    ChatId,
    DocumentCommentThreadId,
    DocumentId,
    FileId,
    PostId,
    SiteId,
    SpaceId,
    TaskCollectionId,
    TaskId,
} from "~/shared/id/types/id_types.js";

export const apiContentArbitrarySpaceId = generateId<SpaceId>();

// Use TypeScript `Record` so we get a type error when a type is added to the
// union, reminding us that we need to add another entry.
export function createUnionArbitrary<Value extends {readonly type: string}>(
    object: Record<Value["type"], MaybeWeightedArbitrary<Value>>,
): Arbitrary<Value> {
    const arbitraries: Array<MaybeWeightedArbitrary<Value>> = Object.values(object);
    return fc.oneof(...arbitraries);
}

export function createIdArbitrary<Value extends Id>(): Arbitrary<Value> {
    // For each ID type we generate a fixed number of IDs that can be reused. That way
    // we can test behavior when the same ID appears in the content multiple times.
    const reusableIds = createArrayWithLength(5, () => {
        // We generate random IDs for `ChronologicalId`s instead of generating a time based
        // ID. Our property check test will do the same thing.
        return generateId() as unknown as Value;
    });

    return fc.oneof(
        {
            weight: 20 - reusableIds.length,
            arbitrary: fc
                .uint8Array({minLength: idByteLength, maxLength: idByteLength})
                .map(bytes => encodeId<Value>(bytes)),
        },
        ...reusableIds.map(sharedId => ({weight: 1, arbitrary: fc.constant(sharedId)})),
    );
}

export const ApiContentTextArbitrary = fc.oneof(
    {arbitrary: fc.string({unit: "grapheme-ascii"}), weight: 1000},
    {arbitrary: fc.string({unit: "grapheme"}), weight: 100},
    {
        // Some constant strings we look for when parsing agent web pages that may break
        // parsing should they appear so we want our generative test to exercise them.
        arbitrary: fc.oneof(
            fc.constant("Next page »"),
            fc.constant("Previous page »"),
            fc.constant("« Previous page"),
            fc.constant("See more »"),

            // NOTE(calebmer): Occasionally insert HTML character references to make sure they
            // are printed and parsed correctly everywhere.
            fc
                .tuple(
                    fc.oneof(
                        {arbitrary: fc.string({unit: "grapheme-ascii"}), weight: 1000},
                        {arbitrary: fc.string({unit: "grapheme"}), weight: 100},
                    ),
                    fc.constantFrom("&quot;", "&#34;", "&#x22;", "&amp;"),
                    fc.oneof(
                        {arbitrary: fc.string({unit: "grapheme-ascii"}), weight: 1000},
                        {arbitrary: fc.string({unit: "grapheme"}), weight: 100},
                    ),
                )
                .map(parts => parts.join("")),
        ),
        weight: 1,
    },
);

export const ApiChannelReferenceArbitrary: fc.Arbitrary<ApiChannelReferenceResponse> = fc.record({
    type: fc.constant("Channel"),
    id: createIdArbitrary<ChannelId>(),
    title: ApiContentTextArbitrary,
});

export const ApiChatReferenceArbitrary: fc.Arbitrary<ApiChatReferenceResponse> = fc.record({
    type: fc.constant("Chat"),
    id: createIdArbitrary<ChatId>(),
    title: ApiContentTextArbitrary,
});

export const ApiDocumentReferenceArbitrary: fc.Arbitrary<ApiDocumentReferenceResponse> = fc.record({
    type: fc.constant("Document"),
    id: createIdArbitrary<DocumentId>(),
    title: ApiContentTextArbitrary,
});

export const ApiTaskStatusArbitrary: fc.Arbitrary<ApiTaskStatus> = fc.oneof(
    fc.constant({type: "Open", isActive: false}),
    fc.constant({type: "Open", isActive: true}),
    fc.constant({type: "Closed"}),
);

export const ApiTaskReferenceArbitrary: fc.Arbitrary<ApiTaskReferenceResponse> = fc.record({
    type: fc.constant("Task"),
    id: createIdArbitrary<TaskId>(),
    title: ApiContentTextArbitrary,
    status: ApiTaskStatusArbitrary,
});

export const ApiTaskCollectionReferenceArbitrary: fc.Arbitrary<ApiTaskCollectionReferenceResponse> =
    fc.record({
        type: fc.constant("TaskCollection"),
        id: createIdArbitrary<TaskCollectionId>(),
        title: ApiContentTextArbitrary,
    });

const ApiPreviewReferenceArbitraries = {
    Channel: ApiChannelReferenceArbitrary,
    Chat: ApiChatReferenceArbitrary,
    Document: ApiDocumentReferenceArbitrary,
    Post: fc.record({
        type: fc.constant("Post"),
        id: createIdArbitrary<PostId>(),
        title: ApiContentTextArbitrary,
    }),
    Task: ApiTaskReferenceArbitrary,
    TaskCollection: ApiTaskCollectionReferenceArbitrary,
    Site: fc.record({
        type: fc.constant("Site"),
        id: createIdArbitrary<SiteId>(),
        title: ApiContentTextArbitrary,
    }),
};

export const ApiAccountReferenceArbitrary: fc.Arbitrary<ApiAccountReferenceResponse> = fc.record({
    type: fc.constant("Account"),
    id: createIdArbitrary<AccountId>(),
    title: ApiContentTextArbitrary,
    shortName: ApiContentTextArbitrary,
    bot: fc.oneof(
        {weight: 10, arbitrary: fc.constant(undefined)},
        {weight: 1, arbitrary: fc.record({id: createIdArbitrary<BotId>()})},
    ),
});

export const ApiMentionReferenceArbitrary = createUnionArbitrary<ApiMentionReferenceResponse>({
    ...ApiPreviewReferenceArbitraries,
    Account: ApiAccountReferenceArbitrary,
});

const ApiContentLinkMarkArbitrary: Arbitrary<ApiContentLinkMark> = fc.record({
    type: fc.constant("Link"),
    url: fc.oneof(
        {weight: 50, arbitrary: fc.webUrl()},
        {weight: 1, arbitrary: fc.string({unit: "grapheme"})},

        // We have special handling for link marks that look like mentions so they're not
        // parsed as mention nodes. Make sure we generate mention-looking URLs.
        {
            weight: 1,
            arbitrary: fc
                .tuple(ApiMentionReferenceArbitrary, fc.boolean())
                .map(([referencePathObject, isAccountShortName]) =>
                    printApiMentionReferenceToMentionUrl(referencePathObject, {
                        isAccountShortName,
                    }),
                ),
        },
    ),
});

const ApiContentHighlightMarkArbitrary: Arbitrary<ApiContentHighlightMark> = fc.record({
    type: fc.constant("Highlight"),
    color: fc.oneof(
        fc.constant("Red"),
        fc.constant("Orange"),
        fc.constant("Green"),
        fc.constant("Blue"),
        fc.constant("Purple"),
    ),
});

const ApiContentCommentMarkArbitrary: Arbitrary<ApiContentCommentMark> = fc.record({
    type: fc.constant("Comment"),
    thread: fc.record({
        id: createIdArbitrary<DocumentCommentThreadId>(),
    }),
});

const ApiContentInlineElementMarkArbitrary = createUnionArbitrary<ApiContentInlineElementMark>({
    Bold: fc.constant({type: "Bold"}),
    Italic: fc.constant({type: "Italic"}),
    Strike: fc.constant({type: "Strike"}),
    Code: fc.constant({type: "Code"}),
    Link: ApiContentLinkMarkArbitrary,
    Highlight: ApiContentHighlightMarkArbitrary,
    Comment: ApiContentCommentMarkArbitrary,
});

const ApiContentTextInlineElementArbitrary: Arbitrary<ApiContentTextInlineElement> = fc.record({
    type: fc.constant("Text"),
    text: ApiContentTextArbitrary,
    marks: fc.oneof(
        {arbitrary: fc.constant([]), weight: 5},
        fc.array(ApiContentInlineElementMarkArbitrary, {
            maxLength: apiContentInlineElementMarkTypeNormalizedOrder.length,
        }),
    ),
});

const ApiContentBreakInlineElementArbitrary: Arbitrary<ApiContentBreakInlineElement> = fc.record({
    type: fc.constant("Break"),
    marks: fc.oneof(
        {arbitrary: fc.constant([]), weight: 50},
        fc.array(ApiContentInlineElementMarkArbitrary, {
            maxLength: apiContentInlineElementMarkTypeNormalizedOrder.length,
        }),
    ),
});

const apiContentKeyEncoder = new ApiContentKeyEncoder({entityId: "Test", version: 0});

// We don't really need to exercise content keys in the generative test. So choose
// randomly between one of 5 constant values.
const ApiContentKeyArbitrary = fc.oneof(
    ...[0, 1, 2, 3, 4].map(pos =>
        fc.constant(apiContentKeyEncoder.encode({pos, nodeSize: 0, inlineContent: true})),
    ),
);

const ApiContentFileBlockElementArbitrary: Arbitrary<ApiContentFileBlockElementResponse> =
    fc.record({
        type: fc.constant("File"),
        key: ApiContentKeyArbitrary,
        file: fc.record({
            id: fc.oneof(
                {weight: 100, arbitrary: createIdArbitrary<FileId>()},
                {weight: 1, arbitrary: fc.constant(unknownFileId)},
            ),
            contentType: fc.oneof(
                fc.constant("image/png"),
                fc.constant("image/jpeg"),
                fc.constant("video/mp4"),
                fc.constant("audio/mpeg"),
                fc.constant("application/pdf"),
                fc.constant("application/yaml"),
                fc.constant("application/octet-stream"),
            ),
            contentLength: fc.integer({min: 0}),
        }),
        marks: fc.oneof(
            {arbitrary: fc.constant([]), weight: 20},
            fc.array(ApiContentCommentMarkArbitrary, {maxLength: 3}),
        ),
    });

const ApiPreviewReferenceArbitrary = createUnionArbitrary<ApiPreviewReferenceResponse>(
    ApiPreviewReferenceArbitraries,
);

const ApiContentPreviewBlockElementArbitrary: Arbitrary<ApiContentPreviewBlockElementResponse> =
    fc.record({
        type: fc.constant("Preview"),
        key: ApiContentKeyArbitrary,
        reference: ApiPreviewReferenceArbitrary,
        marks: fc.oneof(
            {arbitrary: fc.constant([]), weight: 20},
            fc.array(ApiContentCommentMarkArbitrary, {maxLength: 3}),
        ),
    });

const ApiContentFileGalleryBlockElementArbitrary: Arbitrary<ApiContentFileGalleryBlockElementResponse> =
    fc.record({
        type: fc.constant("FileGallery"),
        rows: fc.array(
            fc
                .array(
                    fc.oneof(
                        ApiContentFileBlockElementArbitrary,
                        ApiContentPreviewBlockElementArbitrary,
                    ),
                    {minLength: 1, maxLength: 3},
                )
                .map(elements => {
                    // Generate integer-percent-friendly widths that round-trip cleanly through the
                    // printer (which rounds to integer percents). Derive the last from 100 -
                    // sum(previous) so they sum to exactly 100, then divide by 100.
                    let percentSum = 0;
                    const items = elements.map((element, i) => {
                        const percent =
                            i < elements.length - 1
                                ? Math.round(100 / elements.length)
                                : 100 - percentSum;

                        percentSum += percent;
                        return {width: percent / 100, element};
                    });
                    return {items};
                }),
            {minLength: 1},
        ),
    });

const ApiContentFileFloatBlockElementArbitrary: Arbitrary<ApiContentFileFloatBlockElementResponse> =
    fc.record({
        type: fc.constant("FileFloat"),
        side: fc.oneof(fc.constant("Left"), fc.constant("Right")),
        element: fc.oneof(
            ApiContentFileBlockElementArbitrary,
            ApiContentPreviewBlockElementArbitrary,
        ),
    });

const ApiContentMentionInlineElementArbitrary: Arbitrary<ApiContentMentionInlineElementResponse> =
    fc.record({
        type: fc.constant("Mention"),
        reference: ApiMentionReferenceArbitrary,
        isAccountShortName: fc.boolean(),
        marks: fc.oneof(
            {arbitrary: fc.constant([]), weight: 30},
            fc.array(ApiContentInlineElementMarkArbitrary, {
                maxLength: apiContentInlineElementMarkTypeNormalizedOrder.length,
            }),
        ),
    });

export const ApiContentInlineElementArbitrary =
    createUnionArbitrary<ApiContentInlineElementResponse>({
        Text: {arbitrary: ApiContentTextInlineElementArbitrary, weight: 50},
        Mention: {arbitrary: ApiContentMentionInlineElementArbitrary, weight: 10},
        Break: {arbitrary: ApiContentBreakInlineElementArbitrary, weight: 1},
    });

export const ApiContentInlineElementWithoutCommentMarkArbitrary =
    ApiContentInlineElementArbitrary.map(element => {
        return produce(element, element => {
            if (element.marks?.some(mark => mark.type === "Comment")) {
                element.marks = element.marks.filter(mark => mark.type !== "Comment");
            }
        });
    });

const ApiContentInlineElementArbitraryForSimpleTable =
    createUnionArbitrary<ApiContentInlineElementResponse>({
        Text: {
            arbitrary: ApiContentTextInlineElementArbitrary.filter(element => {
                // `printSimpleApiContentTableBlockElementToMarkdownIfPossible()` has to bail out
                // in this case. So don't allow these elements in the simple table arbitrary.
                const hasSimpleTableBailOutCase =
                    element.marks?.some(mark => mark.type === "Code") &&
                    element.text.includes("\\|");

                return !hasSimpleTableBailOutCase;
            }),
            weight: 50,
        },
        Mention: {arbitrary: ApiContentMentionInlineElementArbitrary, weight: 10},
        Break: {arbitrary: ApiContentBreakInlineElementArbitrary, weight: 1},
    });

const ApiContentParagraphBlockElementArbitrary: Arbitrary<ApiContentParagraphBlockElementResponse> =
    fc.record({
        type: fc.constant("Paragraph"),
        key: ApiContentKeyArbitrary,
        elements: fc.array(ApiContentInlineElementArbitrary),
    });

const ApiContentParagraphBlockElementArbitraryForSimpleTable: Arbitrary<ApiContentParagraphBlockElementResponse> =
    fc.record({
        type: fc.constant("Paragraph"),
        key: ApiContentKeyArbitrary,
        elements: fc.array(ApiContentInlineElementArbitraryForSimpleTable),
    });

const {
    ApiContentUnorderedListBlockElementArbitrary,
    ApiContentOrderedListBlockElementArbitrary,
    ApiContentCheckListBlockElementArbitrary,
} = fc.letrec<{
    ApiContentListBlockElementArbitrary: ApiContentListBlockElementResponse;
    ApiContentListBlockElementItemArbitrary: ApiContentListBlockElementItemResponse;
    ApiContentCheckListBlockElementItemArbitrary: ApiContentCheckListBlockElementItemResponse;
    ApiContentUnorderedListBlockElementArbitrary: ApiContentUnorderedListBlockElementResponse;
    ApiContentOrderedListBlockElementArbitrary: ApiContentOrderedListBlockElementResponse;
    ApiContentCheckListBlockElementArbitrary: ApiContentCheckListBlockElementResponse;
}>(tie => {
    const ApiContentListBlockElementArbitrary: Arbitrary<ApiContentListBlockElementResponse> =
        fc.oneof(
            tie("ApiContentUnorderedListBlockElementArbitrary"),
            tie("ApiContentOrderedListBlockElementArbitrary"),
            tie("ApiContentCheckListBlockElementArbitrary"),
        );

    const ListItemElementArbitrary = fc.oneof(
        {
            weight: 200,
            arbitrary: fc.tuple(ApiContentParagraphBlockElementArbitrary),
        },
        {
            weight: 1,
            arbitrary: fc.tuple(
                ApiContentParagraphBlockElementArbitrary,
                ApiContentParagraphBlockElementArbitrary,
            ),
        },
        {
            weight: 1,
            arbitrary: fc.tuple(
                ApiContentParagraphBlockElementArbitrary,
                ApiContentParagraphBlockElementArbitrary,
                ApiContentParagraphBlockElementArbitrary,
            ),
        },
        {weight: 1, arbitrary: fc.tuple()},
    );

    const NestedListItemElementArbitrary = fc.oneof(
        {maxDepth: 5},
        {weight: 200, arbitrary: fc.tuple()},
        {weight: 20, arbitrary: fc.tuple(ApiContentListBlockElementArbitrary)},
        {
            weight: 1,
            arbitrary: fc.tuple(
                ApiContentListBlockElementArbitrary,
                ApiContentListBlockElementArbitrary,
            ),
        },
        {
            weight: 1,
            arbitrary: fc.tuple(
                ApiContentListBlockElementArbitrary,
                ApiContentListBlockElementArbitrary,
                ApiContentListBlockElementArbitrary,
            ),
        },
    );

    const ApiContentListBlockElementItemArbitrary: Arbitrary<ApiContentListBlockElementItemResponse> =
        fc.record({
            elements: ListItemElementArbitrary,
            nestedListElements: NestedListItemElementArbitrary,
        });

    const ApiContentCheckListBlockElementItemArbitrary: Arbitrary<ApiContentCheckListBlockElementItemResponse> =
        fc.record({
            checked: fc.boolean(),
            elements: ListItemElementArbitrary,
            nestedListElements: NestedListItemElementArbitrary,
        });

    const ApiContentUnorderedListBlockElementArbitrary: Arbitrary<ApiContentUnorderedListBlockElementResponse> =
        fc.record({
            type: fc.constant("UnorderedList"),
            items: fc.array(ApiContentListBlockElementItemArbitrary),
        });

    const ApiContentOrderedListBlockElementArbitrary: Arbitrary<ApiContentOrderedListBlockElementResponse> =
        fc.record({
            type: fc.constant("OrderedList"),
            items: fc.array(ApiContentListBlockElementItemArbitrary),
        });

    const ApiContentCheckListBlockElementArbitrary: Arbitrary<ApiContentCheckListBlockElementResponse> =
        fc.record({
            type: fc.constant("CheckList"),
            items: fc.array(ApiContentCheckListBlockElementItemArbitrary),
        });

    return {
        ApiContentListBlockElementArbitrary,
        ApiContentListBlockElementItemArbitrary,
        ApiContentUnorderedListBlockElementArbitrary,
        ApiContentOrderedListBlockElementArbitrary,
        ApiContentCheckListBlockElementArbitrary,
        ApiContentCheckListBlockElementItemArbitrary,
    };
});

const ApiContentQuoteBlockElementArbitrary: Arbitrary<ApiContentQuoteBlockElementResponse> =
    fc.record({
        type: fc.constant("Quote"),
        elements: fc.array(
            createUnionArbitrary<ApiContentQuoteBlockElementBlockElementResponse>({
                Paragraph: ApiContentParagraphBlockElementArbitrary,
                UnorderedList: ApiContentUnorderedListBlockElementArbitrary,
                OrderedList: ApiContentOrderedListBlockElementArbitrary,
                CheckList: ApiContentCheckListBlockElementArbitrary,
            }),
        ),
    });

const ApiContentHeadingBlockElementArbitrary: Arbitrary<ApiContentHeadingBlockElementResponse> =
    fc.record({
        type: fc.constant("Heading"),
        key: ApiContentKeyArbitrary,
        level: fc.oneof(fc.constant(1), fc.constant(2), fc.constant(3)),
        elements: fc.array(ApiContentInlineElementArbitrary),
    });

const ApiContentDividerBlockElementArbitrary: Arbitrary<ApiContentDividerBlockElementResponse> =
    fc.record({
        type: fc.constant("Divider"),
        key: ApiContentKeyArbitrary,
    });

const ApiContentCodeBlockElementTextInlineElementMarkArbitrary =
    createUnionArbitrary<ApiContentCodeBlockElementTextInlineElementMark>({
        Bold: fc.constant({type: "Bold"}),
        Italic: fc.constant({type: "Italic"}),
        Strike: fc.constant({type: "Strike"}),
        Link: ApiContentLinkMarkArbitrary,
        Highlight: ApiContentHighlightMarkArbitrary,
        Comment: ApiContentCommentMarkArbitrary,
    });

const ApiContentCodeBlockElementTextInlineElementArbitrary: Arbitrary<ApiContentCodeBlockElementTextInlineElement> =
    fc.record({
        type: fc.constant("Text"),
        text: ApiContentTextArbitrary,
        marks: fc.oneof(
            {arbitrary: fc.constant([]), weight: 5},
            fc.array(ApiContentCodeBlockElementTextInlineElementMarkArbitrary, {
                maxLength: apiContentInlineElementMarkTypeNormalizedOrder.length,
            }),
        ),
    });

const ApiContentCodeBlockElementArbitrary: Arbitrary<ApiContentCodeBlockElementResponse> =
    fc.record({
        type: fc.constant("Code"),
        language: fc.oneof(
            ...mapIterable(
                getObjectKeysWithKeyofType(apiContentCodeBlockLanguageDefinition),
                language => fc.constant(language),
            ),
        ),
        lines: fc.array(
            fc.record({
                key: ApiContentKeyArbitrary,
                elements: fc.array(ApiContentCodeBlockElementTextInlineElementArbitrary),
            }),
        ),
    });

// Schema requires tableCell{2,} so tables must have at least 2 columns
const ApiContentTableBlockElementArbitrary: Arbitrary<ApiContentTableBlockElementResponse> =
    fc.oneof(
        // Simple table that should be formatted as a GFM table.
        fc
            .record({
                type: fc.constant("Table"),
                width: fc.constant(1),
                hasHeaderRow: fc.constant(true),
                hasHeaderColumn: fc.constant(false),
                columns: fc.array(fc.record({width: fc.constant(1)}), {minLength: 2}),
                rows: fc.array(
                    fc.record({
                        cells: fc.array(
                            fc.record({
                                elements: fc.tuple(
                                    ApiContentParagraphBlockElementArbitraryForSimpleTable,
                                ),
                            }),
                            {minLength: 2},
                        ),
                    }),
                ),
            })
            .map(oldTable => {
                let columnCount = 0;

                for (const row of oldTable.rows) {
                    columnCount = Math.max(columnCount, row.cells.length);
                }

                const rows = oldTable.rows.map(row => {
                    if (row.cells.length === columnCount) return row;

                    return {
                        cells: [
                            ...row.cells,
                            ...createArrayWithLength(columnCount - row.cells.length, () => ({
                                elements: [],
                            })),
                        ],
                    };
                });

                const newTable: ApiContentTableBlockElementResponse = {...oldTable, rows};

                // Make sure we can print the table as a GFM table.
                assert(isSimpleApiContentTableBlockElementForTest(newTable));
                return newTable;
            }),

        // Arbitrary table that's not limited to simple constructs that'll work in a GFM
        // table.
        fc.record({
            type: fc.constant("Table"),
            width: fc.float({min: 1, max: 20, noNaN: true}),
            hasHeaderRow: fc.boolean(),
            hasHeaderColumn: fc.boolean(),
            columns: fc.array(
                fc.record({width: fc.float({min: Math.fround(0.01), max: 20, noNaN: true})}),
                {minLength: 2},
            ),
            rows: fc.array(
                fc.record({
                    cells: fc.array(
                        fc.record({
                            elements: fc.array(
                                createUnionArbitrary<ApiContentTableBlockElementCellBlockElementResponse>(
                                    {
                                        Paragraph: ApiContentParagraphBlockElementArbitrary,
                                        UnorderedList: ApiContentUnorderedListBlockElementArbitrary,
                                        OrderedList: ApiContentOrderedListBlockElementArbitrary,
                                        Quote: ApiContentQuoteBlockElementArbitrary,
                                        Code: ApiContentCodeBlockElementArbitrary,
                                        CheckList: ApiContentCheckListBlockElementArbitrary,
                                        File: ApiContentFileBlockElementArbitrary,
                                        Preview: ApiContentPreviewBlockElementArbitrary,
                                    },
                                ),
                            ),
                        }),
                        {minLength: 2},
                    ),
                }),
            ),
        }),
    );

const ApiContentBlockElementArbitrary = createUnionArbitrary<ApiContentBlockElementResponse>({
    Paragraph: {arbitrary: ApiContentParagraphBlockElementArbitrary, weight: 20},
    UnorderedList: ApiContentUnorderedListBlockElementArbitrary,
    OrderedList: ApiContentOrderedListBlockElementArbitrary,
    CheckList: ApiContentCheckListBlockElementArbitrary,
    Quote: ApiContentQuoteBlockElementArbitrary,
    Heading: ApiContentHeadingBlockElementArbitrary,
    Divider: ApiContentDividerBlockElementArbitrary,
    Code: ApiContentCodeBlockElementArbitrary,
    Table: ApiContentTableBlockElementArbitrary,
    File: ApiContentFileBlockElementArbitrary,
    FileGallery: ApiContentFileGalleryBlockElementArbitrary,
    FileFloat: ApiContentFileFloatBlockElementArbitrary,
    Preview: ApiContentPreviewBlockElementArbitrary,
});

export const ApiContentArbitrary: Arbitrary<ApiContentResponse> = fc.record({
    elements: fc.array(ApiContentBlockElementArbitrary),
});

export const ApiContentWithoutCommentMarkArbitrary: Arbitrary<ApiContentResponse> =
    ApiContentArbitrary.map(content => {
        return produce(content, content => {
            visitDraftApiContent(content, {
                visitInlineElement: element => {
                    if (element.marks?.some(mark => mark.type === "Comment")) {
                        element.marks = element.marks.filter(mark => mark.type !== "Comment");
                    }
                },
                visitBlockElement: element => {
                    if (
                        "marks" in element &&
                        element.marks?.some(mark => mark.type === "Comment")
                    ) {
                        element.marks = element.marks.filter(mark => mark.type !== "Comment");
                    }
                },
            });
        });
    });
