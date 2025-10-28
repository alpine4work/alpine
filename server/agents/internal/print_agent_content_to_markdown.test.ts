/* eslint-disable string-quotes */

import {DurableObjectStorage} from "@miniflare/durable-objects";
import {MemoryStorage} from "@miniflare/storage-memory";
import {AgentLink} from "~/server/agents/internal/link_references/agent_link.js";
import {listAgentLinksForTest} from "~/server/agents/internal/link_references/agent_link_collection.js";
import {printAgentContentToMarkdown} from "~/server/agents/internal/print_agent_content_to_markdown.js";
import {ApiContent} from "~/shared/api/types/api_specification_convenience_types.js";
import {emptyMap} from "~/shared/helpers/map/empty_map.js";
import {generateId} from "~/shared/id/id.js";
import {DocumentId, PostId, SpaceId, TaskId} from "~/shared/id/types/id_types.js";

const spaceId = generateId<SpaceId>();
const documentId = generateId<DocumentId>();
const otherDocumentId = generateId<DocumentId>();
const postId = generateId<PostId>();
const taskId = generateId<TaskId>();

const storage = new DurableObjectStorage(new MemoryStorage());

afterEach(async () => {
    await storage.deleteAll();
});

async function testPrintAgentContentToMarkdown(
    content: ApiContent,
    expectedMarkdown: string,
    expectedContentLinkReferences: ReadonlyMap<string, AgentLink> = emptyMap,
) {
    const actualMarkdown = await printAgentContentToMarkdown(storage, content, {spaceId});

    expect(actualMarkdown).toEqual(expectedMarkdown);

    const actualContentLinkReferences = await listAgentLinksForTest(storage);
    const actualContentLinkReferencesMap = new Map<string, AgentLink>();
    for (const [key, reference] of actualContentLinkReferences) {
        actualContentLinkReferencesMap.set(key, reference);
    }

    expect(actualContentLinkReferencesMap).toEqual(expectedContentLinkReferences);
}

test("simple paragraph without links", async () => {
    await testPrintAgentContentToMarkdown(
        {
            elements: [
                {
                    type: "Paragraph",
                    elements: [{type: "Text", text: "Hello, world!"}],
                },
            ],
        },
        `Hello, world!\n`,
    );
});

test("external link (via Link mark) gets converted to plain text", async () => {
    await testPrintAgentContentToMarkdown(
        {
            elements: [
                {
                    type: "Paragraph",
                    elements: [
                        {type: "Text", text: "Visit "},
                        {
                            type: "Text",
                            text: "our website",
                            marks: [{type: "Link", url: "https://example.com"}],
                        },
                        {type: "Text", text: " for more info."},
                    ],
                },
            ],
        },
        `Visit [our website][missing-link] for more info.\n`,
    );
});

test("mention preserves structure but changes URL", async () => {
    await testPrintAgentContentToMarkdown(
        {
            elements: [
                {
                    type: "Paragraph",
                    elements: [
                        {type: "Text", text: "Check out "},
                        {
                            type: "Mention",
                            targetPath: `/documents/${documentId}`,
                            title: "My Document",
                        },
                        {type: "Text", text: " here."},
                    ],
                },
            ],
        },
        `Check out [My Document](/document/my-document) here.\n`,
        new Map([
            [
                "/document/my-document",
                {
                    type: "DocumentPage",
                    documentId,
                    title: "My Document",
                    localDocumentPage: null,
                },
            ],
        ]),
    );
});

test("non-mentionable content replaces link with missing link", async () => {
    await testPrintAgentContentToMarkdown(
        {
            elements: [
                {
                    type: "Paragraph",
                    elements: [
                        {type: "Text", text: "Check out "},
                        {
                            type: "Text",
                            text: "My comment",
                            marks: [{type: "Link", url: `/posts/${postId}/messages/1`}],
                        },
                        {type: "Text", text: " here."},
                    ],
                },
            ],
        },
        `Check out [My comment][missing-link] here.\n`,
        emptyMap,
    );
});

