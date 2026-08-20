// NOTE: We mostly use documents in this file to test general
// `callAgentWebReadTool()` behavior. For document-specific tests see
// `server/agents/web/call_agent_web_read_tool_document.test.ts`.

import {ApiClientMock} from "~/server/agents/api/test_helpers/api_client_mock.js";
import {mockApiGetDocument} from "~/server/agents/api/test_helpers/mock_api_get_document.js";
import {AgentWebContext} from "~/server/agents/web/agent_web_context.open_source.js";
import {printAgentWebPageStoredLinkKey} from "~/server/agents/web/agent_web_page_stored_link_key.open_source.js";
import {callAgentWebReadTool as actuallyCallAgentWebReadTool} from "~/server/agents/web/call_agent_web_read_tool.open_source.js";
import {createAgentWebSessionStorageForTest} from "~/server/agents/web/test_helpers/create_agent_web_session_storage_for_test.js";
import {parseApiContentFromMarkdown} from "~/shared/api/content/parse_api_content_from_markdown.open_source.js";
import {addKeysToApiContentForTest} from "~/shared/api/content/test_helpers/add_keys_to_api_content_for_test.js";
import {ApiContent} from "~/shared/api/specification/types/api_specification_convenience_types.open_source.js";
import {assert} from "~/shared/helpers/control/assert.open_source.js";
import {defaultTimeZone} from "~/shared/helpers/intl/time_zone.open_source.js";
import {generateId} from "~/shared/id/id.open_source.js";
import {AccountId, BotId, DocumentId, SpaceId} from "~/shared/id/types/id_types.open_source.js";
import {testTracer} from "~/shared/tracer/dev/test_tracer.js";

async function callAgentWebReadTool(
    ...callArguments: Parameters<typeof actuallyCallAgentWebReadTool>
): Promise<string> {
    const result = await actuallyCallAgentWebReadTool(...callArguments);
    assert(result.response.type === "String");
    return result.response.string;
}

const {span} = testTracer.startSpan("call_agent_web_read_tool.test.ts");
const api = new ApiClientMock();
const spaceId = generateId<SpaceId>();
const storage = createAgentWebSessionStorageForTest(spaceId);

const botAccountId = generateId<AccountId>();
const botId = generateId<BotId>();

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

function createDocumentContentFromParagraphs(paragraphTextList: ReadonlyArray<string>) {
    return parseApiContentFromMarkdown(paragraphTextList.join("\n\n")) as ApiContent;
}

function createDocumentContentWithDocumentMention(
    documentId: DocumentId,
    title: string,
): ApiContent {
    return addKeysToApiContentForTest({
        elements: [
            {
                type: "Paragraph",
                elements: [
                    {type: "Text", text: "See "},
                    {type: "Mention", reference: {type: "Document", id: documentId, title}},
                    {type: "Text", text: " for context."},
                ],
            },
        ],
    });
}

test("reads `/bot/me` as a link to the current bot", async () => {
    api.mockGet("/accounts/{id}-reference", {
        params: {path: {id: botAccountId}},
        data: {
            reference: {
                type: "Account",
                id: botAccountId,
                title: "My Bot",
                shortName: "My",
                bot: {id: botId},
            },
        },
    });

    expect(await callAgentWebReadTool(context, {path: "/bot/me", limit: "10kb"})).toEqual(
        "You are [My Bot](/bot/my-bot).",
    );
});

test("throws when the link path has not been seen", async () => {
    await expect(
        callAgentWebReadTool(context, {path: "/document/unknown", limit: "10kb"}),
    ).resolves.toEqual(
        "Error: Couldn\u2019t read `/document/unknown`. Nothing found for path `/document/unknown`. You may only read paths you\u2019ve already seen a link for. Please try calling the `read` tool again with a path you\u2019ve seen before. If you\u2019re trying to read something you don\u2019t have a link for then don\u2019t try making up a path. Instead try calling the `search` tool which will help you find what you need and will give you links which you can use with the `read` tool.",
    );
});

