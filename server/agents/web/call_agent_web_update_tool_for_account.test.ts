import {ApiClientMock} from "~/server/agents/api/test_helpers/api_client_mock.js";
import {AgentWebContext} from "~/server/agents/web/agent_web_context.open_source.js";
import {callAgentWebReadTool as actuallyCallAgentWebReadTool} from "~/server/agents/web/call_agent_web_read_tool.open_source.js";
import {callAgentWebUpdateTool as actuallyCallAgentWebUpdateTool} from "~/server/agents/web/call_agent_web_update_tool.open_source.js";
import {createAgentWebSessionStorageForTest} from "~/server/agents/web/test_helpers/create_agent_web_session_storage_for_test.js";
import {storeAgentWebPageLinkForTest} from "~/server/agents/web/test_helpers/store_agent_web_page_link_for_test.js";
import {ApiAccountResponse} from "~/shared/api/specification/types/api_specification_convenience_types.open_source.js";
import {serializeDateString} from "~/shared/helpers/date/date_string.open_source.js";
import {defaultTimeZone} from "~/shared/helpers/intl/time_zone.open_source.js";
import {generateId} from "~/shared/id/id.open_source.js";
import {AccountId, BotId, SpaceId} from "~/shared/id/types/id_types.open_source.js";
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

const {span} = testTracer.startSpan("call_agent_web_update_tool_for_account.test.ts");
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

function mockGetAccount(accountId: AccountId, responseData: Omit<ApiAccountResponse, "id">): void {
    api.mockGet("/spaces/{id}/accounts/{accountId}", {
        params: {path: {id: spaceId, accountId}},
        data: {
            account: {
                id: accountId,
                ...responseData,
            },
        },
    });
}

test("throws when updating an account", async () => {
    const accountId = generateId<AccountId>();

    await storeAgentWebPageLinkForTest(storage, {
        type: "Account",
        id: accountId,
        title: "Alice Smith",
        shortName: "Alice Smith",
    });

    mockGetAccount(accountId, {
        name: "Alice Smith",
        shortName: "Alice Smith",
        space: {
            role: "Member",
            addedTime: serializeDateString(new Date("2026-01-01T00:00:00.000Z")),
        },
    });

    await callAgentWebReadTool(context, {
        path: "/human/alice-smith",
        limit: "10kb",
    });

    await expect(
        callAgentWebUpdateTool(context, {
            path: "/human/alice-smith",
            updates: [{old: "- Role: Member", new: "- Role: Admin", replaceAll: false}],
        }),
    ).resolves.toEqual(
        "Error: Couldn\u2019t update `/human/alice-smith`. Can\u2019t update humans or bots using " +
            "the `update` tool. " +
            "Try updating another page instead.",
    );
});
