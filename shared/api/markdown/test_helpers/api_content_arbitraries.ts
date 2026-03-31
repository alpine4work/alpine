import fc, {Arbitrary, MaybeWeightedArbitrary} from "fast-check";
import {apiContentInlineElementMarkTypeNormalizedOrder} from "~/shared/api/markdown/normalize_api_content.js";
import {
    isSimpleApiContentTableBlockElementForTest,
    printApiMentionPathToMentionLinkUrl,
} from "~/shared/api/markdown/print_api_content_to_markdown.js";
import {apiContentCodeBlockLanguageDefinition} from "~/shared/api/specification/api_content_code_block_language_definition.js";
import {
    ApiContent,
    ApiContentBlockElement,
    ApiContentBreakInlineElement,
    ApiContentCheckListBlockElement,
    ApiContentCheckListBlockElementItem,
    ApiContentCheckListBlockElementItemResponse,
    ApiContentCodeBlockElement,
    ApiContentCodeBlockElementTextInlineElement,
    ApiContentCodeBlockElementTextInlineElementMark,
    ApiContentDividerBlockElement,
    ApiContentHeadingBlockElement,
    ApiContentHeadingBlockElementResponse,
    ApiContentInlineElement,
    ApiContentInlineElementCommentMark,
    ApiContentInlineElementHighlightMark,
    ApiContentInlineElementLinkMark,
    ApiContentInlineElementMark,
    ApiContentInlineElementResponse,
    ApiContentListBlockElement,
    ApiContentListBlockElementItem,
    ApiContentListBlockElementItemResponse,
    ApiContentListBlockElementResponse,
    ApiContentMentionInlineElement,
    ApiContentMentionInlineElementResponse,
    ApiContentOrderedListBlockElement,
    ApiContentOrderedListBlockElementResponse,
    ApiContentParagraphBlockElement,
    ApiContentParagraphBlockElementResponse,
    ApiContentQuoteBlockElement,
    ApiContentQuoteBlockElementBlockElement,
    ApiContentQuoteBlockElementBlockElementResponse,
    ApiContentQuoteBlockElementResponse,
    ApiContentResponse,
    ApiContentTableBlockElement,
    ApiContentTableBlockElementCellBlockElement,
    ApiContentTableBlockElementCellBlockElementResponse,
    ApiContentTableBlockElementResponse,
    ApiContentTextInlineElement,
    ApiContentUnorderedListBlockElement,
    ApiContentUnorderedListBlockElementResponse,
    ApiMentionTarget,
    ApiMentionTargetResponse,
    ApiTaskStatus,
} from "~/shared/api/specification/types/api_specification_convenience_types.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {mapIterable} from "~/shared/helpers/iterable/map_iterable.js";
import {getObjectKeysWithKeyofType} from "~/shared/helpers/object/get_object_keys_with_keyof_type.js";
import {Id, encodeId, generateId, idByteLength} from "~/shared/id/id.js";
import {
    AccountId,
    ChannelId,
    ChatId,
    DocumentCommentThreadId,
    DocumentId,
    PostId,
    SpaceId,
    TaskCollectionId,
    TaskId,
} from "~/shared/id/types/id_types.js";

export const arbitrarySpaceId = generateId<SpaceId>();

// Use TypeScript `Record` so we get a type error when a type is added to the
// union, reminding us that we need to add another entry.
function createUnionArbitrary<Element extends {readonly type: string}>(
    object: Record<Element["type"], MaybeWeightedArbitrary<Element>>,
): Arbitrary<Element> {
    const arbitraries: Array<MaybeWeightedArbitrary<Element>> = Object.values(object);
    return fc.oneof(...arbitraries);
}

function createIdArbitrary<Value extends Id>(): Arbitrary<Value> {
    return fc
        .uint8Array({minLength: idByteLength, maxLength: idByteLength})
        .map(bytes => encodeId<Value>(bytes));
}

