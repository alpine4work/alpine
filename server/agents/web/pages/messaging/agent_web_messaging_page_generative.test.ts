import fc from "fast-check";
import {agentWebMessagingPageMessageNouns} from "~/server/agents/web/pages/messaging/agent_web_messaging_page.js";
import {normalizeAgentWebMessagingPage} from "~/server/agents/web/pages/messaging/normalize_agent_web_messaging_page.js";
import {parseAgentWebMessagingPage} from "~/server/agents/web/pages/messaging/parse_agent_web_messaging_page.js";
import {printAgentWebMessagingPage} from "~/server/agents/web/pages/messaging/print_agent_web_messaging_page.js";
import {parseApiContentFromAgentWebMarkdownTree} from "~/server/agents/web/parse_api_content_from_agent_web_markdown.js";
import {printApiContentToAgentWebMarkdownTree} from "~/server/agents/web/print_api_content_to_agent_web_markdown.js";
import {createAgentWebMessagingPageArbitrary} from "~/server/agents/web/test_helpers/agent_web_messaging_page_arbitrary.js";
import {runAgentWebPageGenerativeTests} from "~/server/agents/web/test_helpers/run_agent_web_page_generative_tests.js";
import {ApiContentInlineElementWithoutCommentMarkArbitrary} from "~/shared/api/content/test_helpers/api_content_arbitrary.js";
import {ApiContentInlineElementResponse} from "~/shared/api/specification/types/api_specification_convenience_types.js";
import {InvalidArgumentError} from "~/shared/error/error.js";
import {errorDisplayMessage} from "~/shared/error/error_display_message.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {quote} from "~/shared/helpers/string/quote.js";

type TestCustomBlock = {
    readonly type: "Custom";
    readonly tagName: "custom";
    readonly timeAttribute: null;
    readonly text: string;
};

const TestCustomBlockArbitrary = fc.record({
    type: fc.constant("Custom" as const),
    tagName: fc.constant("custom"),
    timeAttribute: fc.constant(null),
    text: fc.oneof(fc.constant("foo"), fc.constant("bar"), fc.constant("qux")),
});

const AgentWebMessagingPageArbitrary = fc.record(
    createAgentWebMessagingPageArbitrary<
        {readonly elements: ReadonlyArray<ApiContentInlineElementResponse>},
        TestCustomBlock
    >({
        preambleArbitrary: fc.record({
            elements: fc.array(ApiContentInlineElementWithoutCommentMarkArbitrary, {
                maxLength: 4,
            }),
        }),
        customBlockArbitrary: TestCustomBlockArbitrary,
    }),
);

runAgentWebPageGenerativeTests({
    print: (storage, pageLink, page) =>
        printAgentWebMessagingPage(storage, pageLink, page, {
            messageNouns: agentWebMessagingPageMessageNouns,
            printPreamble: async (storage, preamble) => {
                if (preamble.elements.length === 0) return {type: "root", children: []};

                return await printApiContentToAgentWebMarkdownTree(storage, {
                    elements: [{type: "Paragraph", elements: preamble.elements}],
                });
            },
            printCustomBlock: async (storage, customBlock) => ({
                type: "root",
                children: [
                    {type: "html", value: "<custom>"},
                    {type: "paragraph", children: [{type: "text", value: customBlock.text}]},
                    {type: "html", value: "</custom>"},
                ],
            }),
        }),
    parse: (storage, pageLink, root) =>
        parseAgentWebMessagingPage(storage, pageLink, root, {
            messageNouns: agentWebMessagingPageMessageNouns,
            parsePreamble: async (storage, preamble) => {
                const {elements} = await parseApiContentFromAgentWebMarkdownTree(storage, preamble);

                let actualElements: ReadonlyArray<ApiContentInlineElementResponse> = [];

                if (elements.length === 0) {
                    // noop
                } else if (elements.length === 1 && elements[0]!.type === "Paragraph") {
                    actualElements = elements[0].elements;
                } else {
                    throw new InvalidArgumentError("Preamble isn\u2019t a single paragraph", {
                        displayMessage: errorDisplayMessage`Unexpected markdown on line 1. ${agentWebMessagingPageMessageNouns.startOfSentencePluralNoun} markdown must be a list of ${quote(`<${agentWebMessagingPageMessageNouns.noun}>`)}s. Though it may start with a single paragraph with a short description of what we\u2019re looking at.`,
                    });
                }

                return {elements: actualElements};
            },
            parseCustomBlockByTagName: {
                custom: async (storage, root, {openTag, closeTag}) => {
                    assert(openTag === "<custom>");
                    assert(closeTag === "</custom>");

                    assert(root.children[0]?.type === "paragraph");
                    assert(root.children[0].children[0]?.type === "text");

                    return {
                        type: "Custom",
                        tagName: "custom" as const,
                        timeAttribute: null,
                        text: root.children[0].children[0].value,
                    };
                },
            },
        }),
    normalize: page =>
        normalizeAgentWebMessagingPage(page, {
            normalizePreamble: (normalizer, preamble) => {
                normalizer.normalizeInlineElements(preamble.elements);
            },
            normalizeCustomBlock: () => {},
        }),
    pageLink: fc.constant(true),
    page: AgentWebMessagingPageArbitrary,
});
