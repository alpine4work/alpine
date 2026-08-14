import {ApiClientMock} from "~/server/agents/api/test_helpers/api_client_mock.js";
import {createApiAccountMock} from "~/server/agents/api/test_helpers/create_api_account_mock.js";
import {AgentWebContext} from "~/server/agents/web/agent_web_context.open_source.js";
import {callAgentWebReadTool as actuallyCallAgentWebReadTool} from "~/server/agents/web/call_agent_web_read_tool.open_source.js";
import {createAgentWebPageStoredLinkPathname} from "~/server/agents/web/create_agent_web_page_stored_link_pathname.open_source.js";
import {
    AgentWebInboxPageStatus,
    agentWebInboxPageApiEntriesBatchCount,
} from "~/server/agents/web/pages/agent_web_inbox_page.open_source.js";
import {createAgentWebSessionStorageForTest} from "~/server/agents/web/test_helpers/create_agent_web_session_storage_for_test.js";
import {ApiInboxEntryResponse} from "~/shared/api/specification/types/api_specification_convenience_types.open_source.js";
import {serializeDateString} from "~/shared/helpers/date/date_string.open_source.js";
import {defaultTimeZone} from "~/shared/helpers/intl/time_zone.open_source.js";
import {generateId} from "~/shared/id/id.open_source.js";
import {
    AccountId,
    BotId,
    ChannelId,
    ChatId,
    PostId,
    SpaceId,
} from "~/shared/id/types/id_types.open_source.js";
import {testTracer} from "~/shared/tracer/dev/test_tracer.js";

async function callAgentWebReadTool(
    ...callArguments: Parameters<typeof actuallyCallAgentWebReadTool>
): Promise<string> {
    return (await actuallyCallAgentWebReadTool(...callArguments)).response;
}

const {span} = testTracer.startSpan("call_agent_web_read_tool_for_inbox.test.ts");
const api = new ApiClientMock();
const spaceId = generateId<SpaceId>();
const storage = createAgentWebSessionStorageForTest(spaceId);

const aliceId = generateId<AccountId>();
const aliceAccountReference = {
    type: "Account" as const,
    id: aliceId,
    title: "Alice Smith",
    shortName: "Alice",
};

const context: AgentWebContext = {
    spaceId,
    api,
    storage,
    span,
    timeZone: defaultTimeZone,
    botAccount: {
        id: generateId<AccountId>(),
        bot: {id: generateId<BotId>()},
    },
};

// Entry times are formatted relative to "now" in the reader's time zone, so pin
// the clock. May 14th is during daylight saving time in New York, so times render
// as "EDT".
beforeEach(async () => {
    import.meta.jest.useFakeTimers();
    import.meta.jest.setSystemTime(new Date("2026-05-14T18:00:00.000Z"));

    await storage.deleteAll();

    // Register the human's account stored link first so `/human/alice-smith/inbox`
    // routes to it.
    await createAgentWebPageStoredLinkPathname(storage, aliceAccountReference);
    api.mockGet("/accounts/{id}-reference", {
        params: {path: {id: aliceId}},
        data: {reference: aliceAccountReference},
    });
});

afterEach(() => {
    import.meta.jest.useRealTimers();
});

function mockInboxEntries({
    status,
    cursor,
    entries,
    nextCursor,
}: {
    status: AgentWebInboxPageStatus;
    cursor?: string;
    entries: ReadonlyArray<ApiInboxEntryResponse>;
    nextCursor: string | null;
}): void {
    api.mockGet("/spaces/{id}/accounts/{accountId}/inbox/entries", {
        params: {
            path: {id: spaceId, accountId: aliceId},
            query: {status, limit: agentWebInboxPageApiEntriesBatchCount, cursor},
        },
        data: {
            inbox: {loudNotificationCount: 0, newEntryCount: entries.length},
            entries,
            nextCursor,
        },
    });
}

