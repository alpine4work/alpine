import {
    createApiClient,
    getApiMessagesFromStart,
} from "~/server/agents/api/api_client.open_source.js";
import {AgentV2ServiceEnv} from "~/server/agents/bots_v2/internal/agent_v2_service_env.js";
import {readClaudeAgentConversationStateFromBucket} from "~/server/agents/bots_v2/internal/read_claude_agent_conversation_state_from_bucket.js";
import {
    convertApiReferenceKeyToLowercase,
    printApiReferenceKey,
} from "~/shared/api/specification/api_reference_key.open_source.js";
import {isApiMessageRoom, parseApiPath} from "~/shared/api/specification/parse_api_path.js";
import {FailedPreconditionError, InvalidArgumentError} from "~/shared/error/error.open_source.js";
import {serializeError} from "~/shared/error/error_schema.js";
import {isSystemError} from "~/shared/error/is_system_error_code.open_source.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.open_source.js";
import {TracerSpan} from "~/shared/tracer/tracer_span.open_source.js";

/**
 * Handles `GET /claude/conversation-state` for the agent debugger: returns a
 * sandbox's persisted `state.json` and session transcript. Mirrors the ChatGPT
 * `/chat-gpt/conversation-state` route, including its response shape
 * (`{ok: true, …}` / `{ok: false, error}`).
 *
 * Authorization is delegated to the API. The caller (the debug loader) passes an
 * `accessToken` scoped to the acting account, and we prove access by reading a
 * message from the room with it — so we never expose more than the actor could
 * already see. The state itself is read directly from the R2 bucket bound to
 * `AgentV2Service`, so no Durable Object or container needs to be started.
 */
export async function handleClaudeAgentConversationStateRequest(
    span: TracerSpan,
    request: Request,
    env: AgentV2ServiceEnv,
): Promise<Response> {
    if (request.method !== "GET") {
        return new Response("405 Method Not Allowed", {
            status: 405,
            headers: {"content-type": "text/plain"},
        });
    }

    try {
        const url = new URL(request.url);
        const accessToken = url.searchParams.get("accessToken");
        const accountId = url.searchParams.get("accountId");
        const roomPath = url.searchParams.get("roomPath");

        if (accessToken === null) {
            throw new InvalidArgumentError("Missing `accessToken` search param");
        }
        if (accountId === null) {
            throw new InvalidArgumentError("Missing `accountId` search param");
        }
        if (roomPath === null) {
            throw new InvalidArgumentError("Missing `roomPath` search param");
        }

        const room = parseApiPath(roomPath);
        if (!isApiMessageRoom(room)) {
            throw new InvalidArgumentError("Invalid `roomPath` search param");
        }

        // Prove the actor has access to the room by reading a message with their
        // account-scoped token. If they can't, this throws before we read any state.
        const apiClient = createApiClient({
            baseUrl: assertExists(env.API_SERVICE_URL, "Missing `API_SERVICE_URL`"),
            apiKey: assertExists(env.CLAUDE_API_SERVICE_KEY, "Missing `CLAUDE_API_SERVICE_KEY`"),
            accessToken,
        });

        const {
            data: {messages},
        } = await getApiMessagesFromStart(span, apiClient, room, {limit: 1, cursor: null});

        if (messages.length === 0) {
            throw new FailedPreconditionError(
                "Can\u2019t fetch conversation state for an empty messaging room",
            );
        }

        // The same sandbox ID the webhook derives, so we read the right R2 prefix.
        const sandboxId = `${accountId}/${convertApiReferenceKeyToLowercase(printApiReferenceKey(room))}`;

        const conversationState = await readClaudeAgentConversationStateFromBucket(
            env.ClaudeAgentBucket,
            sandboxId,
        );

        return new Response(JSON.stringify({ok: true, sandboxId, ...conversationState}), {
            status: 200,
            headers: {"content-type": "application/json"},
        });
    } catch (error) {
        span.addException(error);

        return new Response(JSON.stringify({ok: false, error: serializeError(error)}), {
            status: isSystemError(error) ? 500 : 400,
            headers: {"content-type": "application/json"},
        });
    }
}
