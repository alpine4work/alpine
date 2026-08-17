import {ApiClientMock} from "~/server/agents/api/test_helpers/api_client_mock.js";
import {createApiAccountMock} from "~/server/agents/api/test_helpers/create_api_account_mock.js";
import {mockApiGetDocument} from "~/server/agents/api/test_helpers/mock_api_get_document.js";
import type {AgentWebContext} from "~/server/agents/web/agent_web_context.open_source.js";
import {callAgentWebCreateTool as actuallyCallAgentWebCreateTool} from "~/server/agents/web/call_agent_web_create_tool.open_source.js";
import {callAgentWebReadTool as actuallyCallAgentWebReadTool} from "~/server/agents/web/call_agent_web_read_tool.open_source.js";
import {createAgentWebSessionStorageForTest} from "~/server/agents/web/test_helpers/create_agent_web_session_storage_for_test.js";
import {storeAgentWebPageLinkForTest} from "~/server/agents/web/test_helpers/store_agent_web_page_link_for_test.js";
import {addKeysToApiContentForTest} from "~/shared/api/content/test_helpers/add_keys_to_api_content_for_test.js";
import type {ApiContentResponse} from "~/shared/api/specification/types/api_specification_convenience_types.open_source.js";
import {assert} from "~/shared/helpers/control/assert.open_source.js";
import {defaultTimeZone} from "~/shared/helpers/intl/time_zone.open_source.js";
import {generateId} from "~/shared/id/id.open_source.js";
import type {
    AccountId,
    BotId,
    DocumentId,
    SpaceId,
} from "~/shared/id/types/id_types.open_source.js";
import {testTracer} from "~/shared/tracer/dev/test_tracer.js";

async function callAgentWebCreateTool(
    ...callArguments: Parameters<typeof actuallyCallAgentWebCreateTool>
): Promise<string> {
    return (await actuallyCallAgentWebCreateTool(...callArguments)).response;
}

async function callAgentWebReadTool(
    ...callArguments: Parameters<typeof actuallyCallAgentWebReadTool>
): Promise<string> {
    const result = await actuallyCallAgentWebReadTool(...callArguments);
    assert(result.response.type === "String");
    return result.response.string;
}

const {span} = testTracer.startSpan("call_agent_web_create_tool_for_document_thread.test.ts");
const api = new ApiClientMock();
const spaceId = generateId<SpaceId>();
const storage = createAgentWebSessionStorageForTest(spaceId);

const botAccountId = generateId<AccountId>();
const botId = generateId<BotId>();
const aliceAccount = createApiAccountMock({name: "Alice"});

const context: AgentWebContext = {
    spaceId,
    api,
    storage,
    span,
    timeZone: defaultTimeZone,
    botAccount: {
        id: botAccountId,
        bot: {id: botId},
    },
};

function mockAgentWebBotAccountReferenceForTest(
    api: ApiClientMock,
    botAccount: AgentWebContext["botAccount"],
): void {
    api.mockGet("/accounts/{id}-reference", {
        params: {path: {id: botAccount.id}},
        data: {
            reference: {
                type: "Account",
                id: botAccount.id,
                title: "ChatGPT",
                shortName: "ChatGPT",
                bot: botAccount.bot,
            },
        },
    });
}

beforeEach(async () => {
    await storage.deleteAll();

    const actualBotAccountPathname = await storeAgentWebPageLinkForTest(storage, {
        type: "Account",
        id: context.botAccount.id,
        title: "ChatGPT",
        shortName: "ChatGPT",
        bot: context.botAccount.bot,
    });
    assert(actualBotAccountPathname === "/bot/chatgpt");

    const actualAlicePathname = await storeAgentWebPageLinkForTest(storage, aliceAccount);
    assert(actualAlicePathname === "/human/alice");
});

afterEach(() => {
    import.meta.jest.useRealTimers();
});

function createDocumentContentFromMarkdown(markdown: string): ApiContentResponse {
    return addKeysToApiContentForTest({
        elements: markdown.split("\n\n").map(paragraphText => {
            return {
                type: "Paragraph",
                elements: [{type: "Text", text: paragraphText}],
            };
        }),
    });
}