const ApiMentionTargetArbitrary = createUnionArbitrary<ApiMentionTarget>({
    Account: createIdArbitrary<AccountId>().map(id => ({type: "Account", id})),
    Channel: createIdArbitrary<ChannelId>().map(id => ({type: "Channel", id})),
    Chat: createIdArbitrary<ChatId>().map(id => ({type: "Chat", id})),
    Document: createIdArbitrary<DocumentId>().map(id => ({type: "Document", id})),
    Post: createIdArbitrary<PostId>().map(id => ({type: "Post", id})),
    Task: createIdArbitrary<TaskId>().map(id => ({type: "Task", id})),
    TaskCollection: createIdArbitrary<TaskCollectionId>().map(id => ({type: "TaskCollection", id})),
});

const ApiContentInlineElementLinkMarkArbitrary: Arbitrary<ApiContentInlineElementLinkMark> =
    fc.record({
        type: fc.constant("Link"),
        url: fc.oneof(
            {weight: 50, arbitrary: fc.webUrl()},
            {weight: 1, arbitrary: fc.string({unit: "grapheme"})},

            // We have special handling for link marks that look like mentions so they're not
            // parsed as mention nodes. Make sure we generate mention-looking URLs.
            {
                weight: 1,
                arbitrary: fc
                    .tuple(ApiMentionTargetArbitrary, fc.boolean())
                    .map(([targetPathObject, isAccountShortName]) =>
                        printApiMentionPathToMentionLinkUrl(targetPathObject, {
                            spaceId: arbitrarySpaceId,
                            isAccountShortName,
                        }),
                    ),
            },
        ),
    });

const ApiContentInlineElementHighlightMarkArbitrary: Arbitrary<ApiContentInlineElementHighlightMark> =
    fc.record({
        type: fc.constant("Highlight"),
        color: fc.oneof(
            fc.constant("Red"),
            fc.constant("Orange"),
            fc.constant("Green"),
            fc.constant("Blue"),
            fc.constant("Purple"),
        ),
    });

const ApiContentInlineElementCommentMarkArbitrary: Arbitrary<ApiContentInlineElementCommentMark> =
    fc.record({
        type: fc.constant("Comment"),
        threadId: createIdArbitrary<DocumentCommentThreadId>(),
    });

const ApiContentInlineElementMarkArbitrary = createUnionArbitrary<ApiContentInlineElementMark>({
    Bold: fc.constant({type: "Bold"}),
    Italic: fc.constant({type: "Italic"}),
    Strike: fc.constant({type: "Strike"}),
    Code: fc.constant({type: "Code"}),
    Link: ApiContentInlineElementLinkMarkArbitrary,
    Highlight: ApiContentInlineElementHighlightMarkArbitrary,
    Comment: ApiContentInlineElementCommentMarkArbitrary,
});

const ApiContentTextInlineElementTextArbitrary = fc.oneof(
    {arbitrary: fc.string({unit: "grapheme-ascii"}), weight: 10},
    {arbitrary: fc.string({unit: "grapheme"}), weight: 1},
);