test.each([
    {
        baseUrl: "https://alpine.inc",
        title: "Production URL Spec",
        pathname: "/document/production-url-spec",
    },
    {
        baseUrl: "http://localhost:3000",
        title: "Local URL Spec",
        pathname: "/document/local-url-spec",
    },
])("resolves a $baseUrl URL to a readable path", async ({baseUrl, title, pathname}) => {
    const documentId = generateId<DocumentId>();

    api.mockGet("/documents/{id}-reference", {
        params: {path: {id: documentId}},
        data: {
            spaceId,
            reference: {type: "Document", id: documentId, title},
        },
    });

    await expect(
        callAgentWebReadTool(context, {
            path: `${baseUrl}/doc/${documentId}`,
            limit: "10kb",
        }),
    ).resolves.toEqual(`\
Found path for URL: \`${pathname}\`.

Call the \`read\` tool again with that path to see the document\u2019s content.`);
});

test("reads the main skill at `/skill` but not `/skill/SKILL`", async () => {
    const response = await callAgentWebReadTool(context, {path: "/skill", limit: "10kb"});

    expect(response).toEqual(
        expect.stringMatching(
            /^\[Alpine\]\(https:\/\/alpine\.inc\) is an all-in-one productivity suite[\s\S]*\[Accounts\]\(\/skill\/accounts\)/,
        ),
    );

    await expect(
        callAgentWebReadTool(context, {path: "/skill/SKILL", limit: "10kb"}),
    ).resolves.toEqual(
        "Error: Couldn\u2019t read `/skill/SKILL`. Nothing found for path `/skill/SKILL`. You may only read paths you\u2019ve already seen a link for. Please try calling the `read` tool again with a path you\u2019ve seen before. If you\u2019re trying to read something you don\u2019t have a link for then don\u2019t try making up a path. Instead try calling the `search` tool which will help you find what you need and will give you links which you can use with the `read` tool.",
    );
});

test("reads a known named skill but not an unknown named skill", async () => {
    const response = await callAgentWebReadTool(context, {
        path: "/skill/create",
        limit: "10kb",
    });

    expect(response).toEqual(
        expect.stringMatching(
            /^# What can you create in Alpine\?[\s\S]*\[`document`\]\(\/skill\/documents\)/,
        ),
    );

    await expect(
        callAgentWebReadTool(context, {path: "/skill/unknown", limit: "10kb"}),
    ).resolves.toEqual(
        "Error: Couldn\u2019t read `/skill/unknown`. Nothing found for path `/skill/unknown`. You may only read paths you\u2019ve already seen a link for. Please try calling the `read` tool again with a path you\u2019ve seen before. If you\u2019re trying to read something you don\u2019t have a link for then don\u2019t try making up a path. Instead try calling the `search` tool which will help you find what you need and will give you links which you can use with the `read` tool.",
    );
});

test("returns full markdown and stores normalized read response", async () => {
    const documentId = generateId<DocumentId>();

    await context.storage.pageStoredLinkByPathname.put("/document/engineering-spec", {
        type: "Document",
        id: documentId,
        title: "Engineering Spec",
    });

    mockApiGetDocument(api, {
        spaceId,
        documentId,
        version: 1,
        title: "Engineering Spec",
        content: createDocumentContentFromParagraphs([
            "Overview paragraph.",
            "Implementation details paragraph.",
        ]),
    });

    const responseString = await callAgentWebReadTool(context, {
        path: "document/engineering-spec?b=2&a=1#overview",
        limit: "10kb",
    });

    expect(responseString).toEqual(`\
# Engineering Spec

Overview paragraph.

Implementation details paragraph.`);
});

