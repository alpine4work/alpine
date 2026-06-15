import {
    AgentWebDocumentPage,
    normalizeAgentWebDocumentPage,
    parseAgentWebDocumentPage,
    printAgentWebDocumentPage,
} from "~/server/agents/web/pages/agent_web_document_page.js";
import {runAgentWebPageTests} from "~/server/agents/web/test_helpers/run_agent_web_page_tests.js";
import {generateId} from "~/shared/id/id.js";
import {DocumentCommentThreadId, DocumentId} from "~/shared/id/types/id_types.js";

const documentId = generateId<DocumentId>();
const commentThreadId1 = generateId<DocumentCommentThreadId>();
const commentThreadId2 = generateId<DocumentCommentThreadId>();
const commentThreadId3 = generateId<DocumentCommentThreadId>();
const commentThreadId4 = generateId<DocumentCommentThreadId>();
const commentThreadId5 = generateId<DocumentCommentThreadId>();

runAgentWebPageTests<DocumentId, AgentWebDocumentPage>({
    print: printAgentWebDocumentPage,
    parse: parseAgentWebDocumentPage,
    normalize: normalizeAgentWebDocumentPage,
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
                "A title is required for documents. Try again but make sure the document starts with a markdown h1 (e.g. `# My Document`).",
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
                "A document can only have one markdown h1 (e.g. `# My Document`) and the h1 must be placed at the start of the document. You added an additional markdown h1 \u201CLa la land\u201D. Try again but remove the additional markdown h1 or make it an h2 (e.g. `## My Sub-heading`).",
        },
        {
            name: "document page with one comment",
            pageLink: documentId,
            markdown: `\
# One comment

Please <comment id="1">review this section</comment> today.
`,
            page: {
                type: "Document",
                title: "One comment",
                content: {
                    elements: [
                        {
                            type: "Paragraph",
                            elements: [
                                {type: "Text", text: "Please "},
                                {
                                    type: "Text",
                                    text: "review this section",
                                    marks: [{type: "Comment", thread: {id: commentThreadId1}}],
                                },
                                {type: "Text", text: " today."},
                            ],
                        },
                    ],
                },
            },
            createParseError:
                "Can\u2019t create `<comment>`s while creating a document. First create the document without comments and then add the `<comment>`s in after.",
        },
        {
            name: "document page with two comments",
            pageLink: documentId,
            markdown: `\
# Two comments

<comment id="1">alpha</comment> and <comment id="2">beta</comment>
`,
            page: {
                type: "Document",
                title: "Two comments",
                content: {
                    elements: [
                        {
                            type: "Paragraph",
                            elements: [
                                {
                                    type: "Text",
                                    text: "alpha",
                                    marks: [{type: "Comment", thread: {id: commentThreadId1}}],
                                },
                                {type: "Text", text: " and "},
                                {
                                    type: "Text",
                                    text: "beta",
                                    marks: [{type: "Comment", thread: {id: commentThreadId2}}],
                                },
                            ],
                        },
                    ],
                },
            },
            createParseError:
                "Can\u2019t create `<comment>`s while creating a document. First create the document without comments and then add the `<comment>`s in after.",
        },
        {
            name: "document page with three comments",
            pageLink: documentId,
            markdown: `\
# Three comments

<comment id="1">one</comment>, <comment id="2">two</comment>, and <comment id="3">three</comment>
`,
            page: {
                type: "Document",
                title: "Three comments",
                content: {
                    elements: [
                        {
                            type: "Paragraph",
                            elements: [
                                {
                                    type: "Text",
                                    text: "one",
                                    marks: [{type: "Comment", thread: {id: commentThreadId1}}],
                                },
                                {type: "Text", text: ", "},
                                {
                                    type: "Text",
                                    text: "two",
                                    marks: [{type: "Comment", thread: {id: commentThreadId2}}],
                                },
                                {type: "Text", text: ", and "},
                                {
                                    type: "Text",
                                    text: "three",
                                    marks: [{type: "Comment", thread: {id: commentThreadId3}}],
                                },
                            ],
                        },
                    ],
                },
            },
            createParseError:
                "Can\u2019t create `<comment>`s while creating a document. First create the document without comments and then add the `<comment>`s in after.",
        },
        {
            name: "document page with seven comments",
            pageLink: documentId,
            markdown: `\
# Seven comments

<comment id="1">alpha</comment> <comment id="2">beta</comment> <comment id="3">gamma</comment> <comment id="1">delta</comment> <comment id="4">epsilon</comment> <comment id="2">zeta</comment> <comment id="5">eta</comment>
`,
            page: {
                type: "Document",
                title: "Seven comments",
                content: {
                    elements: [
                        {
                            type: "Paragraph",
                            elements: [
                                {
                                    type: "Text",
                                    text: "alpha",
                                    marks: [{type: "Comment", thread: {id: commentThreadId1}}],
                                },
                                {type: "Text", text: " "},
                                {
                                    type: "Text",
                                    text: "beta",
                                    marks: [{type: "Comment", thread: {id: commentThreadId2}}],
                                },
                                {type: "Text", text: " "},
                                {
                                    type: "Text",
                                    text: "gamma",
                                    marks: [{type: "Comment", thread: {id: commentThreadId3}}],
                                },
                                {type: "Text", text: " "},
                                {
                                    type: "Text",
                                    text: "delta",
                                    marks: [{type: "Comment", thread: {id: commentThreadId1}}],
                                },
                                {type: "Text", text: " "},
                                {
                                    type: "Text",
                                    text: "epsilon",
                                    marks: [{type: "Comment", thread: {id: commentThreadId4}}],
                                },
                                {type: "Text", text: " "},
                                {
                                    type: "Text",
                                    text: "zeta",
                                    marks: [{type: "Comment", thread: {id: commentThreadId2}}],
                                },
                                {type: "Text", text: " "},
                                {
                                    type: "Text",
                                    text: "eta",
                                    marks: [{type: "Comment", thread: {id: commentThreadId5}}],
                                },
                            ],
                        },
                    ],
                },
            },
            createParseError:
                "Can\u2019t create `<comment>`s while creating a document. First create the document without comments and then add the `<comment>`s in after.",
        },
    ],
});
