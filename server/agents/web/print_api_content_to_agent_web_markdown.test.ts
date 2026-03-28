/* eslint-disable cyberworlds/string-quotes */

import {
    AgentWebSessionStorage,
    AgentWebSessionStorageCollection,
} from "~/server/agents/web/agent_web_session_storage.js";
import {printApiContentToAgentWebMarkdown} from "~/server/agents/web/print_api_content_to_agent_web_markdown.js";
import {DurableObjectStorageCollection} from "~/server/cloudflare/durable_object_storage_collection.js";
import {TemporaryDurableObjectStorage} from "~/server/cloudflare/temporary_durable_object_storage.js";
import {ApiContentResponse} from "~/shared/api/specification/types/api_specification_convenience_types.js";
import {Mutex} from "~/shared/helpers/async/mutex.js";
import {generateOrderKeyBetween, initialOrderKey} from "~/shared/helpers/sort/order_key.js";
import {generateId} from "~/shared/id/id.js";
import {DocumentId, SpaceId, TaskId} from "~/shared/id/types/id_types.js";

const spaceId = generateId<SpaceId>();
const documentId = generateId<DocumentId>();
const otherDocumentId = generateId<DocumentId>();
const taskId = generateId<TaskId>();

const exampleUrl = `https://example.com/${generateId()}/${generateId()}/${generateId()}`;
const exampleTruncatedUrl = exampleUrl.slice(0, 40) + "…" + exampleUrl.slice(-10);
const otherExampleUrl = exampleUrl.slice(0, 70) + "ZZZ" + exampleUrl.slice(73);

const exampleUrlWithHash = exampleUrl.slice(0, -4) + "#" + exampleUrl.slice(-4);
const exampleTruncatedUrlWithHash =
    exampleUrlWithHash.slice(0, 40) + "…" + exampleUrlWithHash.slice(-10);
const otherExampleUrlWithHash =
    exampleUrlWithHash.slice(0, 70) + "ZZZ" + exampleUrlWithHash.slice(73);

const temporaryStorage = new TemporaryDurableObjectStorage();

afterEach(async () => {
    await temporaryStorage.deleteAll();
});

let nextOrderKey = initialOrderKey;

function createAgentWebSessionStorageCollection<
    Key extends string,
    Value,
>(): AgentWebSessionStorageCollection<Key, Value> {
    const orderKey = nextOrderKey;
    nextOrderKey = generateOrderKeyBetween(nextOrderKey, null);

    const collection = new DurableObjectStorageCollection<Key, Value>(orderKey);

    return {
        get: collection.get.bind(collection, temporaryStorage),
        put: collection.put.bind(collection, temporaryStorage),
        list: collection.list.bind(collection, temporaryStorage),
    };
}

const storage: AgentWebSessionStorage = {
    mutex: new Mutex(),
    pageKeyByLinkPath: createAgentWebSessionStorageCollection(),
    lastPageLinkPathByKey: createAgentWebSessionStorageCollection(),
    dedupeNumberByTruncatedUrlAndUrl: createAgentWebSessionStorageCollection(),
};

