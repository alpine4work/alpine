import {
    AgentWebDocumentPage,
    parseAgentWebDocumentPage,
    printAgentWebDocumentPage,
} from "~/server/agents/web/pages/agent_web_document_page.js";
import {runAgentWebPageTests} from "~/server/agents/web/pages/run_agent_web_page_tests.js";
import {generateId} from "~/shared/id/id.js";
import {DocumentId} from "~/shared/id/types/id_types.js";

const documentId = generateId<DocumentId>();

runAgentWebPageTests<{id: DocumentId; path: string}, AgentWebDocumentPage>({
    print: printAgentWebDocumentPage,
    parse: parseAgentWebDocumentPage,
    tests: [
        {
            name: "simple document",
            pageLink: {id: documentId, path: "/document/hello-world"},
            page: {
                type: "HeadPage",
                pageNumber: 1,
                isLastPage: true,
                title: "Hello, world!",
                content: {
                    elements: [
                        {
                            type: "Paragraph",
                            elements: [{type: "Text", text: "How are you doing today?"}],
                        },
                    ],
                },
            },
            markdown: `\
# Hello, world!

How are you doing today?
`,
        },
    ],
});