function mockCreateDocument({
    id = generateId<DocumentId>(),
    title,
    content,
    version = 1,
}: {
    id?: DocumentId;
    title: string;
    content: ApiContentResponse;
    version?: number;
}): DocumentId {
    api.mockPost("/documents", {
        params: "Any",
        data: {
            spaceId,
            document: {
                id,
                title,
                content,
                version,
            },
        },
    });

    return id;
}

async function createAndReadDocument({
    title = "Launch Spec",
    path = "/document/launch-spec",
    bodyMarkdown,
}: {
    title?: string;
    path?: string;
    bodyMarkdown: string;
}): Promise<{documentId: DocumentId; path: string}> {
    const content = createDocumentContentFromMarkdown(bodyMarkdown);
    const documentId = mockCreateDocument({title, content});

    await expect(
        callAgentWebCreateTool(context, {
            type: "document",
            content: `\
# ${title}

${bodyMarkdown}`,
        }),
    ).resolves.toEqual(`Create was successful. New document: [${title}](${path}).`);

    mockApiGetDocument(api, {spaceId, documentId, version: 1, title, content});

    await expect(callAgentWebReadTool(context, {path, limit: "10kb"})).resolves.toContain(
        bodyMarkdown.split("\n")[0] ?? "",
    );

    return {documentId, path};
}

test("rejects creating a document thread for a document path that was not read", async () => {
    await createAndReadDocument({bodyMarkdown: "Quoted launch requirement."});

    await expect(
        callAgentWebCreateTool(context, {
            type: "document-thread",
            content: `\
Document comment thread on [Launch Spec](/document/launch-spec?not-read=1).

<blockquote>

Quoted launch requirement.

</blockquote>

<comment>

Please clarify this requirement.

</comment>`,
        }),
    ).resolves.toEqual(
        "Error: Couldn\u2019t create document comment thread. " +
            "Can\u2019t create a document comment thread for a document that hasn\u2019t been read recently. Call the `read` tool with the path `/document/launch-spec?not-read=1` then call the `create` tool again.",
    );
});

test("rejects creating a document thread for an expired document read", async () => {
    import.meta.jest.useFakeTimers();

    const t0 = new Date("2026-01-01T00:00:00.000Z");
    import.meta.jest.setSystemTime(t0);

    await createAndReadDocument({bodyMarkdown: "Quoted launch requirement."});

    import.meta.jest.setSystemTime(new Date(t0.getTime() + 61 * 60 * 1000));

    await expect(
        callAgentWebCreateTool(context, {
            type: "document-thread",
            content: `\
Document comment thread on [Launch Spec](/document/launch-spec).

<blockquote>

Quoted launch requirement.

</blockquote>

<comment>

Please clarify this requirement.

</comment>`,
        }),
    ).resolves.toEqual(
        "Error: Couldn\u2019t create document comment thread. " +
            "Can\u2019t create a document comment thread for a document that hasn\u2019t been read recently. Call the `read` tool with the path `/document/launch-spec` then call the `create` tool again.",
    );
});

test("rejects creating a document thread without a blockquote", async () => {
    await createAndReadDocument({bodyMarkdown: "Quoted launch requirement."});

    await expect(
        callAgentWebCreateTool(context, {
            type: "document-thread",
            content: `\
Document comment thread on [Launch Spec](/document/launch-spec).

<comment>

Please clarify this requirement.

</comment>`,
        }),
    ).resolves.toEqual(
        "Error: Couldn\u2019t create document comment thread. " +
            "A `<blockquote>` is required when creating a document comment thread. You must add a `<blockquote>` containing the exact document content you\u2019re commenting after the `Document comment thread on [My Document](/document/my-document).` line at the start of the markdown. Try again and add a `<blockquote>`.",
    );
});

test("rejects creating a comments-only document thread with unresolved state", async () => {
    await createAndReadDocument({bodyMarkdown: "Quoted launch requirement."});

    await expect(
        callAgentWebCreateTool(context, {
            type: "document-thread",
            content: `\
Document comment thread on [Launch Spec](/document/launch-spec).

- [ ] Unresolved

<comment>

Please clarify this requirement.

</comment>`,
        }),
    ).resolves.toEqual(
        "Error: Couldn\u2019t create document comment thread. " +
            "`- [ ] Unresolved` can only be included on the first page of a document comment thread, right before a `<blockquote>`. Try again and remove `- [ ] Unresolved`.",
    );
});

