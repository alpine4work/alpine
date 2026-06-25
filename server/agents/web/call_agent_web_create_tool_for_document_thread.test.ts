import {ApiClientMock} from "~/server/agents/api/test_helpers/api_client_mock.js";
import {createApiAccountMock} from "~/server/agents/api/test_helpers/create_api_account_mock.js";
import type {AgentWebContext} from "~/server/agents/web/agent_web_context.js";
import {callAgentWebCreateTool} from "~/server/agents/web/call_agent_web_create_tool.js";
import {callAgentWebReadTool} from "~/server/agents/web/call_agent_web_read_tool.js";
import {createAgentWebPageStoredLinkPathname} from "~/server/agents/web/create_agent_web_page_stored_link_pathname.js";
import {createAgentWebSessionStorageForTest} from "~/server/agents/web/test_helpers/create_agent_web_session_storage_for_test.js";
import {addKeysToApiContentForTest} from "~/shared/api/markdown/test_helpers/add_keys_to_api_content_for_test.js";
import {intoApiAccountReference} from "~/shared/api/specification/into_api_account_reference.js";
import type {ApiContentResponse} from "~/shared/api/specification/types/api_specification_convenience_types.js";
import {
    ErrorBase,
    InternalError,
    InvalidArgumentError,
    UnimplementedError,
} from "~/shared/error/error.js";
import type {ErrorDisplayMessage} from "~/shared/error/types/error_display_message_type.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {captureResultPromise} from "~/shared/helpers/control/capture_result_promise.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {defaultTimeZone} from "~/shared/helpers/intl/time_zone.js";
import {generateId} from "~/shared/id/id.js";
import type {AccountId, BotId, DocumentId, SpaceId} from "~/shared/id/types/id_types.js";
import {testTracer} from "~/shared/tracer/dev/test_tracer.js";

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
        type: "Account",
        id: botAccountId,
        title: "ChatGPT",
        shortName: "ChatGPT",
        bot: {id: botId},
        pathname: "/bot/chatgpt",
    },
};

beforeEach(async () => {
    await storage.deleteAll();

    const actualBotAccountPathname = await createAgentWebPageStoredLinkPathname(
        storage,
        context.botAccount,
    );
    assert(actualBotAccountPathname === context.botAccount.pathname);

    const actualAlicePathname = await createAgentWebPageStoredLinkPathname(
        storage,
        intoApiAccountReference(aliceAccount),
    );
    assert(actualAlicePathname === "/human/alice");
});

afterEach(() => {
    import.meta.jest.useRealTimers();
});

function createDocumentContentFromMarkdown(markdown: string): ApiContentResponse {
    return addKeysToApiContentForTest({
        elements: markdown.split("\n\n").map(paragraphText => {
            position += paragraphText.length + 2;

            return {
                type: "Paragraph",
                elements: [{type: "Text", text: paragraphText}],
            };
        }),
    });
}

function printDisplayMessage(displayMessage: ErrorDisplayMessage): string {
    let string = "";

    for (const segment of displayMessage) {
        switch (segment.type) {
            case "Text":
            case "SensitiveText":
                string += segment.text;
                break;
            case "Link":
                string += segment.text;
                break;
            default:
                throw exhaustive(segment);
        }
    }

    return string;
}

function getDisplayMessage(error: unknown): ErrorDisplayMessage {
    if (error instanceof ErrorBase && error.displayMessage) {
        return error.displayMessage;
    }

    if (error instanceof AggregateError) {
        for (const childError of error.errors) {
            if (childError instanceof ErrorBase && childError.displayMessage) {
                return childError.displayMessage;
            }
        }
    }

    throw error;
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
    ).resolves.toEqual(`Create was successful. New document: [${title}](${path}).\n`);

    api.mockGetDocument(spaceId, documentId, {title, content});

    await expect(callAgentWebReadTool(context, {path, limit: "10kb"})).resolves.toContain(
        bodyMarkdown.split("\n")[0] ?? "",
    );

    return {documentId, path};
}

async function expectInvalidCreateDisplayMessage({
    content,
    expected,
}: {
    content: string;
    expected: string;
}) {
    const result = await captureResultPromise(
        async () => await callAgentWebCreateTool(context, {type: "document-thread", content}),
    );

    if (result.ok) {
        throw new InternalError("Expected create tool call to throw");
    }

    expect(printDisplayMessage(getDisplayMessage(result.error))).toEqual(expected);
    expect(result.error).toBeInstanceOf(InvalidArgumentError);
}

test("rejects creating a document thread for a document path that was not read", async () => {
    await createAndReadDocument({bodyMarkdown: "Quoted launch requirement."});

    await expectInvalidCreateDisplayMessage({
        content: `\
Document comment thread on [Launch Spec](/document/launch-spec?not-read=1).

<blockquote>

Quoted launch requirement.

</blockquote>

<comment>

Please clarify this requirement.

</comment>`,
        expected:
            "Can\u2019t create a document comment thread for a document that hasn\u2019t been read recently. Call the `read` tool with the path `/document/launch-spec?not-read=1` then call the `create` tool again.",
    });
});