test("multiple external links (via Link marks) get converted to plain text", async () => {
    await testPrintAgentContentToMarkdown(
        {
            elements: [
                {
                    type: "Paragraph",
                    elements: [
                        {
                            type: "Text",
                            text: "Google",
                            marks: [{type: "Link", url: "https://google.com"}],
                        },
                        {type: "Text", text: " and "},
                        {
                            type: "Text",
                            text: "GitHub",
                            marks: [{type: "Link", url: "https://github.com"}],
                        },
                        {type: "Text", text: " are useful."},
                    ],
                },
            ],
        },
        `[Google][missing-link] and [GitHub][missing-link] are useful.\n`,
    );
});

test("invalid URL in link mark gets converted to plain text", async () => {
    await testPrintAgentContentToMarkdown(
        {
            elements: [
                {
                    type: "Paragraph",
                    elements: [
                        {type: "Text", text: "Bad link: "},
                        {
                            type: "Text",
                            text: "click here",
                            marks: [{type: "Link", url: "not-a-valid-url"}],
                        },
                    ],
                },
            ],
        },
        `Bad link: [click here][missing-link]\n`,
    );
});

test("text with simple formatting", async () => {
    await testPrintAgentContentToMarkdown(
        {
            elements: [
                {
                    type: "Paragraph",
                    elements: [
                        {type: "Text", text: "Before "},
                        {type: "Text", text: "bold text", marks: [{type: "Bold"}]},
                        {type: "Text", text: " after."},
                    ],
                },
            ],
        },
        `Before **bold text** after.\n`,
    );
});

test("external link with nested formatting gets flattened", async () => {
    await testPrintAgentContentToMarkdown(
        {
            elements: [
                {
                    type: "Paragraph",
                    elements: [
                        {type: "Text", text: "Visit our "},
                        {
                            type: "Text",
                            text: "amazing",
                            marks: [{type: "Bold"}, {type: "Link", url: "https://example.com"}],
                        },
                        {type: "Text", text: " website!"},
                    ],
                },
            ],
        },
        `Visit our [**amazing**][missing-link] website!\n`,
    );
});

test("mention with nested formatting preserves formatting but removes URL", async () => {
    await testPrintAgentContentToMarkdown(
        {
            elements: [
                {
                    type: "Paragraph",
                    elements: [
                        {type: "Text", text: "See "},
                        {
                            type: "Mention",
                            targetPath: `/tasks/${taskId}`,
                            title: "Important Task",
                            marks: [{type: "Italic"}],
                        },
                        {type: "Text", text: " for details."},
                    ],
                },
            ],
        },
        `See *[Important Task](/task/important-task)* for details.\n`,
        new Map([
            [
                "/task/important-task",
                {
                    type: "Task",
                    taskId,
                    title: "Important Task",
                },
            ],
        ]),
    );
});

test("mixed mentions and external links", async () => {
    await testPrintAgentContentToMarkdown(
        {
            elements: [
                {
                    type: "Paragraph",
                    elements: [
                        {type: "Text", text: "Check "},
                        {
                            type: "Mention",
                            targetPath: `/posts/${postId}`,
                            title: "This Post",
                        },
                        {type: "Text", text: " and also visit "},
                        {
                            type: "Text",
                            text: "the docs",
                            marks: [{type: "Link", url: "https://docs.example.com"}],
                        },
                        {type: "Text", text: "."},
                    ],
                },
            ],
        },
        `Check [This Post](/post/this-post) and also visit [the docs][missing-link].\n`,
        new Map([
            [
                "/post/this-post",
                {
                    type: "PostComments",
                    postId,
                    label: "This Post",
                    pageInfo: {
                        from: "Start",
                        index: 0,
                    },
                    pageNumber: 1,
                    paginationType: "page",
                    rootMessage: null,
                },
            ],
        ]),
    );
});