const ApiContentTextInlineElementArbitrary: Arbitrary<ApiContentTextInlineElement> = fc.record({
    type: fc.constant("Text"),
    text: ApiContentTextInlineElementTextArbitrary,
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

const ApiContentMentionInlineElementArbitrary: Arbitrary<ApiContentMentionInlineElement> =
    fc.record({
        type: fc.constant("Mention"),
        target: ApiMentionTargetArbitrary,
        title: fc.oneof(
            {arbitrary: fc.constant(undefined), weight: 10},
            {arbitrary: fc.string({unit: "grapheme-ascii"}), weight: 10},
            {arbitrary: fc.string({unit: "grapheme"}), weight: 1},
        ),
        isAccountShortName: fc.boolean(),
        marks: fc.oneof(
            {arbitrary: fc.constant([]), weight: 30},
            fc.array(ApiContentInlineElementMarkArbitrary, {
                maxLength: apiContentInlineElementMarkTypeNormalizedOrder.length,
            }),
        ),
    });

const ApiContentInlineElementArbitrary = createUnionArbitrary<ApiContentInlineElement>({
    Text: {arbitrary: ApiContentTextInlineElementArbitrary, weight: 50},
    Mention: {arbitrary: ApiContentMentionInlineElementArbitrary, weight: 10},
    Break: {arbitrary: ApiContentBreakInlineElementArbitrary, weight: 1},
});

const ApiContentParagraphBlockElementArbitrary: Arbitrary<ApiContentParagraphBlockElement> =
    fc.record({
        type: fc.constant("Paragraph"),
        elements: fc.array(ApiContentInlineElementArbitrary),
    });

const {
    ApiContentUnorderedListBlockElementArbitrary,
    ApiContentOrderedListBlockElementArbitrary,
    ApiContentCheckListBlockElementArbitrary,
} = fc.letrec<{
    ApiContentListBlockElementArbitrary: ApiContentListBlockElement;
    ApiContentListBlockElementItemArbitrary: ApiContentListBlockElementItem;
    ApiContentCheckListBlockElementItemArbitrary: ApiContentCheckListBlockElementItem;
    ApiContentUnorderedListBlockElementArbitrary: ApiContentUnorderedListBlockElement;
    ApiContentOrderedListBlockElementArbitrary: ApiContentOrderedListBlockElement;
    ApiContentCheckListBlockElementArbitrary: ApiContentCheckListBlockElement;
}>(tie => {
    const ApiContentListBlockElementArbitrary: Arbitrary<ApiContentListBlockElement> = fc.oneof(
        tie("ApiContentUnorderedListBlockElementArbitrary"),
        tie("ApiContentOrderedListBlockElementArbitrary"),
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

    const ApiContentListBlockElementItemArbitrary: Arbitrary<ApiContentListBlockElementItem> =
        fc.record({
            elements: ListItemElementArbitrary,
            nestedListElements: NestedListItemElementArbitrary,
        });

    const ApiContentCheckListBlockElementItemArbitrary: Arbitrary<ApiContentCheckListBlockElementItem> =
        fc.record({
            checked: fc.boolean(),
            elements: ListItemElementArbitrary,
            nestedListElements: NestedListItemElementArbitrary,
        });

    const ApiContentUnorderedListBlockElementArbitrary: Arbitrary<ApiContentUnorderedListBlockElement> =
        fc.record({
            type: fc.constant("UnorderedList"),
            items: fc.array(ApiContentListBlockElementItemArbitrary),
        });

    const ApiContentOrderedListBlockElementArbitrary: Arbitrary<ApiContentOrderedListBlockElement> =
        fc.record({
            type: fc.constant("OrderedList"),
            items: fc.array(ApiContentListBlockElementItemArbitrary),
        });

    const ApiContentCheckListBlockElementArbitrary: Arbitrary<ApiContentCheckListBlockElement> =
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

const ApiContentQuoteBlockElementArbitrary: Arbitrary<ApiContentQuoteBlockElement> = fc.record({
    type: fc.constant("Quote"),
    elements: fc.array(
        createUnionArbitrary<ApiContentQuoteBlockElementBlockElement>({
            Paragraph: ApiContentParagraphBlockElementArbitrary,
            UnorderedList: ApiContentUnorderedListBlockElementArbitrary,
            OrderedList: ApiContentOrderedListBlockElementArbitrary,
            CheckList: ApiContentCheckListBlockElementArbitrary,
        }),
    ),
});

const ApiContentHeadingBlockElementArbitrary: Arbitrary<ApiContentHeadingBlockElement> = fc.record({
    type: fc.constant("Heading"),
    level: fc.oneof(fc.constant(1), fc.constant(2), fc.constant(3)),
    elements: fc.array(ApiContentInlineElementArbitrary),
});

const ApiContentDividerBlockElementArbitrary: Arbitrary<ApiContentDividerBlockElement> = fc.record({
    type: fc.constant("Divider"),
});

const ApiContentCodeBlockElementTextInlineElementMarkArbitrary =
    createUnionArbitrary<ApiContentCodeBlockElementTextInlineElementMark>({
        Bold: fc.constant({type: "Bold"}),
        Italic: fc.constant({type: "Italic"}),
        Strike: fc.constant({type: "Strike"}),
        Link: ApiContentInlineElementLinkMarkArbitrary,
        Highlight: ApiContentInlineElementHighlightMarkArbitrary,
        Comment: ApiContentInlineElementCommentMarkArbitrary,
    });

const ApiContentCodeBlockElementTextInlineElementArbitrary: Arbitrary<ApiContentCodeBlockElementTextInlineElement> =
    fc.record({
        type: fc.constant("Text"),
        text: ApiContentTextInlineElementTextArbitrary,
        marks: fc.oneof(
            {arbitrary: fc.constant([]), weight: 5},
            fc.array(ApiContentCodeBlockElementTextInlineElementMarkArbitrary, {
                maxLength: apiContentInlineElementMarkTypeNormalizedOrder.length,
            }),
        ),
    });

const ApiContentCodeBlockElementArbitrary: Arbitrary<ApiContentCodeBlockElement> = fc.record({
    type: fc.constant("Code"),
    language: fc.oneof(
        ...mapIterable(
            getObjectKeysWithKeyofType(apiContentCodeBlockLanguageDefinition),
            language => fc.constant(language),
        ),
    ),
    lines: fc.array(
        fc.record({elements: fc.array(ApiContentCodeBlockElementTextInlineElementArbitrary)}),
    ),
});

// Schema requires tableCell{2,} so tables must have at least 2 columns
const ApiContentTableBlockElementArbitrary: Arbitrary<ApiContentTableBlockElement> = fc.oneof(
    // Simple table that should be formatted as a GFM table.
    fc
        .record({
            type: fc.constant("Table"),
            width: fc.float({min: 1, max: 20, noNaN: true}),
            hasHeaderRow: fc.constant(true),
            hasHeaderColumn: fc.constant(false),
            columns: fc.array(
                fc.record({width: fc.float({min: Math.fround(0.01), max: 20, noNaN: true})}),
                {minLength: 2},
            ),
            rows: fc.array(
                fc.record({
                    cells: fc.array(
                        fc.record({
                            elements: fc.tuple(ApiContentParagraphBlockElementArbitrary),
                        }),
                        {minLength: 2},
                    ),
                }),
            ),
        })
        .map(table => {
            // Make sure we can print the table as a GFM table.
            assert(isSimpleApiContentTableBlockElementForTest(table));
            return table;
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
                            createUnionArbitrary<ApiContentTableBlockElementCellBlockElement>({
                                Paragraph: ApiContentParagraphBlockElementArbitrary,
                                UnorderedList: ApiContentUnorderedListBlockElementArbitrary,
                                OrderedList: ApiContentOrderedListBlockElementArbitrary,
                                Quote: ApiContentQuoteBlockElementArbitrary,
                                Code: ApiContentCodeBlockElementArbitrary,
                                CheckList: ApiContentCheckListBlockElementArbitrary,
                            }),
                        ),
                    }),
                    {minLength: 2},
                ),
            }),
        ),
    }),
);