test("rejects creating a comments-only document thread with resolved state", async () => {
    await createAndReadDocument({bodyMarkdown: "Quoted launch requirement."});

    await expect(
        callAgentWebCreateTool(context, {
            type: "document-thread",
            content: `\
Document comment thread on [Launch Spec](/document/launch-spec).

- [x] Resolved

<comment>

Please clarify this requirement.

</comment>`,
        }),
    ).resolves.toEqual(
        "Error: Couldn\u2019t create document comment thread. " +
            "`- [x] Resolved` can only be included on the first page of a document comment thread, right before a `<blockquote>`. Try again and remove `- [x] Resolved`.",
    );
});

test.each(["- [x] Resolved", "- [x] Unresolved"])(
    "rejects creating a resolved document thread with %s",
    async resolvedState => {
        await createAndReadDocument({bodyMarkdown: "Quoted launch requirement."});

        await expect(
            callAgentWebCreateTool(context, {
                type: "document-thread",
                content: `\
Document comment thread on [Launch Spec](/document/launch-spec).

${resolvedState}

<blockquote>

Quoted launch requirement.

</blockquote>

<comment>

Please clarify this requirement.

</comment>`,
            }),
        ).resolves.toEqual(
            "Error: Couldn\u2019t create document comment thread. " +
                "You can\u2019t create a document comment thread as resolved. New document comment threads must start unresolved. Try again with `- [ ] Unresolved` or remove `- [x] Resolved` entirely.",
        );
    },
);

test("rejects creating a document thread with a next page link", async () => {
    await createAndReadDocument({bodyMarkdown: "Quoted launch requirement."});

    await expect(
        callAgentWebCreateTool(context, {
            type: "document-thread",
            content: `\
Document comment thread on [Launch Spec](/document/launch-spec). [Next page \u00bb](/document/launch-spec/comments/1?after=blockquote)

<blockquote>

Quoted launch requirement.

</blockquote>

<comment>

Please clarify this requirement.

</comment>`,
        }),
    ).resolves.toEqual(
        "Error: Couldn\u2019t create document comment thread. " +
            "Can\u2019t add \u201cNext page \u00bb\u201d link when creating comments markdown. Try again without the \u201cNext page \u00bb\u201d link.",
    );
});

test("rejects creating a document thread with only a blockquote", async () => {
    await createAndReadDocument({bodyMarkdown: "Quoted launch requirement."});

    await expect(
        callAgentWebCreateTool(context, {
            type: "document-thread",
            content: `\
Document comment thread on [Launch Spec](/document/launch-spec).

<blockquote>

Quoted launch requirement.

</blockquote>`,
        }),
    ).resolves.toEqual(
        "Error: Couldn\u2019t create document comment thread. " +
            "When creating a document comment thread you must include at least one `<comment>` to start the thread. Try again and add a `<comment>` after your `<blockquote>`.",
    );
});

test("rejects creating a document thread with a time marker before the first comment", async () => {
    await createAndReadDocument({bodyMarkdown: "Quoted launch requirement."});

    await expect(
        callAgentWebCreateTool(context, {
            type: "document-thread",
            content: `\
Document comment thread on [Launch Spec](/document/launch-spec).

<blockquote>

Quoted launch requirement.

</blockquote>

<time>May 14th at 11:00am EDT</time>`,
        }),
    ).resolves.toEqual(
        "Error: Couldn\u2019t create document comment thread. " +
            "Unexpected `<time>`, you can only add `<comment>`s. The creation time of comments will be decided by the server. Try again and remove the new `<time>`.",
    );
});

