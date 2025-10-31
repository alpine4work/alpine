import fc, {Arbitrary, MaybeWeightedArbitrary} from "fast-check";
import {
    apiContentInlineElementMarkTypeNormalizedOrder,
    normalizeApiContent,
} from "~/server/api/markdown/normalize_api_content.js";
import {parseApiContentFromMarkdown} from "~/server/api/markdown/parse_api_content_from_markdown.js";
import {
    isSimpleApiContentTableBlockElementForTest,
    printApiContentToMarkdown,
    printApiMentionPathToMentionLinkUrl,
} from "~/server/api/markdown/print_api_content_to_markdown.js";
import {apiContentCodeBlockLanguageDefinition} from "~/shared/api/api_content_code_block_language_definition.js";
import {ApiMentionPathObject, printApiMentionPath} from "~/shared/api/parse_api_path.js";
import {
    ApiContent,
    ApiContentBlockElement,
    ApiContentBreakInlineElement,
    ApiContentCodeBlockElement,
    ApiContentCodeBlockElementTextInlineElement,
    ApiContentCodeBlockElementTextInlineElementMark,
    ApiContentDividerBlockElement,
    ApiContentHeadingBlockElement,
    ApiContentInlineElement,
    ApiContentInlineElementCommentMark,
    ApiContentInlineElementHighlightMark,
    ApiContentInlineElementLinkMark,
    ApiContentInlineElementMark,
    ApiContentListBlockElement,
    ApiContentListBlockElementItem,
    ApiContentMentionInlineElement,
    ApiContentOrderedListBlockElement,
    ApiContentParagraphBlockElement,
    ApiContentQuoteBlockElement,
    ApiContentQuoteBlockElementBlockElement,
    ApiContentTableBlockElement,
    ApiContentTableBlockElementCellBlockElement,
    ApiContentTextInlineElement,
    ApiContentUnorderedListBlockElement,
} from "~/shared/api/types/api_specification_convenience_types.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {mapIterable} from "~/shared/helpers/iterable/map_iterable.js";
import {getObjectKeysWithKeyofType} from "~/shared/helpers/object/get_object_keys_with_keyof_type.js";
import {Id, encodeId, generateId, idByteLength} from "~/shared/id/id.js";
import {
    AccountId,
    ChannelId,
    DocumentCommentThreadId,
    DocumentId,
    PostId,
    SpaceId,
    TaskCollectionId,
    TaskId,
} from "~/shared/id/types/id_types.js";

import.meta.jest.setTimeout(30 * 1000);
fc.configureGlobal({interruptAfterTimeLimit: 20 * 1000});

const spaceId = generateId<SpaceId>();

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

const ApiMentionPathObjectArbitrary = createUnionArbitrary<ApiMentionPathObject>({
    Account: createIdArbitrary<AccountId>().map(accountId => ({
        type: "Account",
        accountId,
    })),
    Channel: createIdArbitrary<ChannelId>().map(channelId => ({
        type: "Channel",
        channelId,
    })),
    Document: createIdArbitrary<DocumentId>().map(documentId => ({
        type: "Document",
        documentId,
    })),
    Post: createIdArbitrary<PostId>().map(postId => ({type: "Post", postId})),
    Task: createIdArbitrary<TaskId>().map(taskId => ({type: "Task", taskId})),
    TaskCollection: createIdArbitrary<TaskCollectionId>().map(collectionId => ({
        type: "TaskCollection",
        collectionId,
    })),
});