test("reads a new notifications inbox page", async () => {
    const engineeringChannelId = generateId<ChannelId>();
    const standupChatId = generateId<ChatId>();

    mockInboxEntries({
        status: "New",
        nextCursor: null,
        entries: [
            {
                type: "CreatedChannelPosts",
                title: [{type: "Text", text: "New posts in Engineering"}],
                preview: [
                    {type: "Account", account: createApiAccountMock({name: "Alice"})},
                    {type: "Text", text: "Take a look at our new launch video!"},
                ],
                time: serializeDateString(new Date("2026-05-14T14:34:00Z")),
                loudNotificationCount: 2,
                status: "New",
                featured: {type: "Account", account: createApiAccountMock({name: "Alice"})},
                channel: {type: "Channel", id: engineeringChannelId, title: "Engineering"},
                posts: [{id: generateId<PostId>()}],
            },
            {
                type: "Chat",
                title: [{type: "Text", text: "Caleb sent you a message"}],
                preview: [
                    {type: "Account", account: createApiAccountMock({name: "Caleb"})},
                    {type: "Text", text: "Are you free at 3?"},
                ],
                time: serializeDateString(new Date("2026-05-14T13:00:00Z")),
                loudNotificationCount: 0,
                status: "New",
                featured: {type: "Account", account: createApiAccountMock({name: "Caleb"})},
                chat: {type: "Chat", id: standupChatId, title: "Standup"},
                previewMessage: {index: 7},
            },
        ],
    });

    expect(await callAgentWebReadTool(context, {path: "/human/alice-smith/inbox", limit: "10kb"}))
        .toEqual(`\
Showing new notifications for [Alice Smith](/human/alice-smith). ([See done notifications](/human/alice-smith/inbox?status=done))

- <badge>2</badge> [New posts in Engineering](/channel/engineering) (May 14th at 10:34am EDT)

  Alice: Take a look at our new launch video!

- [Caleb sent you a message](/chat-message/caleb-are-you-free-at-3) (May 14th at 9:00am EDT)

  Caleb: Are you free at 3?

End of new notifications.`);
});

test("reads a done notifications inbox page", async () => {
    const launchPostId = generateId<PostId>();

    mockInboxEntries({
        status: "Done",
        nextCursor: null,
        entries: [
            {
                type: "Post",
                title: [{type: "Text", text: "New comment on your post"}],
                preview: [
                    {type: "Account", account: createApiAccountMock({name: "Bob"})},
                    {type: "Text", text: "Nice work"},
                ],
                time: serializeDateString(new Date("2026-05-14T14:55:00Z")),
                loudNotificationCount: 1,
                status: "Done",
                featured: {type: "Account", account: createApiAccountMock({name: "Bob"})},
                post: {type: "Post", id: launchPostId, title: "Launch notes"},
                previewMessage: {index: 2},
            },
        ],
    });

    expect(
        await callAgentWebReadTool(context, {
            path: "/human/alice-smith/inbox?status=done",
            limit: "10kb",
        }),
    ).toEqual(`\
Showing done notifications for [Alice Smith](/human/alice-smith). ([See new notifications](/human/alice-smith/inbox))

- <badge>1</badge> [New comment on your post](/post-comment/bob-nice-work) (May 14th at 10:55am EDT)

  Bob: Nice work

End of done notifications.`);
});

test("reads an empty inbox page", async () => {
    mockInboxEntries({status: "New", nextCursor: null, entries: []});

    expect(await callAgentWebReadTool(context, {path: "/human/alice-smith/inbox", limit: "10kb"}))
        .toEqual(`\
Showing new notifications for [Alice Smith](/human/alice-smith). ([See done notifications](/human/alice-smith/inbox?status=done))

End of new notifications.`);
});

test("loads more entry batches while the response is still under the limit", async () => {
    const engineeringChannelId = generateId<ChannelId>();
    const designChannelId = generateId<ChannelId>();

    mockInboxEntries({
        status: "New",
        nextCursor: "cursor1",
        entries: [
            {
                type: "CreatedChannelPosts",
                title: [{type: "Text", text: "New posts in Engineering"}],
                preview: [
                    {type: "Account", account: createApiAccountMock({name: "Alice"})},
                    {type: "Text", text: "Take a look"},
                ],
                time: serializeDateString(new Date("2026-05-14T14:34:00Z")),
                loudNotificationCount: 0,
                status: "New",
                featured: {type: "Account", account: createApiAccountMock({name: "Alice"})},
                channel: {type: "Channel", id: engineeringChannelId, title: "Engineering"},
                posts: [{id: generateId<PostId>()}],
            },
        ],
    });
    mockInboxEntries({
        status: "New",
        cursor: "cursor1",
        nextCursor: null,
        entries: [
            {
                type: "CreatedChannelPosts",
                title: [{type: "Text", text: "New posts in Design"}],
                preview: [
                    {type: "Account", account: createApiAccountMock({name: "Bob"})},
                    {type: "Text", text: "New mockups are ready"},
                ],
                time: serializeDateString(new Date("2026-05-14T13:00:00Z")),
                loudNotificationCount: 0,
                status: "New",
                featured: {type: "Account", account: createApiAccountMock({name: "Bob"})},
                channel: {type: "Channel", id: designChannelId, title: "Design"},
                posts: [{id: generateId<PostId>()}],
            },
        ],
    });

    const response = await callAgentWebReadTool(context, {
        path: "/human/alice-smith/inbox",
        limit: "10kb",
    });
    const inboxRequestParams = api
        .getRequestHistory()
        .filter(request => request.path === "/spaces/{id}/accounts/{accountId}/inbox/entries")
        .map(request => request.params);

    expect({response, inboxRequestParams}).toEqual({
        response: `\
Showing new notifications for [Alice Smith](/human/alice-smith). ([See done notifications](/human/alice-smith/inbox?status=done))

- [New posts in Engineering](/channel/engineering) (May 14th at 10:34am EDT)

  Alice: Take a look

- [New posts in Design](/channel/design) (May 14th at 9:00am EDT)

  Bob: New mockups are ready

End of new notifications.`,
        inboxRequestParams: [
            {
                path: {id: spaceId, accountId: aliceId},
                query: {status: "New", limit: agentWebInboxPageApiEntriesBatchCount},
            },
            {
                path: {id: spaceId, accountId: aliceId},
                query: {
                    status: "New",
                    limit: agentWebInboxPageApiEntriesBatchCount,
                    cursor: "cursor1",
                },
            },
        ],
    });
});