test("rejects quoted content that is not in the document", async () => {
    await createAndReadDocument({bodyMarkdown: "Existing launch requirement."});

    await expect(
        callAgentWebCreateTool(context, {
            type: "document-thread",
            content: `\
Document comment thread on [Launch Spec](/document/launch-spec).

<blockquote>

Missing launch requirement.

</blockquote>

<comment>

Please clarify this requirement.

</comment>`,
        }),
    ).resolves.toEqual(
        "Error: Couldn\u2019t create document comment thread. " +
            ("Couldn\u2019t find the quoted content in `<blockquote>` in `/document/launch-spec`. " +
                "To create a document comment thread you must exactly recreate the content you\u2019re commenting on in `<blockquote>` so we can find the corresponding range in the document. " +
                "Formatting is flexible when matching content so `**needle**` will match `**foo needle bar**` and `- needle` will match `- foo needle bar` because `**needle**` and `- needle` correctly match the word \u201cneedle\u201d and have the right formatting. " +
                "Simply `needle` without formatting will also match `**foo needle bar**` and `- foo needle bar` however `_needle_` will match neither because it has incorrect formatting. " +
                "Your content in `<blockquote>` must be valid markdown so `**foo needle` won\u2019t match `**foo needle bar**` because the formatting (`**`) is unterminated, either `**foo needle**` or `foo needle` (without formatting) will match. " +
                "For a complete reference on how to quote content, call the `read` tool with `/skill/content-quoting`. " +
                "Try again but make sure to exactly copy the content you want to comment in `/document/launch-spec` into a `<blockquote>`."),
    );
});

test("rejects quoted content that matches the document more than once", async () => {
    await createAndReadDocument({
        bodyMarkdown: `\
Repeated launch requirement.

Repeated launch requirement.`,
    });

    await expect(
        callAgentWebCreateTool(context, {
            type: "document-thread",
            content: `\
Document comment thread on [Launch Spec](/document/launch-spec).

<blockquote>

Repeated launch requirement.

</blockquote>

<comment>

Please clarify this requirement.

</comment>`,
        }),
    ).resolves.toEqual(
        "Error: Couldn\u2019t create document comment thread. " +
            '2 matches were found for the quoted content in `<blockquote>` in `/document/launch-spec`. Try again but provide more surrounding context to make your match unique or add a 1-indexed `match` attribute to `<blockquote>` to choose which match to use (e.g. `<blockquote match="2">` uses the second match).',
    );
});

test("rejects creating a document thread with a non-integer quote match", async () => {
    await createAndReadDocument({bodyMarkdown: "Quoted launch requirement."});

    await expect(
        callAgentWebCreateTool(context, {
            type: "document-thread",
            content: `\
Document comment thread on [Launch Spec](/document/launch-spec).

<blockquote match="second">

Quoted launch requirement.

</blockquote>

<comment>

Please clarify this requirement.

</comment>`,
        }),
    ).resolves.toEqual(
        "Error: Couldn\u2019t create document comment thread. " +
            'Invalid `<blockquote>` `match` attribute on line 3. Try again with a 1-indexed integer like `match="2"`.',
    );
});

test("rejects creating a document thread with an out-of-bounds quote match for one match", async () => {
    await createAndReadDocument({bodyMarkdown: "Quoted launch requirement."});

    await expect(
        callAgentWebCreateTool(context, {
            type: "document-thread",
            content: `\
Document comment thread on [Launch Spec](/document/launch-spec).

<blockquote match="2">

Quoted launch requirement.

</blockquote>

<comment>

Please clarify this requirement.

</comment>`,
        }),
    ).resolves.toEqual(
        "Error: Couldn\u2019t create document comment thread. " +
            'The `<blockquote>` `match` attribute must be 1 or it can be omitted since there\u2019s only one match, instead it was `match="2"`. Try again but omit the `match` attribute.',
    );
});

test("uses quote match to choose between repeated document content", async () => {
    await createAndReadDocument({
        bodyMarkdown: `\
Repeated launch requirement.

Repeated launch requirement.`,
    });

    await expect(
        callAgentWebCreateTool(context, {
            type: "document-thread",
            content: `\
Document comment thread on [Launch Spec](/document/launch-spec).

<blockquote match="2">

Repeated launch requirement.

</blockquote>

<comment>

Please clarify this requirement.

</comment>`,
        }),
    ).resolves.toEqual(`\
Error: Couldn\u2019t create document comment thread. An unexpected error occurred, please try again. If the problem continues, let us know at support@alpine.inc

> Internal error: Document comment thread creation API endpoint hasn\u2019t been implemented yet`);
});

