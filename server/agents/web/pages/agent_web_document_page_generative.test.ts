import fc, {Arbitrary} from "fast-check";
import {
    AgentWebDocumentPage,
    normalizeAgentWebDocumentPage,
    parseAgentWebDocumentPage,
    printAgentWebDocumentPage,
} from "~/server/agents/web/pages/agent_web_document_page.open_source.js";
import {runAgentWebPageGenerativeTests} from "~/server/agents/web/test_helpers/run_agent_web_page_generative_tests.js";
import {
    ApiContentArbitrary,
    ApiContentTextArbitrary,
    createIdArbitrary,
} from "~/shared/api/content/test_helpers/api_content_arbitrary.js";
import {DocumentId} from "~/shared/id/types/id_types.open_source.js";

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