test("mention with link mark becomes HTML anchor tag with replaced href", async () => {
    await testPrintAgentContentToMarkdown(
        {
            elements: [
                {
                    type: "Paragraph",
                    elements: [
                        {type: "Text", text: "See "},
                        {
                            type: "Mention",
                            targetPath: `/tasks/${taskId}`,
                            title: "Important Task",
                            marks: [{type: "Link", url: "https://external.com"}],
                        },
                        {type: "Text", text: " for details."},
                    ],
                },
            ],
        },
        `See <a href="missing-link">[Important Task](/task/important-task)</a> for details.\n`,
        new Map([
            [
                "/task/important-task",
                {
                    type: "Task",
                    taskId,
                    title: "Important Task",
                },
            ],
        ]),
    );
});

test("link with mention-like URL becomes HTML anchor tag with replaced href", async () => {
    await testPrintAgentContentToMarkdown(
        {
            elements: [
                {
                    type: "Paragraph",
                    elements: [
                        {type: "Text", text: "Visit "},
                        {
                            type: "Text",
                            text: "this page",
                            marks: [
                                {
                                    type: "Link",
                                    url: `https://alpine.inc/s/${spaceId}/documents/${documentId}?mention`,
                                },
                            ],
                        },
                        {type: "Text", text: " here."},
                    ],
                },
            ],
        },
        `Visit <a href="missing-link">this page</a> here.\n`,
    );
});

test("code block with links gets href attributes replaced", async () => {
    await testPrintAgentContentToMarkdown(
        {
            elements: [
                {
                    type: "Code",
                    language: "html",
                    lines: [
                        {
                            elements: [
                                {type: "Text", text: "Visit "},
                                {
                                    type: "Text",
                                    text: "https://example.com",
                                    marks: [{type: "Link", url: "https://example.com"}],
                                },
                                {type: "Text", text: " and "},
                                {
                                    type: "Text",
                                    text: "local link",
                                    marks: [
                                        {
                                            type: "Link",
                                            url: `https://alpine.inc/s/${spaceId}/d/123?mention=true`,
                                        },
                                    ],
                                },
                            ],
                        },
                    ],
                },
            ],
        },
        `\
<pre>
<code class="language-html">
Visit <a href="missing-link">https://example.com</a> and <a href="missing-link">local link</a>
</code>
</pre>
`,
    );
});

test("mentions with conflicting link Ids get dedupe numbers but labels are unchanged", async () => {
    await testPrintAgentContentToMarkdown(
        {
            elements: [
                {
                    type: "Paragraph",
                    elements: [
                        {type: "Text", text: "First: "},
                        {
                            type: "Mention",
                            targetPath: `/documents/${documentId}`,
                            title: "My Document",
                        },
                        {type: "Text", text: " and second: "},
                        {
                            type: "Mention",
                            targetPath: `/documents/${otherDocumentId}`,
                            title: "My Document",
                        },
                        {type: "Text", text: "."},
                    ],
                },
            ],
        },
        `First: [My Document](/document/my-document) and second: [My Document](/document/my-document-2).\n`,
        new Map([
            [
                "/document/my-document",
                {
                    type: "DocumentPage",
                    documentId,
                    title: "My Document",
                    localDocumentPage: null,
                },
            ],
            [
                "/document/my-document-2",
                {
                    type: "DocumentPage",
                    documentId: otherDocumentId,
                    title: "My Document",
                    dedupeNumber: 2,
                    localDocumentPage: null,
                },
            ],
        ]),
    );
});

test("identical mentions with same label and target path reuse the same reference", async () => {
    await testPrintAgentContentToMarkdown(
        {
            elements: [
                {
                    type: "Paragraph",
                    elements: [
                        {type: "Text", text: "First: "},
                        {
                            type: "Mention",
                            targetPath: `/documents/${documentId}`,
                            title: "My Document",
                        },
                        {type: "Text", text: " and again: "},
                        {
                            type: "Mention",
                            targetPath: `/documents/${documentId}`,
                            title: "My Document",
                        },
                        {type: "Text", text: "."},
                    ],
                },
            ],
        },
        `First: [My Document](/document/my-document) and again: [My Document](/document/my-document).\n`,
        new Map([
            [
                "/document/my-document",
                {
                    type: "DocumentPage",
                    documentId,
                    title: "My Document",
                    localDocumentPage: null,
                },
            ],
        ]),
    );
});

