/* eslint-disable string-quotes */

import {DurableObjectStorage} from "@miniflare/durable-objects";
import {MemoryStorage} from "@miniflare/storage-memory";
import {
    AgentConversationLinkReference,
    listAgentContentLinkReferences,
    printAgentContentToMarkdown,
} from "~/server/agents/internal/print_agent_content_to_markdown.js";
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
    expectedContentLinkReferences: ReadonlyMap<string, AgentConversationLinkReference> = emptyMap,
) {
    const actualMarkdown = await printAgentContentToMarkdown(storage, content, {spaceId});

    expect(actualMarkdown).toEqual(expectedMarkdown);

    expect(await listAgentContentLinkReferences(storage)).toEqual(expectedContentLinkReferences);
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

test("mention preserves structure but removes URL", async () => {
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
        `Check out [My Document][] here.\n`,
        new Map([["My Document", {mentionTargetPath: `/documents/${documentId}`}]]),
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
        `See *[Important Task][]* for details.\n`,
        new Map([["Important Task", {mentionTargetPath: `/tasks/${taskId}`}]]),
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
        `Check [This Post][] and also visit [the docs][missing-link].\n`,
        new Map([["This Post", {mentionTargetPath: `/posts/${postId}`}]]),
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
        `See <a href="missing-link">[Important Task][]</a> for details.\n`,
        new Map([["Important Task", {mentionTargetPath: `/tasks/${taskId}`}]]),
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

test("mentions with conflicting labels get dedupe numbers", async () => {
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
        `First: [My Document][] and second: [My Document 2][].\n`,
        new Map([
            ["My Document", {mentionTargetPath: `/documents/${documentId}`}],
            ["My Document 2", {mentionTargetPath: `/documents/${otherDocumentId}`}],
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
        `First: [My Document][] and again: [My Document][].\n`,
        new Map([["My Document", {mentionTargetPath: `/documents/${documentId}`}]]),
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

    expect(actualMarkdown1).toEqual(`See [My Document][].\n`);
    expect(actualMarkdown2).toEqual(`Also see [My Document 2][].\n`);

    expect(await listAgentContentLinkReferences(storage)).toEqual(
        new Map([
            ["My Document", {mentionTargetPath: `/documents/${documentId}`}],
            ["My Document 2", {mentionTargetPath: `/documents/${otherDocumentId}`}],
        ]),
    );
});

test("mentions with same label increment dedupe numbers up to 5", async () => {
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
        `First: [Task][], second: [Task 2][], third: [Task 3][], fourth: [Task 4][], fifth: [Task 5][], and sixth: [Task 6][].\n`,
        new Map([
            ["Task", {mentionTargetPath: `/documents/${documentId}`}],
            ["Task 2", {mentionTargetPath: `/tasks/${taskId}`}],
            ["Task 3", {mentionTargetPath: `/posts/${postId}`}],
            ["Task 4", {mentionTargetPath: `/documents/${thirdDocumentId}`}],
            ["Task 5", {mentionTargetPath: `/documents/${fourthDocumentId}`}],
            ["Task 6", {mentionTargetPath: `/documents/${fifthDocumentId}`}],
        ]),
    );
});
