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
            name: "simple head page",
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
        {
            name: "simple tail page",
            pageLink: {id: documentId, path: "/document/hello-world?page=2"},
            page: {
                type: "TailPage",
                pageNumber: 2,
                isLastPage: true,
                content: {
                    elements: [
                        {
                            type: "Paragraph",
                            elements: [{type: "Text", text: "Continued section."}],
                        },
                    ],
                },
            },
            markdown: `\
Continued section.
`,
            createParseError:
                "A title is required to create a document. Try again but start the new document with a Markdown h1 (e.g. `# My Document`).",
        },
        {
            name: "head page with next-page link",
            pageLink: {
                id: documentId,
                path: "/document/launch-plan",
            },
            page: {
                type: "HeadPage",
                pageNumber: 1,
                isLastPage: false,
                title: "Launch plan",
                content: {
                    elements: [
                        {
                            type: "Paragraph",
                            elements: [{type: "Text", text: "Summary details."}],
                        },
                    ],
                },
            },
            markdown: `\
# Launch plan

Summary details.

[Next page »](/document/launch-plan?page=2)
`,
            createParseError:
                "You can\u2019t add a pagination link to the end of the document you\u2019re creating. To create a document, fully write out its content without splitting the content into pages. Pagination links will be added automatically when the document is read with the `read` tool. Try again but remove the “Next page »” pagination link at the end of your document.",
        },
        {
            name: "tail page with next-page link",
            pageLink: {
                id: documentId,
                path: "/document/launch-plan?page=5",
            },
            page: {
                type: "TailPage",
                pageNumber: 5,
                isLastPage: false,
                content: {
                    elements: [
                        {
                            type: "Paragraph",
                            elements: [{type: "Text", text: "Continued details."}],
                        },
                    ],
                },
            },
            markdown: `\
Continued details.

[Next page »](/document/launch-plan?page=6)
`,
            createParseError:
                "You can’t add a pagination link to the end of the document you’re creating. To create a document, fully write out its content without splitting the content into pages. Pagination links will be added automatically when the document is read with the `read` tool. Try again but remove the “Next page »” pagination link at the end of your document.",
        },
        {
            name: "tail page with explicit page number",
            pageLink: {id: documentId, path: "/document/launch-plan?page=5"},
            page: {
                type: "TailPage",
                pageNumber: 5,
                isLastPage: true,
                content: {
                    elements: [
                        {
                            type: "Paragraph",
                            elements: [{type: "Text", text: "Final details."}],
                        },
                    ],
                },
            },
            markdown: `\
Final details.
`,
            createParseError:
                "A title is required to create a document. Try again but start the new document with a Markdown h1 (e.g. `# My Document`).",
        },
        {
            name: "head page with additional h1",
            pageLink: {id: documentId, path: "/document/hello-world"},
            markdown: `\
# Hello, world!

How are you doing today?

# La la land

Isn\u2019t that neat?
`,
            parseError:
                "A document can only have one Markdown h1 (e.g. `# My Document`) and the h1 must be placed at the beginning of the document. You added an additional Markdown h1 “La la land”. Try again but remove the additional Markdown h1 or make it an h2 (e.g. `## My Sub-heading`).",
        },
        {
            name: "tail page with additional h1",
            pageLink: {id: documentId, path: "/document/hello-world?page=2"},
            markdown: `\
How are you doing today?

# La la land

Isn\u2019t that neat?
`,
            parseError:
                "A document can only have one Markdown h1 (e.g. `# My Document`) and the h1 must be placed at the beginning of the document. You added an additional Markdown h1 “La la land”. Try again but remove the additional Markdown h1 or make it an h2 (e.g. `## My Sub-heading`).",
        },
    ],
});
