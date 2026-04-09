import {
    AgentWebDocumentPage,
    parseAgentWebDocumentPage,
    printAgentWebDocumentPage,
} from "~/server/agents/web/pages/agent_web_document_page.js";
import {runAgentWebPageTests} from "~/server/agents/web/pages/run_agent_web_page_tests.js";
import {generateId} from "~/shared/id/id.js";
import {DocumentId} from "~/shared/id/types/id_types.js";

const documentId = generateId<DocumentId>();

runAgentWebPageTests<DocumentId, AgentWebDocumentPage>({
    print: printAgentWebDocumentPage,
    parse: parseAgentWebDocumentPage,
    tests: [
        {
            name: "simple document page",
            pageLink: documentId,
            page: {
                type: "Document",
                title: "Hello, world!",
                content: {
                    elements: [
                        {
                            type: "Paragraph",
                            elements: [
                                {
                                    type: "Text",
                                    text: "How are you doing today?",
                                    marks: undefined,
                                },
                            ],
                        },
                    ],
                },
            },
            markdown: `\
# Hello, world!

How are you doing today?
`,
        },
        {
            name: "document page without title",
            pageLink: documentId,
            markdown: `\
How are you doing today?
`,
            parseError:
                "A title is required for documents. Try again but make sure the document starts with a Markdown h1 (e.g. `# My Document`).",
        },
        {
            name: "document page with additional h1",
            pageLink: documentId,
            markdown: `\
# Hello, world!

This is a cool doc.

# La la land

Isn\u2019t that neat?
`,
            parseError:
                "A document can only have one Markdown h1 (e.g. `# My Document`) and the h1 must be placed at the start of the document. You added an additional Markdown h1 “La la land”. Try again but remove the additional Markdown h1 or make it an h2 (e.g. `## My Sub-heading`).",
        },
    ],
});