const ApiContentBlockElementArbitrary = createUnionArbitrary<ApiContentBlockElement>({
    Paragraph: {arbitrary: ApiContentParagraphBlockElementArbitrary, weight: 20},
    UnorderedList: ApiContentUnorderedListBlockElementArbitrary,
    OrderedList: ApiContentOrderedListBlockElementArbitrary,
    CheckList: ApiContentCheckListBlockElementArbitrary,
    Quote: ApiContentQuoteBlockElementArbitrary,
    Heading: ApiContentHeadingBlockElementArbitrary,
    Divider: ApiContentDividerBlockElementArbitrary,
    Code: ApiContentCodeBlockElementArbitrary,
    Table: ApiContentTableBlockElementArbitrary,
});

export const ApiContentArbitrary: Arbitrary<ApiContent> = fc.record({
    elements: fc.array(ApiContentBlockElementArbitrary),
});

// ApiContentResponse arbitraries — same as the ApiContent variants above but with
// Response-specific differences: Task mention targets include `status`, and
// Mention inline elements have a required (non-optional) `title`.

const ApiTaskStatusArbitrary: Arbitrary<ApiTaskStatus> = fc.oneof(
    fc.record({type: fc.constant("Open"), isActive: fc.boolean()}),
    fc.constant({type: "Closed"} as const),
);

