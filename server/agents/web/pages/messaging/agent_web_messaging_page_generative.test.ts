import fc from "fast-check";
import {agentWebMessagingPageMessageNouns} from "~/server/agents/web/pages/messaging/agent_web_messaging_page.js";
import {normalizeAgentWebMessagingPage} from "~/server/agents/web/pages/messaging/normalize_agent_web_messaging_page.js";
import {parseAgentWebMessagingPage} from "~/server/agents/web/pages/messaging/parse_agent_web_messaging_page.js";
import {printAgentWebMessagingPage} from "~/server/agents/web/pages/messaging/print_agent_web_messaging_page.js";
import {runAgentWebPageGenerativeTests} from "~/server/agents/web/pages/run_agent_web_page_generative_tests.js";
import {parseApiContentFromAgentWebMarkdownTree} from "~/server/agents/web/parse_api_content_from_agent_web_markdown.js";
import {printApiContentToAgentWebMarkdownTree} from "~/server/agents/web/print_api_content_to_agent_web_markdown.js";
import {createAgentWebMessagingPageArbitrary} from "~/server/agents/web/test_helpers/agent_web_messaging_page_arbitrary.js";
import {ApiContentInlineElementWithoutCommentMarkArbitrary} from "~/shared/api/markdown/test_helpers/api_content_arbitrary.js";
import {ApiContentInlineElementResponse} from "~/shared/api/specification/types/api_specification_convenience_types.js";
import {InvalidArgumentError} from "~/shared/error/error.js";
import {errorDisplayMessage} from "~/shared/error/error_display_message.js";

const AgentWebMessagingPageArbitrary = fc.record(
    createAgentWebMessagingPageArbitrary<{
        readonly elements: ReadonlyArray<ApiContentInlineElementResponse>;
    }>(
        fc.record({
            elements: fc.array(ApiContentInlineElementWithoutCommentMarkArbitrary, {
                maxLength: 4,
            }),
        }),
    ),
);

runAgentWebPageGenerativeTests({
    print: (storage, pageLink, page) =>
        printAgentWebMessagingPage(storage, pageLink, page, {
            messageNouns: agentWebMessagingPageMessageNouns,
            printPreamble: async (storage, preamble) => {
                return await printApiContentToAgentWebMarkdownTree(storage, {
                    elements: [{type: "Paragraph", elements: preamble.elements}],
                });
            },
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
                        displayMessage: errorDisplayMessage`Unexpected markdown on line 1. ${agentWebMessagingPageMessageNouns.startOfSentencePluralNoun} markdown must be a list of \`<${agentWebMessagingPageMessageNouns.noun}>\`s. Though it may start with a single paragraph with a short description of what we\u2019re looking at.`,
                    });
                }

                return {elements: actualElements};
            },
        }),
    normalize: page =>
        normalizeAgentWebMessagingPage(page, {
            normalizePreamble: (normalizer, preamble) => {
                normalizer.normalizeInlineElements(preamble.elements);
            },
        }),
    pageLink: fc.constant(true),
    page: AgentWebMessagingPageArbitrary,
});