test("multiple calls to `printAgentContentToMarkdown()` dedupe across calls", async () => {
    const actualMarkdown1 = await storage.transaction(transaction =>
        printAgentContentToMarkdown(
            transaction,
            {
                elements: [
                    {
                        type: "Paragraph",
                        elements: [
                            {type: "Text", text: "See "},
                            {
                                type: "Mention",
                                targetPath: `/documents/${documentId}`,
                                title: "My Document",
                            },
                            {type: "Text", text: "."},
                        ],
                    },
                ],
            },
            {spaceId},
        ),
    );

    const actualMarkdown2 = await storage.transaction(transaction =>
        printAgentContentToMarkdown(
            transaction,
            {
                elements: [
                    {
                        type: "Paragraph",
                        elements: [
                            {type: "Text", text: "Also see "},
                            {
                                type: "Mention",
                                targetPath: `/documents/${otherDocumentId}`,
                                title: "My Document",
                            },
                            {type: "Text", text: "."},
                        ],
                    },
                ],
            },
            {spaceId},
        ),
    );

    expect(actualMarkdown1).toEqual(`See [My Document](/document/my-document).\n`);
    expect(actualMarkdown2).toEqual(`Also see [My Document](/document/my-document-2).\n`);

    expect(await listAgentLinksForTest(storage)).toEqual(
        new Map([
            [
                "/document/my-document",
                {
                    type: "DocumentPage",
                    documentId,
                    title: "My Document",
                    localDocumentPage: null,
                },
            ],
            [
                "/document/my-document-2",
                {
                    type: "DocumentPage",
                    documentId: otherDocumentId,
                    title: "My Document",
                    dedupeNumber: 2,
                    localDocumentPage: null,
                },
            ],
        ]),
    );
});

test("mentions with same link Ids increment dedupe numbers up to 5", async () => {
    // NOTE(ifitzsimmons) The name of this test is a little confusing.
    // **There is no hard limit of 5**. This test simply verifies that
    // our dedupe logic works up until at least the number 5
    const secondDocumentId = generateId<DocumentId>();
    const thirdDocumentId = generateId<DocumentId>();
    const fourthDocumentId = generateId<DocumentId>();
    const fifthDocumentId = generateId<DocumentId>();

    await testPrintAgentContentToMarkdown(
        {
            elements: [
                {
                    type: "Paragraph",
                    elements: [
                        {type: "Text", text: "First: "},
                        {
                            type: "Mention",
                            targetPath: `/documents/${documentId}`,
                            title: "Task",
                        },
                        {type: "Text", text: ", second: "},
                        {
                            type: "Mention",
                            targetPath: `/documents/${secondDocumentId}`,
                            title: "Task",
                        },
                        {type: "Text", text: ", third: "},
                        {
                            type: "Mention",
                            targetPath: `/documents/${thirdDocumentId}`,
                            title: "Task",
                        },
                        {type: "Text", text: ", fourth: "},
                        {
                            type: "Mention",
                            targetPath: `/documents/${fourthDocumentId}`,
                            title: "Task",
                        },
                        {type: "Text", text: ", and fifth: "},
                        {
                            type: "Mention",
                            targetPath: `/documents/${fifthDocumentId}`,
                            title: "Task",
                        },
                        {type: "Text", text: "."},
                    ],
                },
            ],
        },
        `First: [Task](/document/task), second: [Task](/document/task-2), third: [Task](/document/task-3), fourth: [Task](/document/task-4), and fifth: [Task](/document/task-5).\n`,
        new Map([
            [
                "/document/task",
                {
                    type: "DocumentPage",
                    documentId,
                    title: "Task",
                    localDocumentPage: null,
                },
            ],
            [
                "/document/task-2",
                {
                    type: "DocumentPage",
                    documentId: secondDocumentId,
                    title: "Task",
                    dedupeNumber: 2,
                    localDocumentPage: null,
                },
            ],
            [
                "/document/task-3",
                {
                    type: "DocumentPage",
                    documentId: thirdDocumentId,
                    title: "Task",
                    dedupeNumber: 3,
                    localDocumentPage: null,
                },
            ],
            [
                "/document/task-4",
                {
                    type: "DocumentPage",
                    documentId: fourthDocumentId,
                    title: "Task",
                    dedupeNumber: 4,
                    localDocumentPage: null,
                },
            ],
            [
                "/document/task-5",
                {
                    type: "DocumentPage",
                    documentId: fifthDocumentId,
                    title: "Task",
                    dedupeNumber: 5,
                    localDocumentPage: null,
                },
            ],
        ]),
    );
});