const ApiMentionTargetResponseArbitrary = createUnionArbitrary<ApiMentionTargetResponse>({
    Account: createIdArbitrary<AccountId>().map(id => ({type: "Account", id})),
    Channel: createIdArbitrary<ChannelId>().map(id => ({type: "Channel", id})),
    Chat: createIdArbitrary<ChatId>().map(id => ({type: "Chat", id})),
    Document: createIdArbitrary<DocumentId>().map(id => ({type: "Document", id})),
    Post: createIdArbitrary<PostId>().map(id => ({type: "Post", id})),
    Task: fc.record({
        type: fc.constant("Task"),
        id: createIdArbitrary<TaskId>(),
        status: ApiTaskStatusArbitrary,
    }),
    TaskCollection: createIdArbitrary<TaskCollectionId>().map(id => ({type: "TaskCollection", id})),
});

const ApiContentMentionInlineElementResponseArbitrary: Arbitrary<ApiContentMentionInlineElementResponse> =
    fc.record({
        type: fc.constant("Mention"),
        target: ApiMentionTargetResponseArbitrary,
        title: fc.oneof(
            {arbitrary: fc.string({unit: "grapheme-ascii"}), weight: 10},
            {arbitrary: fc.string({unit: "grapheme"}), weight: 1},
        ),
        isAccountShortName: fc.oneof(
            {arbitrary: fc.constant(undefined), weight: 10},
            {arbitrary: fc.boolean(), weight: 1},
        ),
        marks: fc.oneof(
            {arbitrary: fc.constant([]), weight: 30},
            fc.array(ApiContentInlineElementMarkArbitrary, {
                maxLength: apiContentInlineElementMarkTypeNormalizedOrder.length,
            }),
        ),
    });

const ApiContentInlineElementResponseArbitrary =
    createUnionArbitrary<ApiContentInlineElementResponse>({
        Text: {arbitrary: ApiContentTextInlineElementArbitrary, weight: 50},
        Mention: {arbitrary: ApiContentMentionInlineElementResponseArbitrary, weight: 10},
        Break: {arbitrary: ApiContentBreakInlineElementArbitrary, weight: 1},
    });

const ApiContentParagraphBlockElementResponseArbitrary: Arbitrary<ApiContentParagraphBlockElementResponse> =
    fc.record({
        type: fc.constant("Paragraph"),
        elements: fc.array(ApiContentInlineElementResponseArbitrary),
    });

// Local type for the CheckList Response variant since it isn't exported from the
// convenience types.
type ApiContentCheckListBlockElementResponse = {
    readonly type: "CheckList";
    readonly items: ReadonlyArray<ApiContentCheckListBlockElementItemResponse>;
};

