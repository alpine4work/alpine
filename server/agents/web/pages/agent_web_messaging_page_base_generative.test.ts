import fc, {Arbitrary} from "fast-check";
import {produce} from "immer";
import {
    AgentWebMessagingPageBase,
    AgentWebMessagingPageBlock,
    AgentWebMessagingPageMessageBlock,
    AgentWebMessagingPageTimeBlock,
    agentWebMessagingPageMessageNouns,
    parseAgentWebMessagingPageBase,
    printAgentWebMessagingPageBase,
} from "~/server/agents/web/pages/agent_web_messaging_page_base.js";
import {runAgentWebPageGenerativeTests} from "~/server/agents/web/pages/run_agent_web_page_generative_tests.js";
import {visitDraftApiContent} from "~/shared/api/content/visit_and_produce_api_content.js";
import {normalizeDraftApiContentResponse} from "~/shared/api/markdown/normalize_api_content.js";
import {
    ApiContentArbitrary as ActualApiContentArbitrary,
    ApiContentTextArbitrary,
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

        normalizeDraftApiContentResponse(content);
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

const AgentWebMessagingPageBaseArbitrary: Arbitrary<AgentWebMessagingPageBase> = fc.record({
    blocks: fc.array(AgentWebMessagingPageBlockArbitrary),
});

runAgentWebPageGenerativeTests({
    print: printAgentWebMessagingPageBase.bind(null, agentWebMessagingPageMessageNouns),
    parse: parseAgentWebMessagingPageBase.bind(null, agentWebMessagingPageMessageNouns),
    pageLink: fc.constant(null),
    page: AgentWebMessagingPageBaseArbitrary,
});