test("rejects creating a document thread for an expired document read", async () => {
    import.meta.jest.useFakeTimers();

    const t0 = new Date("2026-01-01T00:00:00.000Z");
    import.meta.jest.setSystemTime(t0);

    await createAndReadDocument({bodyMarkdown: "Quoted launch requirement."});

    import.meta.jest.setSystemTime(new Date(t0.getTime() + 61 * 60 * 1000));

    await expectInvalidCreateDisplayMessage({
        content: `\
Document comment thread on [Launch Spec](/document/launch-spec).

<blockquote>

Quoted launch requirement.

</blockquote>

<comment>

Please clarify this requirement.

</comment>`,
        expected:
            "Can\u2019t create a document comment thread for a document that hasn\u2019t been read recently. Call the `read` tool with the path `/document/launch-spec` then call the `create` tool again.",
    });
});

test("rejects creating a document thread without a blockquote", async () => {
    await createAndReadDocument({bodyMarkdown: "Quoted launch requirement."});

    await expectInvalidCreateDisplayMessage({
        content: `\
Document comment thread on [Launch Spec](/document/launch-spec).

<comment>

Please clarify this requirement.

</comment>`,
        expected:
            "A `<blockquote>` is required when creating a document comment thread. You must add a `<blockquote>` containing the exact document content you\u2019re commenting after the `Document comment thread on [My Document](/document/my-document).` line at the start of the markdown. Try again and add a `<blockquote>`.",
    });
});

test("rejects creating a comments-only document thread with unresolved state", async () => {
    await createAndReadDocument({bodyMarkdown: "Quoted launch requirement."});

    await expectInvalidCreateDisplayMessage({
        content: `\
Document comment thread on [Launch Spec](/document/launch-spec).

- [ ] Unresolved

<comment>

Please clarify this requirement.

</comment>`,
        expected:
            "`- [ ] Unresolved` can only be included on the first page of a document comment thread, right before a `<blockquote>`. Try again and remove `- [ ] Unresolved`.",
    });
});

test("rejects creating a comments-only document thread with resolved state", async () => {
    await createAndReadDocument({bodyMarkdown: "Quoted launch requirement."});

    await expectInvalidCreateDisplayMessage({
        content: `\
Document comment thread on [Launch Spec](/document/launch-spec).

- [x] Resolved

<comment>

Please clarify this requirement.

</comment>`,
        expected:
            "`- [x] Resolved` can only be included on the first page of a document comment thread, right before a `<blockquote>`. Try again and remove `- [x] Resolved`.",
    });
});

test.each(["- [x] Resolved", "- [x] Unresolved"])(
    "rejects creating a resolved document thread with %s",
    async resolvedState => {
        await createAndReadDocument({bodyMarkdown: "Quoted launch requirement."});

        await expectInvalidCreateDisplayMessage({
            content: `\
Document comment thread on [Launch Spec](/document/launch-spec).

${resolvedState}

<blockquote>

Quoted launch requirement.

</blockquote>

<comment>

Please clarify this requirement.

</comment>`,
            expected:
                "You can\u2019t create a document comment thread as resolved. New document comment threads must start unresolved. Try again with `- [ ] Unresolved` or remove `- [x] Resolved` entirely.",
        });
    },
);

test("rejects creating a document thread with a next page link", async () => {
    await createAndReadDocument({bodyMarkdown: "Quoted launch requirement."});

    await expectInvalidCreateDisplayMessage({
        content: `\
Document comment thread on [Launch Spec](/document/launch-spec). [Next page \u00bb](/document/launch-spec/comments/1?after=blockquote)

<blockquote>

Quoted launch requirement.

</blockquote>

<comment>

Please clarify this requirement.

</comment>`,
        expected:
            "Can\u2019t add \u201cNext page \u00bb\u201d link when creating comments markdown. Try again without the \u201cNext page \u00bb\u201d link.",
    });
});

test("rejects creating a document thread with only a blockquote", async () => {
    await createAndReadDocument({bodyMarkdown: "Quoted launch requirement."});

    await expectInvalidCreateDisplayMessage({
        content: `\
Document comment thread on [Launch Spec](/document/launch-spec).

<blockquote>

Quoted launch requirement.

</blockquote>`,
        expected:
            "When creating a document comment thread you must include at least one `<comment>` to start the thread. Try again and add a `<comment>` after your `<blockquote>`.",
    });
});

