// NOTE: We mostly use documents in this file to test general
// `callAgentWebReadTool()` behavior. For document-specific tests see
// `server/agents/web/call_agent_web_read_tool_document.test.ts`.

import {ApiClientMock} from "~/server/agents/api/test_helpers/api_client_mock.js";
import {AgentWebContext} from "~/server/agents/web/agent_web_context.js";
import {printAgentWebPageStoredLinkKey} from "~/server/agents/web/agent_web_page_stored_link_key.js";
import {callAgentWebReadTool} from "~/server/agents/web/call_agent_web_read_tool.js";
import {createAgentWebSessionStorageForTest} from "~/server/agents/web/test_helpers/create_agent_web_session_storage_for_test.js";
import {ApiContentKeyEncoder} from "~/shared/api/content/api_content_key_encoder.js";
import {parseApiContentFromMarkdown} from "~/shared/api/markdown/parse_api_content_from_markdown.js";
import {ApiContentResponse} from "~/shared/api/specification/types/api_specification_convenience_types.js";
import {NotFoundError} from "~/shared/error/error.js";
import {defaultTimeZone} from "~/shared/helpers/intl/time_zone.js";
import {generateId} from "~/shared/id/id.js";
import {AccountId, BotId, DocumentId, SpaceId} from "~/shared/id/types/id_types.js";
import {testTracer} from "~/shared/tracer/dev/test_tracer.js";

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
        type: "Account",
        id: botAccountId,
        title: "ChatGPT",
        shortName: "ChatGPT",
        bot: {id: botId},
        pathname: "/bot/chatgpt",
    },
};

function createDocumentContentFromParagraphs(paragraphTextList: ReadonlyArray<string>) {
    return parseApiContentFromMarkdown(paragraphTextList.join("\n\n")) as ApiContentResponse;
}

function createDocumentContentWithDocumentMention(
    documentId: DocumentId,
    title: string,
): ApiContentResponse {
    return {
        elements: [
            {
                type: "Paragraph",
                key: new ApiContentKeyEncoder({entityId: "Test", version: 0}).encode({
                    pos: 0,
                    nodeSize: 0,
                }),
                elements: [
                    {type: "Text", text: "See "},
                    {type: "Mention", reference: {type: "Document", id: documentId, title}},
                    {type: "Text", text: " for context."},
                ],
            },
        ],
    };
}

test("throws when the link path has not been seen", async () => {
    await expect(
        callAgentWebReadTool(context, {path: "/document/unknown", limit: "10kb"}),
    ).rejects.toThrow(NotFoundError);
});

test("returns full markdown and stores normalized read response", async () => {
    const documentId = generateId<DocumentId>();

    await context.storage.pageStoredLinkByPathname.put("/document/engineering-spec", {
        type: "Document",
        id: documentId,
        title: "Engineering Spec",
    });

    api.mockGetDocument(spaceId, documentId, {
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

    api.mockGetDocument(spaceId, documentId, {
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

test("reads GFM table content without crashing prettier formatting", async () => {
    const documentId = generateId<DocumentId>();

    await context.storage.pageStoredLinkByPathname.put("/document/roadmap-table", {
        type: "Document",
        id: documentId,
        title: "Roadmap Table",
    });

    api.mockGetDocument(spaceId, documentId, {
        title: "Roadmap Table",
        content: parseApiContentFromMarkdown(
            `\
| Milestone | Owner | Status |
| - | - | - |
| API schema freeze | Platform | Done |
| Query planner rollout | Search | In Progress |
| Inbox polish | Comms | Planned |`,
        ) as ApiContentResponse,
    });

    const responseString = await callAgentWebReadTool(context, {
        path: "/document/roadmap-table",
        limit: "10kb",
    });

    expect(responseString).toEqual(`\
# Roadmap Table

| Milestone             | Owner    | Status      |
| --------------------- | -------- | ----------- |
| API schema freeze     | Platform | Done        |
| Query planner rollout | Search   | In Progress |
| Inbox polish          | Comms    | Planned     |`);
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

    api.mockGetDocument(spaceId, sourceDocumentId, {
        title: "Mention Source",
        content: createDocumentContentWithDocumentMention(documentId, "Engineering Spec"),
    });

    api.mockGetDocument(spaceId, sourceDocumentId, {
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
    ).rejects.toMatchObject({
        message: "Link was redirected",
        displayMessage: [
            {type: "Text", text: "This path was redirected to `"},
            {type: "SensitiveText", text: newPathname},
            {
                type: "Text",
                text: "`. Try calling the `read` tool again with the new path.",
            },
        ],
    });
});
