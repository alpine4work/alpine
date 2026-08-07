import {ApiClientMock} from "~/server/agents/api/test_helpers/api_client_mock.js";
import {AgentWebContext} from "~/server/agents/web/agent_web_context.open_source.js";
import {callAgentWebReadTool} from "~/server/agents/web/call_agent_web_read_tool.open_source.js";
import {createAgentWebSessionStorageForTest} from "~/server/agents/web/test_helpers/create_agent_web_session_storage_for_test.js";
import {storeAgentWebPageLinkForTest} from "~/server/agents/web/test_helpers/store_agent_web_page_link_for_test.js";
import {ApiAccountResponse} from "~/shared/api/specification/types/api_specification_convenience_types.open_source.js";
import {serializeDateString} from "~/shared/helpers/date/date_string.open_source.js";
import {defaultTimeZone} from "~/shared/helpers/intl/time_zone.open_source.js";
import {generateId} from "~/shared/id/id.open_source.js";
import {AccountId, BotId, SpaceId} from "~/shared/id/types/id_types.open_source.js";
import {testTracer} from "~/shared/tracer/dev/test_tracer.js";

const {span} = testTracer.startSpan("call_agent_web_read_tool_for_account.test.ts");
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

test("reads account page", async () => {
    const accountId = generateId<AccountId>();

    await storeAgentWebPageLinkForTest(storage, {
        type: "Account",
        id: accountId,
        title: "Alice Smith",
        shortName: "Alice",
    });

    mockGetAccount(accountId, {
        name: "Alice Smith",
        shortName: "Alice",
        space: {
            role: "Admin",
            addedTime: serializeDateString(new Date("2026-01-01T00:00:00.000Z")),
            inactive: {type: "InvitePending"},
        },
    });

    expect(
        await callAgentWebReadTool(context, {
            path: "/human/alice-smith",
            limit: "10kb",
        }),
    ).toEqual(`\
# Alice Smith

- State: Invited, but hasn\u2019t accepted their invite
- Role: Admin
- Short name: Alice`);
});
