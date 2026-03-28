import fc, {Arbitrary} from "fast-check";
import {
    AgentWebDocumentThreadHeadPagePreamble,
    AgentWebDocumentThreadPage,
    AgentWebDocumentThreadPageCustomBlock,
    AgentWebDocumentThreadTailPagePreamble,
    normalizeAgentWebDocumentThreadPage,
    parseAgentWebDocumentThreadPage,
    printAgentWebDocumentThreadPage,
} from "~/server/agents/web/pages/agent_web_document_thread_page.js";
import {
    AgentWebMessagingPageBlockArbitrary,
    AgentWebMessagingPagePaginationArbitrary,
} from "~/server/agents/web/test_helpers/agent_web_messaging_page_arbitrary.js";
import {runAgentWebPageGenerativeTests} from "~/server/agents/web/test_helpers/run_agent_web_page_generative_tests.js";
import {
    ApiContentTextArbitrary,
    ApiContentWithoutCommentMarkArbitrary,
    createIdArbitrary,
} from "~/shared/api/content/test_helpers/api_content_arbitrary.js";
import {DocumentCommentThreadId, DocumentId} from "~/shared/id/types/id_types.js";

const ApiDocumentReferenceArbitrary = fc.record({
    type: fc.constant("Document"),
    id: createIdArbitrary<DocumentId>(),
    title: ApiContentTextArbitrary,
});

const AgentWebDocumentThreadHeadPagePreambleArbitrary: Arbitrary<AgentWebDocumentThreadHeadPagePreamble> =
    fc.record({
        type: fc.constant("Head"),
        document: ApiDocumentReferenceArbitrary,
        isResolved: fc.boolean(),
    });

const AgentWebDocumentThreadTailPagePreambleArbitrary: Arbitrary<AgentWebDocumentThreadTailPagePreamble> =
    fc.record({
        type: fc.constant("Tail"),
        document: ApiDocumentReferenceArbitrary,
    });

const AgentWebDocumentThreadPageCustomBlockArbitrary: Arbitrary<AgentWebDocumentThreadPageCustomBlock> =
    fc.record({
        type: fc.constant("Custom"),
        tagName: fc.constant("blockquote"),
        timeAttribute: fc.constant(null),
        matchAttribute: fc.oneof(
            {weight: 100, arbitrary: fc.constant(null)},
            {weight: 10, arbitrary: fc.integer({min: 1, max: 10})},
            {weight: 1, arbitrary: fc.constant("deleted" as const)},
        ),
        content: ApiContentWithoutCommentMarkArbitrary,
    });

const AgentWebDocumentThreadHeadPageArbitrary: Arbitrary<AgentWebDocumentThreadPage> = fc.record({
    type: fc.constant("DocumentThread"),
    subType: fc.constant("Head"),
    preamble: AgentWebDocumentThreadHeadPagePreambleArbitrary,
    pagination: fc.oneof(
        {weight: 10, arbitrary: fc.constant(null)},
        {weight: 1, arbitrary: AgentWebMessagingPagePaginationArbitrary},
    ),
    isEndOfMessages: fc.boolean(),
    blocks: fc
        .tuple(
            AgentWebDocumentThreadPageCustomBlockArbitrary,
            fc.array(AgentWebMessagingPageBlockArbitrary),
        )
        .map(([customBlock, blocks]) => [customBlock, ...blocks]),
});

const AgentWebDocumentThreadTailPageArbitrary: Arbitrary<AgentWebDocumentThreadPage> = fc.record({
    type: fc.constant("DocumentThread"),
    subType: fc.constant("Tail"),
    preamble: AgentWebDocumentThreadTailPagePreambleArbitrary,
    pagination: fc.oneof(
        {weight: 10, arbitrary: fc.constant(null)},
        {weight: 1, arbitrary: AgentWebMessagingPagePaginationArbitrary},
    ),
    isEndOfMessages: fc.boolean(),
    blocks: fc.array(AgentWebMessagingPageBlockArbitrary),
});

const AgentWebDocumentThreadPageArbitrary: Arbitrary<AgentWebDocumentThreadPage> = fc.oneof(
    AgentWebDocumentThreadHeadPageArbitrary,
    AgentWebDocumentThreadTailPageArbitrary,
);

runAgentWebPageGenerativeTests({
    print: printAgentWebDocumentThreadPage,
    parse: parseAgentWebDocumentThreadPage,
    normalize: normalizeAgentWebDocumentThreadPage,
    pageLink: fc.record({
        document: fc.record({id: createIdArbitrary<DocumentId>()}),
        threadId: createIdArbitrary<DocumentCommentThreadId>(),
    }),
    page: AgentWebDocumentThreadPageArbitrary,
});
