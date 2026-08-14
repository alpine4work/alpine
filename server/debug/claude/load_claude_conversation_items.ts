import {claudeKnownBotId} from "~/server/bots/settings_default_known_bot_account_model_data.js";
import {getAgentConversationDebugItemsForClaudeSession} from "~/server/debug/claude/internal/get_agent_conversation_debug_items_for_claude_session.js";
import {LoaderContext} from "~/server/remix/loader_context.js";
import {authorizeSpaceAccess} from "~/server/spaces/authorize_space_access.js";
import {getBotAccountIdForSpaceIfExists} from "~/server/spaces/get_bot_account_id_for_space_if_exists.js";
import {printApiMessageRoomPath} from "~/shared/api/specification/parse_api_path.js";
import {ApiMessageRoomReference} from "~/shared/api/specification/types/api_specification_convenience_types.open_source.js";
import {
    ClaudeConversationDebugData,
    ClaudeConversationStateResponseSchema,
} from "~/shared/debug/claude/claude_conversation_item.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.open_source.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.open_source.js";
import {SpaceId} from "~/shared/id/types/id_types.open_source.js";
import {fetchWithTracer} from "~/shared/tracer/fetch_with_tracer.open_source.js";

/**
 * Loads everything the Claude agent debugger renders for one conversation.
 *
 * Mirrors the ChatGPT debugger (`load_chat_gpt_conversation_items.ts`): we sign a
 * short-lived token scoped to the acting account, then call the agent service's
 * `/claude/conversation-state` endpoint. That endpoint reads the sandbox's
 * persisted `state.json` and session transcript directly from R2 (see
 * `handle_claude_agent_conversation_state_request.ts`).
 *
 * Returns gracefully (`null` state, empty items) when the Claude bot isn't
 * instantiated in the space; the endpoint likewise returns nulls when no
 * conversation has run yet.
 */
export async function loadClaudeConversationDebugData(
    unauthenticatedContext: LoaderContext,
    spaceId: SpaceId,
    room: ApiMessageRoomReference,
): Promise<ClaudeConversationDebugData> {
    const context = (await unauthenticatedContext.actor.authenticate()).actor.authorizeSession();

    const [, claudeAccountId] = await runAllPromises([
        // Safety check: make sure the actor has access to the space.
        authorizeSpaceAccess(context, spaceId),

        getBotAccountIdForSpaceIfExists(context, claudeKnownBotId, spaceId),
    ]);

    if (!claudeAccountId) {
        return {
            botAccountId: null,
            sandboxId: null,
            sessionId: null,
            projectKey: null,
            state: null,
            conversationItems: [],
            items: [],
        };
    }

    const accessToken =
        await context.loader.tokenAgent.privateSide.dangerouslySignShortLivedTokenForBotConversationState(
            {
                type: "Bot",
                spaceId,
                accountId: claudeAccountId,
                // VERY IMPORTANT: scope to the actor's account so the debugger only ever exposes
                // what the actor could already see — never the bot's full access. (Mirrors the
                // ChatGPT loader.)
                scope: {type: "Account", accountId: context.actor.getAccountId()},
            },
        );

    const claudeAgentServiceUrl = assertExists(
        process.env.NODE_ENV === "production"
            ? context.loader.agentV2ServiceUrl
            : context.loader.agentServiceUrl,
        "Can\u2019t debug Claude if its agent service URL isn\u2019t set",
    );

    const url = new URL(`${claudeAgentServiceUrl}/claude/conversation-state`);
    url.searchParams.set("accountId", claudeAccountId);
    url.searchParams.set("roomPath", printApiMessageRoomPath(room));
    url.searchParams.set("accessToken", accessToken);

    const conversationState = await fetchWithTracer(
        context.tracer.getRoot(),
        url,
        {
            serviceName: "AgentV2Service",
            route: "/claude/conversation-state",
        },
        async response => {
            const result = ClaudeConversationStateResponseSchema.deserialize(await response.json());
            if (!result.ok) throw result.error;
            return result;
        },
    );

    return {
        botAccountId: claudeAccountId,
        sandboxId: conversationState.sandboxId,
        sessionId: conversationState.sessionId,
        projectKey: conversationState.projectKey,
        state: conversationState.state,
        conversationItems: await getAgentConversationDebugItemsForClaudeSession(
            conversationState.items,
        ),
        items: conversationState.items,
    };
}
