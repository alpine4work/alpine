import {ApiClientMock} from "~/server/agents/api/test_helpers/api_client_mock.js";
import {createApiAccountMock} from "~/server/agents/api/test_helpers/create_api_account_mock.js";
import {AgentWebContext} from "~/server/agents/web/agent_web_context.open_source.js";
import {callAgentWebReadTool as actuallyCallAgentWebReadTool} from "~/server/agents/web/call_agent_web_read_tool.open_source.js";
import {callAgentWebUpdateTool as actuallyCallAgentWebUpdateTool} from "~/server/agents/web/call_agent_web_update_tool.open_source.js";
import {createAgentWebPageStoredLinkPathname} from "~/server/agents/web/create_agent_web_page_stored_link_pathname.open_source.js";
import {createAgentWebSessionStorageForTest} from "~/server/agents/web/test_helpers/create_agent_web_session_storage_for_test.js";
import {ApiInboxEntryResponse} from "~/shared/api/specification/types/api_specification_convenience_types.open_source.js";
import {serializeDateString} from "~/shared/helpers/date/date_string.open_source.js";
import {defaultTimeZone} from "~/shared/helpers/intl/time_zone.open_source.js";
import {generateId} from "~/shared/id/id.open_source.js";
import {
    AccountId,
    BotId,
    ChannelId,
    PostId,
    SpaceId,
} from "~/shared/id/types/id_types.open_source.js";
import {testTracer} from "~/shared/tracer/dev/test_tracer.js";

async function callAgentWebReadTool(
    ...callArguments: Parameters<typeof actuallyCallAgentWebReadTool>
): Promise<string> {
    return (await actuallyCallAgentWebReadTool(...callArguments)).response;
}

async function callAgentWebUpdateTool(
    ...callArguments: Parameters<typeof actuallyCallAgentWebUpdateTool>
): Promise<string> {
    return (await actuallyCallAgentWebUpdateTool(...callArguments)).response;
}

const {span} = testTracer.startSpan("call_agent_web_update_tool_for_inbox.test.ts");
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

test("throws when updating an inbox", async () => {
    const accountId = generateId<AccountId>();
    const channelId = generateId<ChannelId>();
    const channelPostId = generateId<PostId>();

    const accountReference = {
        type: "Account" as const,
        id: accountId,
        title: "Alice Smith",
        shortName: "Alice Smith",
    };
    await createAgentWebPageStoredLinkPathname(storage, accountReference);
    api.mockGet("/accounts/{id}-reference", {
        params: {path: {id: accountId}},
        data: {reference: accountReference},
    });

    const entry: ApiInboxEntryResponse = {
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
        channel: {type: "Channel", id: channelId, title: "Engineering"},
        posts: [{id: channelPostId}],
    };

    api.mockGet("/spaces/{id}/accounts/{accountId}/inbox/entries", {
        params: {path: {id: spaceId, accountId}, query: {status: "New", limit: 10}},
        data: {
            inbox: {loudNotificationCount: 0, newEntryCount: 1},
            entries: [entry],
            nextCursor: null,
        },
    });

    await callAgentWebReadTool(context, {
        path: "/human/alice-smith/inbox",
        limit: "10kb",
    });

    await expect(
        callAgentWebUpdateTool(context, {
            path: "/human/alice-smith/inbox",
            updates: [{old: "Take a look", new: "Look here", replaceAll: false}],
        }),
    ).resolves.toEqual(
        "Error: Couldn\u2019t update `/human/alice-smith/inbox`. Can\u2019t update inboxes using " +
            "the `update` tool. Try updating another page instead.",
    );
});
