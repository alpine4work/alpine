import fc, {Arbitrary} from "fast-check";
import {
    AgentWebMessagingPage,
    AgentWebMessagingPageBlock,
    AgentWebMessagingPageMessageBlock,
    AgentWebMessagingPagePagination,
    AgentWebMessagingPagePaginationPageLink,
    AgentWebMessagingPageTimeBlock,
} from "~/server/agents/web/pages/messaging/agent_web_messaging_page.js";
import {
    ApiAccountTargetArbitrary,
    ApiChatTargetArbitrary,
    ApiContentTextArbitrary,
    ApiContentWithoutCommentMarkArbitrary,
    ApiTaskTargetArbitrary,
    createUnionArbitrary,
} from "~/shared/api/markdown/test_helpers/api_content_arbitrary.js";

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
        author: ApiAccountTargetArbitrary,
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
                    author: ApiAccountTargetArbitrary,
                    previewContent: ApiContentWithoutCommentMarkArbitrary,
                }),
            },
        ),
        content: ApiContentWithoutCommentMarkArbitrary,
    });

const AgentWebMessagingPageBlockArbitrary = createUnionArbitrary<AgentWebMessagingPageBlock>({
    Time: {weight: 1, arbitrary: AgentWebMessagingPageTimeBlockArbitrary},
    Message: {weight: 10, arbitrary: AgentWebMessagingPageMessageBlockArbitrary},
});

const AgentWebMessagingPagePaginationPageLinkArbitrary =
    createUnionArbitrary<AgentWebMessagingPagePaginationPageLink>({
        Chat: ApiChatTargetArbitrary,
        TaskMessageList: fc.record({
            type: fc.constant("TaskMessageList"),
            task: ApiTaskTargetArbitrary,
        }),
    });

const AgentWebMessagingPagePaginationArbitrary: Arbitrary<AgentWebMessagingPagePagination> =
    fc.oneof(
        fc.record({
            pageLink: AgentWebMessagingPagePaginationPageLinkArbitrary,
            previousLink: fc.record({beforeMessageIndex: fc.integer({min: 0})}),
            nextLink: fc.constant(null),
        }),
        fc.record({
            pageLink: AgentWebMessagingPagePaginationPageLinkArbitrary,
            previousLink: fc.constant(null),
            nextLink: fc.record({afterMessageIndex: fc.integer({min: 0})}),
        }),
        fc.record({
            pageLink: AgentWebMessagingPagePaginationPageLinkArbitrary,
            previousLink: fc.record({beforeMessageIndex: fc.integer({min: 0})}),
            nextLink: fc.record({afterMessageIndex: fc.integer({min: 0})}),
        }),
    );

export function createAgentWebMessagingPageArbitrary<Preamble>(
    preambleArbitrary: Arbitrary<Preamble>,
): {
    [Key in keyof AgentWebMessagingPage<Preamble>]: Arbitrary<AgentWebMessagingPage<Preamble>[Key]>;
} {
    return {
        preamble: preambleArbitrary,
        pagination: fc.oneof(
            {weight: 10, arbitrary: fc.constant(null)},
            {weight: 1, arbitrary: AgentWebMessagingPagePaginationArbitrary},
        ),
        isEndOfMessages: fc.boolean(),
        blocks: fc.array(AgentWebMessagingPageBlockArbitrary),
    };
}