test("dedupes by entity and label combination", async () => {
    const thirdDocumentId = generateId<DocumentId>();
    const fourthDocumentId = generateId<DocumentId>();
    const fifthDocumentId = generateId<DocumentId>();

    await testPrintAgentContentToMarkdown(
        {
            elements: [
                {
                    type: "Paragraph",
                    elements: [
                        {type: "Text", text: "First: "},
                        {
                            type: "Mention",
                            targetPath: `/documents/${documentId}`,
                            title: "Task",
                        },
                        {type: "Text", text: ", second: "},
                        {
                            type: "Mention",
                            targetPath: `/tasks/${taskId}`,
                            title: "Task",
                        },
                        {type: "Text", text: ", third: "},
                        {
                            type: "Mention",
                            targetPath: `/posts/${postId}`,
                            title: "Task",
                        },
                        {type: "Text", text: ", fourth: "},
                        {
                            type: "Mention",
                            targetPath: `/documents/${thirdDocumentId}`,
                            title: "Task",
                        },
                        {type: "Text", text: ", fifth: "},
                        {
                            type: "Mention",
                            targetPath: `/documents/${fourthDocumentId}`,
                            title: "Task",
                        },
                        {type: "Text", text: ", and sixth: "},
                        {
                            type: "Mention",
                            targetPath: `/documents/${fifthDocumentId}`,
                            title: "Task",
                        },
                        {type: "Text", text: "."},
                    ],
                },
            ],
        },
        `First: [Task](/document/task), second: [Task](/task/task), third: [Task](/post/task), fourth: [Task](/document/task-2), fifth: [Task](/document/task-3), and sixth: [Task](/document/task-4).\n`,
        new Map([
            [
                "/document/task",
                {
                    type: "DocumentPage",
                    documentId,
                    title: "Task",
                    localDocumentPage: null,
                },
            ],
            [
                "/task/task",
                {
                    type: "Task",
                    taskId,
                    title: "Task",
                },
            ],
            [
                "/post/task",
                {
                    type: "PostComments",
                    postId,
                    label: "Task",
                    pageInfo: {
                        from: "Start",
                        index: 0,
                    },
                    pageNumber: 1,
                    paginationType: "page",
                    rootMessage: null,
                },
            ],
            [
                "/document/task-2",
                {
                    type: "DocumentPage",
                    documentId: thirdDocumentId,
                    title: "Task",
                    dedupeNumber: 2,
                    localDocumentPage: null,
                },
            ],
            [
                "/document/task-3",
                {
                    type: "DocumentPage",
                    documentId: fourthDocumentId,
                    title: "Task",
                    dedupeNumber: 3,
                    localDocumentPage: null,
                },
            ],
            [
                "/document/task-4",
                {
                    type: "DocumentPage",
                    documentId: fifthDocumentId,
                    title: "Task",
                    dedupeNumber: 4,
                    localDocumentPage: null,
                },
            ],
        ]),
    );
});