const testCases: Array<{
    name: string;
    content: ApiContentResponse;
    markdown: string;
}> = [
    {
        name: "heading depth increment",
        content: {
            elements: [
                {
                    type: "Heading",
                    level: 1,
                    elements: [{type: "Text", text: "Heading 1"}],
                },
                {
                    type: "Heading",
                    level: 2,
                    elements: [{type: "Text", text: "Heading 2"}],
                },
                {
                    type: "Heading",
                    level: 3,
                    elements: [{type: "Text", text: "Heading 3"}],
                },
            ],
        },
        markdown: `\
## Heading 1

### Heading 2

#### Heading 3
`,
    },
    {
        name: "task mention element",
        content: {
            elements: [
                {
                    type: "Paragraph",
                    elements: [
                        {type: "Text", text: "Review "},
                        {
                            type: "Mention",
                            target: {
                                type: "Task",
                                id: taskId,
                                title: "Fix auth",
                                status: {type: "Open", isActive: true},
                            },
                        },
                        {type: "Text", text: " today"},
                    ],
                },
            ],
        },
        markdown: `\
Review [Fix auth (Open)](/task/fix-auth) today
`,
    },
    {
        name: "duplicated mention elements",
        content: {
            elements: [
                {
                    type: "Paragraph",
                    elements: [
                        {type: "Text", text: "See "},
                        {
                            type: "Mention",
                            target: {
                                type: "Document",
                                id: documentId,
                                title: "Product Spec",
                            },
                        },
                        {type: "Text", text: " and "},
                        {
                            type: "Mention",
                            target: {
                                type: "Document",
                                id: otherDocumentId,
                                title: "Product Spec",
                            },
                        },
                    ],
                },
            ],
        },
        markdown: `\
See [Product Spec](/document/product-spec) and [Product Spec](/document/product-spec-2)
`,
    },
    {
        name: "link marks",
        content: {
            elements: [
                {
                    type: "Paragraph",
                    elements: [
                        {type: "Text", text: "Visit "},
                        {
                            type: "Text",
                            text: "https://example.com",
                            marks: [{type: "Link", url: exampleUrl}],
                        },
                        {type: "Text", text: " for more"},
                    ],
                },
            ],
        },
        markdown: `\
Visit [https://example.com](${exampleTruncatedUrl}) for more
`,
    },
    {
        name: "duplicated link marks",
        content: {
            elements: [
                {
                    type: "Paragraph",
                    elements: [
                        {type: "Text", text: "Visit "},
                        {
                            type: "Text",
                            text: "https://example.com",
                            marks: [{type: "Link", url: exampleUrl}],
                        },
                        {type: "Text", text: " and "},
                        {
                            type: "Text",
                            text: "https://example.com",
                            marks: [{type: "Link", url: otherExampleUrl}],
                        },
                        {type: "Text", text: " for more"},
                    ],
                },
            ],
        },
        markdown: `\
Visit [https://example.com](${exampleTruncatedUrl}) and [https://example.com](${exampleTruncatedUrl}#2) for more
`,
    },
    {
        name: "duplicated link marks with hash",
        content: {
            elements: [
                {
                    type: "Paragraph",
                    elements: [
                        {type: "Text", text: "Visit "},
                        {
                            type: "Text",
                            text: "https://example.com",
                            marks: [{type: "Link", url: exampleUrlWithHash}],
                        },
                        {type: "Text", text: " and "},
                        {
                            type: "Text",
                            text: "https://example.com",
                            marks: [{type: "Link", url: otherExampleUrlWithHash}],
                        },
                        {type: "Text", text: " for more"},
                    ],
                },
            ],
        },
        markdown: `\
Visit [https://example.com](${exampleTruncatedUrlWithHash}) and [https://example.com](${exampleTruncatedUrlWithHash}-2) for more
`,
    },
    {
        name: "code block with link marks",
        content: {
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
                                    marks: [{type: "Link", url: exampleUrl}],
                                },
                                {type: "Text", text: " for more"},
                            ],
                        },
                    ],
                },
            ],
        },
        markdown: `\
<pre>
<code class="language-html">
Visit <a href="${exampleTruncatedUrl}">https://example.com</a> for more
</code>
</pre>
`,
    },
    {
        name: "duplicated code block with link marks",
        content: {
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
                                    marks: [{type: "Link", url: exampleUrl}],
                                },
                                {type: "Text", text: " and "},
                                {
                                    type: "Text",
                                    text: "https://example.com",
                                    marks: [{type: "Link", url: otherExampleUrl}],
                                },
                                {type: "Text", text: " for more"},
                            ],
                        },
                    ],
                },
            ],
        },
        markdown: `\
<pre>
<code class="language-html">
Visit <a href="${exampleTruncatedUrl}">https://example.com</a> and <a href="${exampleTruncatedUrl}#2">https://example.com</a> for more
</code>
</pre>
`,
    },
    {
        name: "code block with link marks (link ends with HTML entity)",
        content: {
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
                                    marks: [{type: "Link", url: `${exampleUrl}&`}],
                                },
                                {type: "Text", text: " for more"},
                            ],
                        },
                    ],
                },
            ],
        },
        markdown: `\
<pre>
<code class="language-html">
Visit <a href="${exampleUrl.slice(0, 40) + "…" + exampleUrl.slice(-9)}&amp;">https://example.com</a> for more
</code>
</pre>
`,
    },
    {
        name: "code block with link marks (link starts with HTML entity)",
        content: {
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
                                    marks: [{type: "Link", url: `&${exampleUrl}`}],
                                },
                                {type: "Text", text: " for more"},
                            ],
                        },
                    ],
                },
            ],
        },
        markdown: `\
<pre>
<code class="language-html">
Visit <a href="&amp;${exampleUrl.slice(0, 39) + "…" + exampleUrl.slice(-10)}">https://example.com</a> for more
</code>
</pre>
`,
    },
    {
        name: "code block with link marks (link contains HTML entity)",
        content: {
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
                                    marks: [
                                        {
                                            type: "Link",
                                            url: `${exampleUrl}&https://alpine.inc`,
                                        },
                                    ],
                                },
                                {type: "Text", text: " for more"},
                            ],
                        },
                    ],
                },
            ],
        },
        markdown: `\
<pre>
<code class="language-html">
Visit <a href="${exampleUrl.slice(0, 40)}…alpine.inc">https://example.com</a> for more
</code>
</pre>
`,
    },
    {
        name: "code block with link marks (link contains multiple HTML entities)",
        content: {
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
                                    marks: [
                                        {
                                            type: "Link",
                                            url: `${exampleUrl}&&&https://alpine.inc`,
                                        },
                                    ],
                                },
                                {type: "Text", text: " for more"},
                            ],
                        },
                    ],
                },
            ],
        },
        markdown: `\
<pre>
<code class="language-html">
Visit <a href="${exampleUrl.slice(0, 40)}…alpine.inc">https://example.com</a> for more
</code>
</pre>
`,
    },
];

for (const {name, content: expectedContent, markdown: expectedMarkdown} of testCases) {
    // eslint-disable-next-line jest/valid-title
    describe(name, () => {
        test("prints to agent web markdown", async () => {
            const actualMarkdown = await printApiContentToAgentWebMarkdown(
                storage,
                expectedContent,
                {spaceId},
            );

            expect(actualMarkdown).toEqual(expectedMarkdown);
        });
    });
}
