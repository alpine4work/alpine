import {ApiClientMock} from "~/server/agents/api/test_helpers/api_client_mock.js";
import {AgentWebContext} from "~/server/agents/web/agent_web_context.js";
import {callAgentWebReadTool} from "~/server/agents/web/call_agent_web_read_tool.js";
import {callAgentWebUpdateTool} from "~/server/agents/web/call_agent_web_update_tool.js";
import {createAgentWebPageStoredLinkPathname} from "~/server/agents/web/create_agent_web_page_stored_link_pathname.js";
import {createAgentWebSessionStorageForTest} from "~/server/agents/web/test_helpers/create_agent_web_session_storage_for_test.js";
import {ApiAccountResponse} from "~/shared/api/specification/types/api_specification_convenience_types.js";
import {defaultTimeZone} from "~/shared/helpers/intl/time_zone.js";
import {generateId} from "~/shared/id/id.js";
import {AccountId, BotId, SpaceId} from "~/shared/id/types/id_types.js";
import {testTracer} from "~/shared/tracer/dev/test_tracer.js";

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
        type: "Account",
        id: botAccountId,
        title: "ChatGPT",
        shortName: "ChatGPT",
        bot: {id: botId},
        pathname: "/bot/chatgpt",
    },
};

function mockGetAccount(
    accountId: AccountId,
    responseData: Omit<ApiAccountResponse, "id">,
): void {
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

    await createAgentWebPageStoredLinkPathname(storage, {
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
            addedTime: "2026-01-01T00:00:00.000Z",
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
    ).rejects.toThrow("Can\u2019t update accounts");
});
