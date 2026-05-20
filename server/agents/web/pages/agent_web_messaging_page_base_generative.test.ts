import fc, {Arbitrary} from "fast-check";
import {produce} from "immer";
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
    visitAndProduceApiContentInlineElement,
    visitDraftApiContent,
} from "~/shared/api/content/visit_and_produce_api_content.js";
import {
    normalizeDraftApiContent,
    normalizeDraftApiContentInlineElements,
    normalizeDraftApiContentTarget,
} from "~/shared/api/markdown/normalize_api_content.js";
import {
    ApiContentArbitrary as ActualApiContentArbitrary,
    ApiContentInlineElementArbitrary,
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
        elements: fc.array(
            ApiContentInlineElementArbitrary.map(element => {
                return visitAndProduceApiContentInlineElement(element, {
                    visitInlineElement: element => {
                        if (element.marks?.some(mark => mark.type === "Comment")) {
                            element.marks = element.marks.filter(mark => mark.type !== "Comment");
                        }
                    },
                });
            }),
            {maxLength: 4},
        ),
        paginationLink: AgentWebMessagingPagePaginationLinkArbitrary,
    }),
    blocks: fc.array(AgentWebMessagingPageBlockArbitrary),
});

runAgentWebPageGenerativeTests({
    print: printAgentWebMessagingPageBase.bind(null, agentWebMessagingPageMessageNouns),
    parse: parseAgentWebMessagingPageBase.bind(null, agentWebMessagingPageMessageNouns),
    pageLink: fc.constant(true),
    page: AgentWebMessagingPageBaseArbitrary,
    normalize: page => {
        normalizeDraftApiContentInlineElements(page.preamble.elements);

        if (page.preamble.paginationLink !== null) {
            normalizeDraftApiContentTarget(page.preamble.paginationLink.target);
        }

        for (const block of page.blocks) {
            if (block.type !== "Message") continue;
            if (block.parent) normalizeDraftApiContent(block.parent.previewContent);
            normalizeDraftApiContent(block.content);
        }
    },
});
