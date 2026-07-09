import {TestBotAccount} from "~/server/bots/test_helpers/test_bot.js";
import {MockAgentRecording} from "~/shared/agents/mock_agent_recording.js";
import {ApiMessageRoomPath} from "~/shared/api/specification/parse_api_path.js";
import {UnknownError} from "~/shared/error/error.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {fetchWithTracer} from "~/shared/tracer/fetch_with_tracer.js";

export async function putMockAgentRecording(
    bot: "chat-gpt" | "cursor",
    botAccount: TestBotAccount,
    roomPath: ApiMessageRoomPath,
    recording: MockAgentRecording,
) {
    const botItem = await botAccount.bot.getItem();
    const webhook = assertExists(botItem.webhook);

    const url = new URL(`/mock/${bot}/recording`, webhook.url);

    url.searchParams.set("accountId", botAccount.id);
    url.searchParams.set("roomPath", roomPath);

    await fetchWithTracer(
        botAccount.context.tracer.getTracer(),
        url,
        {
            serviceName: "AgentService",
            route: `/mock/${bot}/recording`,
            method: "PUT",
            headers: {"content-type": "application/json"},
            body: JSON.stringify(recording),
        },
        async request => {
            if (!request.ok) {
                throw new UnknownError(
                    `Failed to put mock agent recording with status code ${request.status}`,
                );
            }
        },
    );
}