const {
    ApiContentUnorderedListBlockElementResponseArbitrary,
    ApiContentOrderedListBlockElementResponseArbitrary,
    ApiContentCheckListBlockElementResponseArbitrary,
} = fc.letrec<{
    ApiContentListBlockElementResponseArbitrary: ApiContentListBlockElementResponse;
    ApiContentListBlockElementItemResponseArbitrary: ApiContentListBlockElementItemResponse;
    ApiContentCheckListBlockElementItemResponseArbitrary: ApiContentCheckListBlockElementItemResponse;
    ApiContentUnorderedListBlockElementResponseArbitrary: ApiContentUnorderedListBlockElementResponse;
    ApiContentOrderedListBlockElementResponseArbitrary: ApiContentOrderedListBlockElementResponse;
    ApiContentCheckListBlockElementResponseArbitrary: ApiContentCheckListBlockElementResponse;
}>(tie => {
    const ApiContentListBlockElementResponseArbitrary: Arbitrary<ApiContentListBlockElementResponse> =
        fc.oneof(
            tie("ApiContentUnorderedListBlockElementResponseArbitrary"),
            tie("ApiContentOrderedListBlockElementResponseArbitrary"),
        );

    const ListItemElementResponseArbitrary = fc.oneof(
        {
            weight: 200,
            arbitrary: fc.tuple(ApiContentParagraphBlockElementResponseArbitrary),
        },
        {
            weight: 1,
            arbitrary: fc.tuple(
                ApiContentParagraphBlockElementResponseArbitrary,
                ApiContentParagraphBlockElementResponseArbitrary,
            ),
        },
        {
            weight: 1,
            arbitrary: fc.tuple(
                ApiContentParagraphBlockElementResponseArbitrary,
                ApiContentParagraphBlockElementResponseArbitrary,
                ApiContentParagraphBlockElementResponseArbitrary,
            ),
        },
        {weight: 1, arbitrary: fc.tuple()},
    );

    const NestedListItemElementResponseArbitrary = fc.oneof(
        {maxDepth: 5},
        {weight: 200, arbitrary: fc.tuple()},
        {weight: 20, arbitrary: fc.tuple(ApiContentListBlockElementResponseArbitrary)},
        {
            weight: 1,
            arbitrary: fc.tuple(
                ApiContentListBlockElementResponseArbitrary,
                ApiContentListBlockElementResponseArbitrary,
            ),
        },
        {
            weight: 1,
            arbitrary: fc.tuple(
                ApiContentListBlockElementResponseArbitrary,
                ApiContentListBlockElementResponseArbitrary,
                ApiContentListBlockElementResponseArbitrary,
            ),
        },
    );

    const ApiContentListBlockElementItemResponseArbitrary: Arbitrary<ApiContentListBlockElementItemResponse> =
        fc.record({
            elements: ListItemElementResponseArbitrary,
            nestedListElements: NestedListItemElementResponseArbitrary,
        });

    const ApiContentCheckListBlockElementItemResponseArbitrary: Arbitrary<ApiContentCheckListBlockElementItemResponse> =
        fc.record({
            checked: fc.boolean(),
            elements: ListItemElementResponseArbitrary,
            nestedListElements: NestedListItemElementResponseArbitrary,
        });

    const ApiContentUnorderedListBlockElementResponseArbitrary: Arbitrary<ApiContentUnorderedListBlockElementResponse> =
        fc.record({
            type: fc.constant("UnorderedList"),
            items: fc.array(ApiContentListBlockElementItemResponseArbitrary),
        });

    const ApiContentOrderedListBlockElementResponseArbitrary: Arbitrary<ApiContentOrderedListBlockElementResponse> =
        fc.record({
            type: fc.constant("OrderedList"),
            items: fc.array(ApiContentListBlockElementItemResponseArbitrary),
        });

    const ApiContentCheckListBlockElementResponseArbitrary: Arbitrary<ApiContentCheckListBlockElementResponse> =
        fc.record({
            type: fc.constant("CheckList"),
            items: fc.array(ApiContentCheckListBlockElementItemResponseArbitrary),
        });

    return {
        ApiContentListBlockElementResponseArbitrary,
        ApiContentListBlockElementItemResponseArbitrary,
        ApiContentUnorderedListBlockElementResponseArbitrary,
        ApiContentOrderedListBlockElementResponseArbitrary,
        ApiContentCheckListBlockElementResponseArbitrary,
        ApiContentCheckListBlockElementItemResponseArbitrary,
    };
});