test("rejects creating a document thread with a deleted quote match", async () => {
    await createAndReadDocument({bodyMarkdown: "Quoted launch requirement."});

    await expect(
        callAgentWebCreateTool(context, {
            type: "document-thread",
            content: `\
Document comment thread on [Launch Spec](/document/launch-spec).

<blockquote match="deleted">

Quoted launch requirement.

</blockquote>

<comment>

Please clarify this requirement.

</comment>`,
        }),
    ).resolves.toEqual(
        "Error: Couldn\u2019t create document comment thread. " +
            'You can\u2019t use `match="deleted"` when creating a document comment thread. `match="deleted"` is only used when reading an unresolved document comment thread whose commented content has been removed from the document. Try again with a 1-indexed integer `match` attribute or omit the `match` attribute.',
    );
});

test("rejects quote match zero as out of bounds for multiple matches", async () => {
    await createAndReadDocument({
        bodyMarkdown: `\
Repeated launch requirement.

Repeated launch requirement.`,
    });

    await expect(
        callAgentWebCreateTool(context, {
            type: "document-thread",
            content: `\
Document comment thread on [Launch Spec](/document/launch-spec).

<blockquote match="0">

Repeated launch requirement.

</blockquote>

<comment>

Please clarify this requirement.

</comment>`,
        }),
    ).resolves.toEqual(
        "Error: Couldn\u2019t create document comment thread. " +
            'The `<blockquote>` `match` attribute must be between 1 and 2, instead it was `match="0"`. Try again with a valid 1-indexed `match` attribute.',
    );
});

test("rejects a second blockquote after the first comment", async () => {
    await createAndReadDocument({bodyMarkdown: "Quoted launch requirement."});

    await expect(
        callAgentWebCreateTool(context, {
            type: "document-thread",
            content: `\
Document comment thread on [Launch Spec](/document/launch-spec).

<blockquote>

Quoted launch requirement.

</blockquote>

<comment>

Please clarify this requirement.

</comment>

<blockquote>

Quoted launch requirement.

</blockquote>`,
        }),
    ).resolves.toEqual(
        "Error: Couldn\u2019t create document comment thread. " +
            "There must be only one `<blockquote>` and it must be placed immediately after the first line which states what document the thread is on (e.g. `Document thread on [My Document](/document/my-document).`). Try again with one `<blockquote>` at the start of the markdown.",
    );
});

test("rejects a time marker after the first comment before creating the thread", async () => {
    await createAndReadDocument({bodyMarkdown: "Quoted launch requirement."});

    await expect(
        callAgentWebCreateTool(context, {
            type: "document-thread",
            content: `\
Document comment thread on [Launch Spec](/document/launch-spec).

<blockquote>

Quoted launch requirement.

</blockquote>

<comment>

Please clarify this requirement.

</comment>

<time>May 14th at 11:05am EDT</time>`,
        }),
    ).resolves.toEqual(
        "Error: Couldn\u2019t create document comment thread. " +
            "Unexpected `<time>`, you can only add `<comment>`s. The creation time of comments will be decided by the server. Try again and remove the new `<time>`.",
    );
});

test("rejects an additional comment from another account before creating the thread", async () => {
    await createAndReadDocument({bodyMarkdown: "Quoted launch requirement."});
    mockAgentWebBotAccountReferenceForTest(api, context.botAccount);

    await expect(
        callAgentWebCreateTool(context, {
            type: "document-thread",
            content: `\
Document comment thread on [Launch Spec](/document/launch-spec).

<blockquote>

Quoted launch requirement.

</blockquote>

<comment>

Please clarify this requirement.

</comment>

<comment from="[Alice](/human/alice)">

Not from the bot.

</comment>`,
        }),
    ).resolves.toEqual(
        "Error: Couldn\u2019t create document comment thread. " +
            'You can only add a `<comment>` from yourself. Try again with a `from` attribute that references yourself (`from="[ChatGPT](/bot/chatgpt)"`).',
    );
});