test("returns the last full batch with a next page link when a later batch overshoots the limit", async () => {
    const engineeringChannelId = generateId<ChannelId>();
    const designChannelId = generateId<ChannelId>();

    mockInboxEntries({
        status: "New",
        nextCursor: "cursor1",
        entries: [
            {
                type: "CreatedChannelPosts",
                title: [{type: "Text", text: "New posts in Engineering"}],
                preview: [
                    {type: "Account", account: createApiAccountMock({name: "Alice"})},
                    {type: "Text", text: "Take a look"},
                ],
                time: serializeDateString(new Date("2026-05-14T14:34:00Z")),
                loudNotificationCount: 0,
                status: "New",
                featured: {type: "Account", account: createApiAccountMock({name: "Alice"})},
                channel: {type: "Channel", id: engineeringChannelId, title: "Engineering"},
                posts: [{id: generateId<PostId>()}],
            },
        ],
    });
    mockInboxEntries({
        status: "New",
        cursor: "cursor1",
        nextCursor: "cursor2",
        entries: [
            {
                type: "CreatedChannelPosts",
                title: [{type: "Text", text: "New posts in Design"}],
                preview: [
                    {type: "Account", account: createApiAccountMock({name: "Bob"})},
                    {type: "Text", text: "New mockups are ready"},
                ],
                time: serializeDateString(new Date("2026-05-14T13:00:00Z")),
                loudNotificationCount: 0,
                status: "New",
                featured: {type: "Account", account: createApiAccountMock({name: "Bob"})},
                channel: {type: "Channel", id: designChannelId, title: "Design"},
                posts: [{id: generateId<PostId>()}],
            },
        ],
    });

    // With the limit set to exactly the first batch's length, the first batch fits (so
    // its "Next page »" link resuming at `cursor1` is committed) but accumulating the
    // second batch overshoots, so the read falls back to the committed first batch.
    const expectedResponse = `\
Showing new notifications for [Alice Smith](/human/alice-smith). ([See done notifications](/human/alice-smith/inbox?status=done))

- [New posts in Engineering](/channel/engineering) (May 14th at 10:34am EDT)

  Alice: Take a look

[Next page »](/human/alice-smith/inbox?after=cursor1)`;

    expect(
        await callAgentWebReadTool(context, {
            path: "/human/alice-smith/inbox",
            limit: `${expectedResponse.length}b`,
        }),
    ).toEqual(expectedResponse);
});

test("reads the next page of entries with an after cursor", async () => {
    const designChannelId = generateId<ChannelId>();

    mockInboxEntries({
        status: "New",
        cursor: "cursor1",
        nextCursor: null,
        entries: [
            {
                type: "CreatedChannelPosts",
                title: [{type: "Text", text: "New posts in Design"}],
                preview: [
                    {type: "Account", account: createApiAccountMock({name: "Bob"})},
                    {type: "Text", text: "New mockups are ready"},
                ],
                time: serializeDateString(new Date("2026-05-14T13:00:00Z")),
                loudNotificationCount: 0,
                status: "New",
                featured: {type: "Account", account: createApiAccountMock({name: "Bob"})},
                channel: {type: "Channel", id: designChannelId, title: "Design"},
                posts: [{id: generateId<PostId>()}],
            },
        ],
    });

    expect(
        await callAgentWebReadTool(context, {
            path: "/human/alice-smith/inbox?after=cursor1",
            limit: "10kb",
        }),
    ).toEqual(`\
Showing new notifications for [Alice Smith](/human/alice-smith). ([See done notifications](/human/alice-smith/inbox?status=done))

- [New posts in Design](/channel/design) (May 14th at 9:00am EDT)

  Bob: New mockups are ready

End of new notifications.`);
});