const ApiContentQuoteBlockElementResponseArbitrary: Arbitrary<ApiContentQuoteBlockElementResponse> =
    fc.record({
        type: fc.constant("Quote"),
        elements: fc.array(
            createUnionArbitrary<ApiContentQuoteBlockElementBlockElementResponse>({
                Paragraph: ApiContentParagraphBlockElementResponseArbitrary,
                UnorderedList: ApiContentUnorderedListBlockElementResponseArbitrary,
                OrderedList: ApiContentOrderedListBlockElementResponseArbitrary,
                CheckList: ApiContentCheckListBlockElementResponseArbitrary,
            }),
        ),
    });

const ApiContentHeadingBlockElementResponseArbitrary: Arbitrary<ApiContentHeadingBlockElementResponse> =
    fc.record({
        type: fc.constant("Heading"),
        level: fc.oneof(fc.constant(1), fc.constant(2), fc.constant(3)),
        elements: fc.array(ApiContentInlineElementResponseArbitrary),
    });

// Schema requires tableCell{2,} so tables must have at least 2 columns
const ApiContentTableBlockElementResponseArbitrary: Arbitrary<ApiContentTableBlockElementResponse> =
    fc.oneof(
        // Simple table that should be formatted as a GFM table.
        fc
            .record({
                type: fc.constant("Table"),
                width: fc.float({min: 1, max: 20, noNaN: true}),
                hasHeaderRow: fc.constant(true),
                hasHeaderColumn: fc.constant(false),
                columns: fc.array(
                    fc.record({
                        width: fc.float({min: Math.fround(0.01), max: 20, noNaN: true}),
                    }),
                    {minLength: 2},
                ),
                rows: fc.array(
                    fc.record({
                        cells: fc.array(
                            fc.record({
                                elements: fc.tuple(
                                    ApiContentParagraphBlockElementResponseArbitrary,
                                ),
                            }),
                            {minLength: 2},
                        ),
                    }),
                ),
            })
            .map(table => {
                // Make sure we can print the table as a GFM table.
                assert(isSimpleApiContentTableBlockElementForTest(table));
                return table;
            }),

        // Arbitrary table that's not limited to simple constructs that'll work in a GFM
        // table.
        fc.record({
            type: fc.constant("Table"),
            width: fc.float({min: 1, max: 20, noNaN: true}),
            hasHeaderRow: fc.boolean(),
            hasHeaderColumn: fc.boolean(),
            columns: fc.array(
                fc.record({
                    width: fc.float({min: Math.fround(0.01), max: 20, noNaN: true}),
                }),
                {minLength: 2},
            ),
            rows: fc.array(
                fc.record({
                    cells: fc.array(
                        fc.record({
                            elements: fc.array(
                                createUnionArbitrary<ApiContentTableBlockElementCellBlockElementResponse>(
                                    {
                                        Paragraph: ApiContentParagraphBlockElementResponseArbitrary,
                                        UnorderedList:
                                            ApiContentUnorderedListBlockElementResponseArbitrary,
                                        OrderedList:
                                            ApiContentOrderedListBlockElementResponseArbitrary,
                                        Quote: ApiContentQuoteBlockElementResponseArbitrary,
                                        Code: ApiContentCodeBlockElementArbitrary,
                                        CheckList: ApiContentCheckListBlockElementResponseArbitrary,
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

export const ApiContentResponseArbitrary: Arbitrary<ApiContentResponse> = fc.record({
    elements: fc.array(
        createUnionArbitrary<ApiContentResponse["elements"][number]>({
            Paragraph: {arbitrary: ApiContentParagraphBlockElementResponseArbitrary, weight: 20},
            UnorderedList: ApiContentUnorderedListBlockElementResponseArbitrary,
            OrderedList: ApiContentOrderedListBlockElementResponseArbitrary,
            CheckList: ApiContentCheckListBlockElementResponseArbitrary,
            Quote: ApiContentQuoteBlockElementResponseArbitrary,
            Heading: ApiContentHeadingBlockElementResponseArbitrary,
            Divider: ApiContentDividerBlockElementArbitrary,
            Code: ApiContentCodeBlockElementArbitrary,
            Table: ApiContentTableBlockElementResponseArbitrary,
        }),
    ),
});
