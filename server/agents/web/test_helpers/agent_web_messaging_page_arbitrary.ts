import fc, {Arbitrary} from "fast-check";
import {
    AgentWebMessagingPage,
    AgentWebMessagingPageBlock,
    AgentWebMessagingPageCustomBlockBase,
    AgentWebMessagingPageMessageBlock,
    AgentWebMessagingPagePagination,
    AgentWebMessagingPagePaginationPageLink,
    AgentWebMessagingPageTimeBlock,
} from "~/server/agents/web/pages/messaging/agent_web_messaging_page.js";
import {
    ApiAccountReferenceArbitrary,
    ApiChatReferenceArbitrary,
    ApiContentTextArbitrary,
    ApiContentWithoutCommentMarkArbitrary,
    ApiTaskReferenceArbitrary,
    createIdArbitrary,
    createUnionArbitrary,
} from "~/shared/api/markdown/test_helpers/api_content_arbitrary.js";
import {PostId} from "~/shared/id/types/id_types.js";

const AgentWebMessagingPageTimeBlockArbitrary: Arbitrary<AgentWebMessagingPageTimeBlock> =
    fc.record({
        type: fc.constant("Time"),
        timeContent: ApiContentTextArbitrary,
    });

const AgentWebMessagingPageMessageBlockArbitrary: Arbitrary<AgentWebMessagingPageMessageBlock> =
    fc.record({
        type: fc.constant("Message"),
        idAttribute: fc.oneof(
            {weight: 10, arbitrary: fc.constant(null)},
            {
                weight: 1,
                arbitrary: fc
                    .tuple(fc.integer({min: 0}), fc.integer({min: 1, max: 10}))
                    .map(([startMessageIndex, length]) => ({
                        startMessageIndex,
                        endMessageIndex: startMessageIndex + length,
                    })),
            },
        ),
        author: ApiAccountReferenceArbitrary,
        timeAttribute: fc.oneof(ApiContentTextArbitrary, fc.constant(null)),
        timeZoneAttribute: fc.oneof(ApiContentTextArbitrary, fc.constant(null)),
        parent: fc.oneof(
            {weight: 10, arbitrary: fc.constant(null)},
            {
                weight: 1,
                arbitrary: fc.record({
                    citeAttribute: fc
                        .tuple(fc.integer({min: 0}), fc.integer({min: 1, max: 10}))
                        .map(([startMessageIndex, length]) => ({
                            startMessageIndex,
                            endMessageIndex: startMessageIndex + length,
                        })),
                    author: ApiAccountReferenceArbitrary,
                    previewContent: ApiContentWithoutCommentMarkArbitrary,
                }),
            },
        ),
        content: ApiContentWithoutCommentMarkArbitrary,
    });

const AgentWebMessagingPageBlockArbitrary = createUnionArbitrary<AgentWebMessagingPageBlock<never>>(
    {
        Time: {weight: 1, arbitrary: AgentWebMessagingPageTimeBlockArbitrary},
        Message: {weight: 10, arbitrary: AgentWebMessagingPageMessageBlockArbitrary},
    },
);

const AgentWebMessagingPagePaginationPageLinkArbitrary =
    createUnionArbitrary<AgentWebMessagingPagePaginationPageLink>({
        Chat: ApiChatReferenceArbitrary,
        Post: fc.record({
            type: fc.constant("Post"),
            id: createIdArbitrary<PostId>(),
            title: ApiContentTextArbitrary,
        }),
        TaskMessageList: fc.record({
            type: fc.constant("TaskMessageList"),
            task: ApiTaskReferenceArbitrary,
        }),
    });

const AgentWebMessagingPagePaginationArbitrary: Arbitrary<AgentWebMessagingPagePagination<never>> =
    fc.oneof(
        fc.record({
            pageLink: AgentWebMessagingPagePaginationPageLinkArbitrary,
            previousLink: fc.record({
                type: fc.constant("Message"),
                beforeMessageIndex: fc.integer({min: 0}),
            }),
            nextLink: fc.constant(null),
        }),
        fc.record({
            pageLink: AgentWebMessagingPagePaginationPageLinkArbitrary,
            previousLink: fc.constant(null),
            nextLink: fc.record({
                type: fc.constant("Message"),
                afterMessageIndex: fc.integer({min: 0}),
            }),
        }),
        fc.record({
            pageLink: AgentWebMessagingPagePaginationPageLinkArbitrary,
            previousLink: fc.record({
                type: fc.constant("Message"),
                beforeMessageIndex: fc.integer({min: 0}),
            }),
            nextLink: fc.record({
                type: fc.constant("Message"),
                afterMessageIndex: fc.integer({min: 0}),
            }),
        }),
    );

export function createAgentWebMessagingPageArbitrary<
    Preamble,
    CustomBlock extends AgentWebMessagingPageCustomBlockBase = never,
>({
    preambleArbitrary,
    customBlockArbitrary,
}: {
    preambleArbitrary: Arbitrary<Preamble>;
    customBlockArbitrary?: Arbitrary<CustomBlock>;
}): {
    [Key in keyof AgentWebMessagingPage<Preamble, CustomBlock>]: Arbitrary<
        AgentWebMessagingPage<Preamble, CustomBlock>[Key]
    >;
} {
    let blockArbitrary = AgentWebMessagingPageBlockArbitrary as Arbitrary<
        AgentWebMessagingPageBlock<CustomBlock>
    >;

    if (customBlockArbitrary) {
        blockArbitrary = fc.oneof(
            {weight: 10, arbitrary: blockArbitrary},
            {weight: 1, arbitrary: customBlockArbitrary},
        );
    }

    return {
        preamble: preambleArbitrary,
        pagination: fc.oneof(
            {weight: 10, arbitrary: fc.constant(null)},
            {weight: 1, arbitrary: AgentWebMessagingPagePaginationArbitrary},
        ),
        isEndOfMessages: fc.boolean(),
        blocks: fc.array(blockArbitrary),
    };
}