test("truncates the returned response but caches the full response", async () => {
    const documentId = generateId<DocumentId>();

    await context.storage.pageStoredLinkByPathname.put("/document/pagination-spec", {
        type: "Document",
        id: documentId,
        title: "Pagination Spec",
    });

    mockApiGetDocument(api, {
        spaceId,
        documentId,
        version: 1,
        title: "Pagination Spec",
        content: createDocumentContentFromParagraphs(
            Array.from({length: 20}, (_, index) => {
                const paragraphNumber = (index + 1).toString().padStart(2, "0");
                return `Paragraph ${paragraphNumber} detail detail detail detail detail detail.`;
            }),
        ),
    });

    const responseString = await callAgentWebReadTool(context, {
        path: "/document/pagination-spec",
        limit: "120b",
    });

    expect(responseString).toEqual(`\
# Pagination Spec

Paragraph 01 detail detail detail detail detail detail.

(Page truncated, 1.08kb remaining. Showing lines 1-4 of 41. Call the \`scroll\` tool with an \`offset\` of 4 to continue.)`);
});

test("reads a compact GFM table", async () => {
    const documentId = generateId<DocumentId>();

    await context.storage.pageStoredLinkByPathname.put("/document/roadmap-table", {
        type: "Document",
        id: documentId,
        title: "Roadmap Table",
    });

    mockApiGetDocument(api, {
        spaceId,
        documentId,
        version: 1,
        title: "Roadmap Table",
        content: parseApiContentFromMarkdown(
            `\
| Milestone | Owner | Status |
| - | - | - |
| API schema freeze | Platform | Done |
| Query planner rollout | Search | In Progress |
| Inbox polish | Comms | Planned |`,
        ) as ApiContent,
    });

    const responseString = await callAgentWebReadTool(context, {
        path: "/document/roadmap-table",
        limit: "10kb",
    });

    expect(responseString).toEqual(`\
# Roadmap Table

| Milestone | Owner | Status |
| - | - | - |
| API schema freeze | Platform | Done |
| Query planner rollout | Search | In Progress |
| Inbox polish | Comms | Planned |`);
});

test("throws a redirect error when document title changes for same document id", async () => {
    const sourceDocumentId = generateId<DocumentId>();
    const documentId = generateId<DocumentId>();
    const sourcePathname = "/document/mention-source";
    const oldPathname = "/document/engineering-spec";
    const newPathname = "/document/engineering-plan";

    await context.storage.pageStoredLinkByPathname.put(sourcePathname, {
        type: "Document",
        id: sourceDocumentId,
        title: "Mention Source",
    });

    mockApiGetDocument(api, {
        spaceId,
        documentId: sourceDocumentId,
        version: 1,
        title: "Mention Source",
        content: createDocumentContentWithDocumentMention(documentId, "Engineering Spec"),
    });

    mockApiGetDocument(api, {
        spaceId,
        documentId: sourceDocumentId,
        version: 1,
        title: "Mention Source",
        content: createDocumentContentWithDocumentMention(documentId, "Engineering Plan"),
    });

    const oldMentionResponse = await callAgentWebReadTool(context, {
        path: sourcePathname,
        limit: "10kb",
    });

    expect(oldMentionResponse).toContain(`[Engineering Spec](${oldPathname})`);
    expect(oldMentionResponse).not.toContain(`[Engineering Plan](${newPathname})`);

    const newMentionResponse = await callAgentWebReadTool(context, {
        path: sourcePathname,
        limit: "10kb",
    });

    expect(newMentionResponse).toContain(`[Engineering Plan](${newPathname})`);
    expect(newMentionResponse).not.toContain(`[Engineering Spec](${oldPathname})`);

    const pageLinkKey = printAgentWebPageStoredLinkKey({type: "Document", id: documentId});

    expect(await context.storage.pageStoredLinkByPathname.get(oldPathname)).toEqual({
        type: "Document",
        id: documentId,
        title: "Engineering Spec",
    });

    expect(await context.storage.pageStoredLinkByPathname.get(newPathname)).toEqual({
        type: "Document",
        id: documentId,
        title: "Engineering Plan",
    });

    expect(await context.storage.latestPageStoredLinkPathnameByKey.get(pageLinkKey)).toEqual(
        newPathname,
    );

    await expect(
        callAgentWebReadTool(context, {path: oldPathname, limit: "10kb"}),
    ).resolves.toEqual(
        "Error: Couldn\u2019t read `/document/engineering-spec`. This path was redirected to `/document/engineering-plan`. Try calling the `read` tool again with the new path.",
    );
});