test("rejects an additional comment with an incorrect id before creating the thread", async () => {
    await createAndReadDocument({bodyMarkdown: "Quoted launch requirement."});

    await expect(
        callAgentWebCreateTool(context, {
            type: "document-thread",
            content: `\
Document comment thread on [Launch Spec](/document/launch-spec).

<blockquote>

Quoted launch requirement.

</blockquote>

<comment>

Please clarify this requirement.

</comment>

<comment id="3">

Wrong id.

</comment>`,
        }),
    ).resolves.toEqual(
        "Error: Couldn\u2019t create document comment thread. " +
            'Invalid `id` attribute for new `<comment>`. The `<comment>` `id` attribute is an integer sequence so the next valid `id` is 1. Try again with `id="1"`.',
    );
});

test("rejects an additional comment with a time attribute before creating the thread", async () => {
    await createAndReadDocument({bodyMarkdown: "Quoted launch requirement."});

    await expect(
        callAgentWebCreateTool(context, {
            type: "document-thread",
            content: `\
Document comment thread on [Launch Spec](/document/launch-spec).

<blockquote>

Quoted launch requirement.

</blockquote>

<comment>

Please clarify this requirement.

</comment>

<comment time="3 minutes later">

Server should choose the comment time.

</comment>`,
        }),
    ).resolves.toEqual(
        "Error: Couldn\u2019t create document comment thread. " +
            "You can\u2019t add a `<comment>` with a `time` attribute. The creation time of the comment will be decided by the server. Try again without the `time` attribute.",
    );
});

test("throws UnimplementedError after a valid document thread create reaches creation", async () => {
    await createAndReadDocument({bodyMarkdown: "Quoted launch requirement."});

    await expect(
        callAgentWebCreateTool(context, {
            type: "document-thread",
            content: `\
Document comment thread on [Launch Spec](/document/launch-spec).

<blockquote>

Quoted launch requirement.

</blockquote>

<comment>

Please clarify this requirement.

</comment>`,
        }),
    ).resolves.toEqual(`\
Error: Couldn\u2019t create document comment thread. An unexpected error occurred, please try again. If the problem continues, let us know at support@alpine.inc

> Internal error: Document comment thread creation API endpoint hasn\u2019t been implemented yet`);
});

test("throws UnimplementedError after a valid document thread create with explicit unresolved state reaches creation", async () => {
    await createAndReadDocument({bodyMarkdown: "Quoted launch requirement."});

    await expect(
        callAgentWebCreateTool(context, {
            type: "document-thread",
            content: `\
Document comment thread on [Launch Spec](/document/launch-spec).

- [ ] Unresolved

<blockquote>

Quoted launch requirement.

</blockquote>

<comment>

Please clarify this requirement.

</comment>`,
        }),
    ).resolves.toEqual(`\
Error: Couldn\u2019t create document comment thread. An unexpected error occurred, please try again. If the problem continues, let us know at support@alpine.inc

> Internal error: Document comment thread creation API endpoint hasn\u2019t been implemented yet`);
});

test.each([
    [
        "Document comment thread without period",
        "Document comment thread on [Launch Spec](/document/launch-spec)",
    ],
    [
        "Document comments thread",
        "Document comments thread on [Launch Spec](/document/launch-spec).",
    ],
    ["Document thread", "Document thread on [Launch Spec](/document/launch-spec)."],
    ["Comment thread", "Comment thread on [Launch Spec](/document/launch-spec)."],
    ["Comments thread", "Comments thread on [Launch Spec](/document/launch-spec)."],
    ["Thread", "Thread on [Launch Spec](/document/launch-spec)."],
])("accepts %s preamble variant", async (_name, preamble) => {
    await createAndReadDocument({bodyMarkdown: "Quoted launch requirement."});

    await expect(
        callAgentWebCreateTool(context, {
            type: "document-thread",
            content: `\
${preamble}

<blockquote>

Quoted launch requirement.

</blockquote>

<comment>

Please clarify this requirement.

</comment>`,
        }),
    ).resolves.toEqual(`\
Error: Couldn\u2019t create document comment thread. An unexpected error occurred, please try again. If the problem continues, let us know at support@alpine.inc

> Internal error: Document comment thread creation API endpoint hasn\u2019t been implemented yet`);
});
