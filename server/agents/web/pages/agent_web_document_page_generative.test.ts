import fc, {Arbitrary} from "fast-check";
import {normalizeApiContentForAgentWebMarkdown} from "~/server/agents/web/normalize_api_content_for_agent_web_markdown.js";
import {
    AgentWebDocumentPage,
    normalizeAgentWebDocumentPage,
    parseAgentWebDocumentPage,
    printAgentWebDocumentPage,
} from "~/server/agents/web/pages/agent_web_document_page.js";
import {runAgentWebPageGenerativeTests} from "~/server/agents/web/test_helpers/run_agent_web_page_generative_tests.js";
import {
    ApiContentArbitrary as ActualApiContentArbitrary,
    ApiContentTextArbitrary,
    createIdArbitrary,
} from "~/shared/api/content/test_helpers/api_content_arbitrary.js";
import {DocumentId} from "~/shared/id/types/id_types.js";

const ApiContentArbitrary = ActualApiContentArbitrary.map(normalizeApiContentForAgentWebMarkdown);

const AgentWebDocumentPageArbitrary: Arbitrary<AgentWebDocumentPage> = fc.record({
    type: fc.constant("Document"),
    title: ApiContentTextArbitrary,
    content: ApiContentArbitrary,
});

runAgentWebPageGenerativeTests({
    print: printAgentWebDocumentPage,
    parse: parseAgentWebDocumentPage,
    normalize: normalizeAgentWebDocumentPage,
    pageLink: createIdArbitrary<DocumentId>(),
    page: AgentWebDocumentPageArbitrary,
});
