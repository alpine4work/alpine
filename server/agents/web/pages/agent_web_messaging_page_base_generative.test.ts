import fc, {Arbitrary} from "fast-check";
import {produce} from "immer";
import {normalizeDraftApiContentForAgentWebMarkdown} from "~/server/agents/web/normalize_api_content_for_agent_web_markdown.js";
import {
    AgentWebMessagingPageBase,
    AgentWebMessagingPageBasePreamble,
    AgentWebMessagingPageBlock,
    AgentWebMessagingPageMessageBlock,
    AgentWebMessagingPageTimeBlock,
    agentWebMessagingPageMessageNouns,
    parseAgentWebMessagingPageBase,
    printAgentWebMessagingPageBase,
} from "~/server/agents/web/pages/agent_web_messaging_page_base.js";
import {runAgentWebPageGenerativeTests} from "~/server/agents/web/pages/run_agent_web_page_generative_tests.js";
import {
    visitDraftApiContent,
    visitDraftApiContentInlineElements,
} from "~/shared/api/content/visit_and_produce_api_content.js";
import {normalizeDraftApiContentInlineElementsResponse} from "~/shared/api/markdown/normalize_api_content.js";
import {
    ApiContentArbitrary as ActualApiContentArbitrary,
    ApiContentInlineElementArbitrary as ActualApiContentInlineElementArbitrary,
    ApiContentTextArbitrary,
    ApiMentionTargetArbitrary,
    createUnionArbitrary,
} from "~/shared/api/markdown/test_helpers/api_content_arbitrary.js";

const ApiContentArbitrary = ActualApiContentArbitrary.map(content => {
    return produce(content, content => {
        visitDraftApiContent(content, {
            visitInlineElement: element => {
                if (element.marks?.some(mark => mark.type === "Comment")) {
                    element.marks = element.marks.filter(mark => mark.type !== "Comment");
                }
            },
        });

        normalizeDraftApiContentForAgentWebMarkdown(content);
    });
});

const ApiContentInlineElementsArbitrary = fc
    .array(ActualApiContentInlineElementArbitrary, {maxLength: 4})
    .map(elements => {
        return produce(elements, elements => {
            visitDraftApiContentInlineElements(elements, {
                visitInlineElement: element => {
                    if (element.marks?.some(mark => mark.type === "Comment")) {
                        element.marks = element.marks.filter(mark => mark.type !== "Comment");
                    }
                },
            });

            normalizeDraftApiContentInlineElementsResponse(elements);
        });
    });

const AgentWebMessagingPageTimeBlockArbitrary: Arbitrary<AgentWebMessagingPageTimeBlock> =
    fc.record({
        type: fc.constant("Time"),
        timeContent: ApiContentTextArbitrary,
    });

const AgentWebMessagingPageMessageBlockArbitrary: Arbitrary<AgentWebMessagingPageMessageBlock> =
    fc.record({
        type: fc.constant("Message"),
        tagName: fc.oneof(fc.constant("human"), fc.constant("bot")),
        nameAttribute: ApiContentTextArbitrary,
        timeAttribute: fc.oneof(ApiContentTextArbitrary, fc.constant(null)),
        timeZoneAttribute: fc.oneof(ApiContentTextArbitrary, fc.constant(null)),
        parent: fc.oneof(
            {weight: 10, arbitrary: fc.constant(null)},
            {
                weight: 1,
                arbitrary: fc.record({
                    nameAttribute: ApiContentTextArbitrary,
                    previewContent: ApiContentArbitrary,
                }),
            },
        ),
        content: ApiContentArbitrary,
    });

const AgentWebMessagingPageBlockArbitrary = createUnionArbitrary<AgentWebMessagingPageBlock>({
    Time: {weight: 1, arbitrary: AgentWebMessagingPageTimeBlockArbitrary},
    Message: {weight: 10, arbitrary: AgentWebMessagingPageMessageBlockArbitrary},
});

const AgentWebMessagingPagePaginationLinkArbitrary: Arbitrary<
    AgentWebMessagingPageBasePreamble["paginationLink"]
> = fc.oneof(
    {weight: 10, arbitrary: fc.constant(null)},
    {
        weight: 1,
        arbitrary: fc.record({
            text: fc.constant("Previous page »"),
            target: ApiMentionTargetArbitrary,
            searchParams: fc
                .integer({min: 0})
                .map(index => new URLSearchParams([["before", `${index}`]])),
        }),
    },
    {
        weight: 1,
        arbitrary: fc.record({
            text: fc.constant("Next page »"),
            target: ApiMentionTargetArbitrary,
            searchParams: fc
                .integer({min: 0})
                .map(index => new URLSearchParams([["after", `${index}`]])),
        }),
    },
);

const AgentWebMessagingPageBaseArbitrary: Arbitrary<AgentWebMessagingPageBase> = fc.record({
    preamble: fc.record({
        elements: ApiContentInlineElementsArbitrary,
        paginationLink: AgentWebMessagingPagePaginationLinkArbitrary,
    }),
    blocks: fc.array(AgentWebMessagingPageBlockArbitrary),
});

runAgentWebPageGenerativeTests({
    print: printAgentWebMessagingPageBase.bind(null, agentWebMessagingPageMessageNouns),
    parse: parseAgentWebMessagingPageBase.bind(null, agentWebMessagingPageMessageNouns),
    pageLink: fc.constant(true),
    page: AgentWebMessagingPageBaseArbitrary,
});