test("rejects creating a document thread with a time marker before the first comment", async () => {
    await createAndReadDocument({bodyMarkdown: "Quoted launch requirement."});

    await expectInvalidCreateDisplayMessage({
        content: `\
Document comment thread on [Launch Spec](/document/launch-spec).

<blockquote>

Quoted launch requirement.

</blockquote>

<time>May 14th at 11:00am EDT</time>`,
        expected:
            "Unexpected `<time>`, you can only add `<comment>`s. The creation time of comments will be decided by the server. Try again and remove the new `<time>`.",
    });
});

test("rejects quoted content that is not in the document", async () => {
    await createAndReadDocument({bodyMarkdown: "Existing launch requirement."});

    await expectInvalidCreateDisplayMessage({
        content: `\
Document comment thread on [Launch Spec](/document/launch-spec).

<blockquote>

Missing launch requirement.

</blockquote>

<comment>

Please clarify this requirement.

</comment>`,
        expected:
            "Couldn\u2019t find the quoted content in `<blockquote>` in `/document/launch-spec`. " +
            "To create a document comment thread you must exactly recreate the content you\u2019re commenting on in `<blockquote>` so we can find the corresponding range in the document. " +
            "Formatting is flexible when matching content so `**needle**` will match `**foo needle bar**` and `- needle` will match `- foo needle bar` because `**needle**` and `- needle` correctly match the word \u201cneedle\u201d and have the right formatting. " +
            "Simply `needle` without formatting will also match `**foo needle bar**` and `- foo needle bar` however `_needle_` will match neither because it has incorrect formatting. " +
            "Your content in `<blockquote>` must be valid markdown so `**foo needle` won\u2019t match `**foo needle bar**` because the formatting (`**`) is unterminated, either `**foo needle**` or `foo needle` (without formatting) will match. " +
            "Try again but make sure to exactly copy the content you want to comment in `/document/launch-spec` into a `<blockquote>`.",
    });
});

test("rejects quoted content that matches the document more than once", async () => {
    await createAndReadDocument({
        bodyMarkdown: `\
Repeated launch requirement.

Repeated launch requirement.`,
    });

    await expectInvalidCreateDisplayMessage({
        content: `\
Document comment thread on [Launch Spec](/document/launch-spec).

<blockquote>

Repeated launch requirement.

</blockquote>

<comment>

Please clarify this requirement.

</comment>`,
        expected:
            "2 matches were found for the quoted content in `<blockquote>` in `/document/launch-spec`. Try again but provide more surrounding context to make your match unique.",
    });
});

test("rejects a second blockquote after the first comment", async () => {
    await createAndReadDocument({bodyMarkdown: "Quoted launch requirement."});

    await expectInvalidCreateDisplayMessage({
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
        expected:
            "There must be only one `<blockquote>` and it must be placed immediately after the first line which states what document the thread is on (e.g. `Document thread on [My Document](/document/my-document).`). Try again with one `<blockquote>` at the start of the markdown.",
    });
});

test("rejects a time marker after the first comment before creating the thread", async () => {
    await createAndReadDocument({bodyMarkdown: "Quoted launch requirement."});

    await expectInvalidCreateDisplayMessage({
        content: `\
Document comment thread on [Launch Spec](/document/launch-spec).

<blockquote>

Quoted launch requirement.

</blockquote>

<comment>

Please clarify this requirement.

</comment>

<time>May 14th at 11:05am EDT</time>`,
        expected:
            "Unexpected `<time>`, you can only add `<comment>`s. The creation time of comments will be decided by the server. Try again and remove the new `<time>`.",
    });
});

test("rejects an additional comment from another account before creating the thread", async () => {
    await createAndReadDocument({bodyMarkdown: "Quoted launch requirement."});

    await expectInvalidCreateDisplayMessage({
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
        expected:
            'You can only add a `<comment>` from yourself. Try again with a `from` attribute that references yourself (`from="[ChatGPT](/bot/chatgpt)"`).',
    });
});

test("rejects an additional comment with an incorrect id before creating the thread", async () => {
    await createAndReadDocument({bodyMarkdown: "Quoted launch requirement."});

    await expectInvalidCreateDisplayMessage({
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
        expected:
            'Invalid `id` attribute for new `<comment>`. The `<comment>` `id` attribute is an integer sequence so the next valid `id` is `1`. Try again with `id="1"`.',
    });
});

test("rejects an additional comment with a time attribute before creating the thread", async () => {
    await createAndReadDocument({bodyMarkdown: "Quoted launch requirement."});

    await expectInvalidCreateDisplayMessage({
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
        expected:
            "You can\u2019t add a `<comment>` with a `time` attribute. The creation time of the comment will be decided by the server. Try again without the `time` attribute.",
    });
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
    ).rejects.toThrow(UnimplementedError);
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
    ).rejects.toThrow(UnimplementedError);
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
    ).rejects.toThrow(UnimplementedError);
});
