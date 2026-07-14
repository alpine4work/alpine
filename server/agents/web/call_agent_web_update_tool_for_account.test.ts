import {ApiClientMock} from "~/server/agents/api/test_helpers/api_client_mock.js";
import {AgentWebContext} from "~/server/agents/web/agent_web_context.js";
import {callAgentWebReadTool} from "~/server/agents/web/call_agent_web_read_tool.js";
import {callAgentWebUpdateTool} from "~/server/agents/web/call_agent_web_update_tool.js";
import {createAgentWebPageStoredLinkPathname} from "~/server/agents/web/create_agent_web_page_stored_link_pathname.js";
import {createAgentWebSessionStorageForTest} from "~/server/agents/web/test_helpers/create_agent_web_session_storage_for_test.js";
import {ApiAccountResponse} from "~/shared/api/specification/types/api_specification_convenience_types.js";
import {ErrorBase, InternalError} from "~/shared/error/error.js";
import {ErrorDisplayMessage} from "~/shared/error/types/error_display_message_type.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {serializeDateString} from "~/shared/helpers/date/date_string.js";
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

function printDisplayMessage(displayMessage: ErrorDisplayMessage): string {
    let string = "";

    for (const segment of displayMessage) {
        switch (segment.type) {
            case "Text":
            case "SensitiveText":
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

    throw new InternalError("Expected error with display message", {cause: error});
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
            addedTime: serializeDateString(new Date("2026-01-01T00:00:00.000Z")),
        },
    });

    await callAgentWebReadTool(context, {
        path: "/human/alice-smith",
        limit: "10kb",
    });

    let error: unknown;

    try {
        await callAgentWebUpdateTool(context, {
            path: "/human/alice-smith",
            updates: [{old: "- Role: Member", new: "- Role: Admin", replaceAll: false}],
        });
    } catch (actualError) {
        error = actualError;
    }

    expect(printDisplayMessage(getDisplayMessage(error))).toEqual(
        "Can\u2019t update humans or bots using the `update` tool. Try updating another page instead.",
    );
});
