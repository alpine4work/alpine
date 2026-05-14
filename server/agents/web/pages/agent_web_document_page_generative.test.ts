import fc, {Arbitrary} from "fast-check";
import {
    AgentWebDocumentPage,
    parseAgentWebDocumentPage,
    printAgentWebDocumentPage,
} from "~/server/agents/web/pages/agent_web_document_page.js";
import {runAgentWebPageGenerativeTests} from "~/server/agents/web/pages/run_agent_web_page_generative_tests.js";
import {normalizeApiContentResponse} from "~/shared/api/markdown/normalize_api_content.js";
import {
    ApiContentArbitrary as ActualApiContentArbitrary,
    ApiContentTextArbitrary,
    createIdArbitrary,
} from "~/shared/api/markdown/test_helpers/api_content_arbitrary.js";
import {DocumentId} from "~/shared/id/types/id_types.js";

const ApiContentArbitrary = ActualApiContentArbitrary.map(normalizeApiContentResponse);

const AgentWebDocumentPageArbitrary: Arbitrary<AgentWebDocumentPage> = fc.record({
    type: fc.constant("Document"),
    title: ApiContentTextArbitrary,
    content: ApiContentArbitrary,
});

runAgentWebPageGenerativeTests({
    print: printAgentWebDocumentPage,
    parse: parseAgentWebDocumentPage,
    pageLink: createIdArbitrary<DocumentId>(),
    page: AgentWebDocumentPageArbitrary,
});