const ApiContentInlineElementLinkMarkArbitrary: Arbitrary<ApiContentInlineElementLinkMark> =
    fc.record({
        type: fc.constant("Link"),
        url: fc.oneof(
            {weight: 50, arbitrary: fc.webUrl()},
            {weight: 1, arbitrary: fc.string({unit: "grapheme"})},

            // We have special handling for link marks that look like mentions so they're
            // not parsed as mention nodes. Make sure we generate mention-looking URLs.
            {
                weight: 1,
                arbitrary: fc
                    .tuple(ApiMentionPathObjectArbitrary, fc.boolean())
                    .map(([targetPathObject, isAccountShortName]) =>
                        printApiMentionPathToMentionLinkUrl(targetPathObject, {
                            spaceId,
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
        targetPath: ApiMentionPathObjectArbitrary.map(path => printApiMentionPath(path)),
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

const {ApiContentUnorderedListBlockElementArbitrary, ApiContentOrderedListBlockElementArbitrary} =
    fc.letrec<{
        ApiContentListBlockElementArbitrary: ApiContentListBlockElement;
        ApiContentListBlockElementItemArbitrary: ApiContentListBlockElementItem;
        ApiContentUnorderedListBlockElementArbitrary: ApiContentUnorderedListBlockElement;
        ApiContentOrderedListBlockElementArbitrary: ApiContentOrderedListBlockElement;
    }>(tie => {
        const ApiContentListBlockElementArbitrary: Arbitrary<ApiContentListBlockElement> = fc.oneof(
            tie("ApiContentUnorderedListBlockElementArbitrary"),
            tie("ApiContentOrderedListBlockElementArbitrary"),
        );

        const ApiContentListBlockElementItemArbitrary: Arbitrary<ApiContentListBlockElementItem> =
            fc.record({
                elements: fc.oneof(
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
                ),
                nestedListElements: fc.oneof(
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
                ),
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

        return {
            ApiContentListBlockElementArbitrary,
            ApiContentListBlockElementItemArbitrary,
            ApiContentUnorderedListBlockElementArbitrary,
            ApiContentOrderedListBlockElementArbitrary,
        };
    });

const ApiContentQuoteBlockElementArbitrary: Arbitrary<ApiContentQuoteBlockElement> = fc.record({
    type: fc.constant("Quote"),
    elements: fc.array(
        createUnionArbitrary<ApiContentQuoteBlockElementBlockElement>({
            Paragraph: ApiContentParagraphBlockElementArbitrary,
            UnorderedList: ApiContentUnorderedListBlockElementArbitrary,
            OrderedList: ApiContentOrderedListBlockElementArbitrary,
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
            ),
            rows: fc.array(
                fc.record({
                    cells: fc.array(
                        fc.record({
                            elements: fc.tuple(ApiContentParagraphBlockElementArbitrary),
                        }),
                    ),
                }),
            ),
        })
        .map(table => {
            // Make sure we can print the table as a GFM table.
            assert(isSimpleApiContentTableBlockElementForTest(table));
            return table;
        }),

    // Arbitrary table that's not limited to simple constructs that'll work in
    // a GFM table.
    fc.record({
        type: fc.constant("Table"),
        width: fc.float({min: 1, max: 20, noNaN: true}),
        hasHeaderRow: fc.boolean(),
        hasHeaderColumn: fc.boolean(),
        columns: fc.array(
            fc.record({width: fc.float({min: Math.fround(0.01), max: 20, noNaN: true})}),
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
                            }),
                        ),
                    }),
                ),
            }),
        ),
    }),
);

const ApiContentBlockElementArbitrary = createUnionArbitrary<ApiContentBlockElement>({
    Paragraph: {arbitrary: ApiContentParagraphBlockElementArbitrary, weight: 20},
    UnorderedList: ApiContentUnorderedListBlockElementArbitrary,
    OrderedList: ApiContentOrderedListBlockElementArbitrary,
    Quote: ApiContentQuoteBlockElementArbitrary,
    Heading: ApiContentHeadingBlockElementArbitrary,
    Divider: ApiContentDividerBlockElementArbitrary,
    Code: ApiContentCodeBlockElementArbitrary,
    Table: ApiContentTableBlockElementArbitrary,
});

const ApiContentArbitrary: Arbitrary<ApiContent> = fc.record({
    elements: fc.array(ApiContentBlockElementArbitrary),
});

test("can parse exact same content that was printed", () => {
    fc.assert(
        fc.property(ApiContentArbitrary, content => {
            const markdown = printApiContentToMarkdown(content, {spaceId});

            expect(parseApiContentFromMarkdown(markdown, {spaceId})).toEqual(
                normalizeApiContent(content),
            );
        }),
        {
            // Run until we reach our 10s timeout.
            numRuns: Infinity,
        },
    );
});
