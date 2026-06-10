import {uploadDemoSpaceBotAvatar} from "~/admin/environment/demo_space/upload_demo_space_bot_avatar.js";
import {createDebug} from "~/admin/helpers/create_debug.js";
import {TestBot} from "~/server/bots/test_helpers/test_bot.js";
import {TestSpaceSession} from "~/server/spaces/test_helpers/test_space_session.js";
import {TokenAgent} from "~/server/tokens/token_agent.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {ApiKey} from "~/shared/id/api_key.js";

const debug = createDebug(import.meta.url);

export async function createDemoMockBots(
    session: TestSpaceSession,
    tokenAgent: TokenAgent,
    services?: {
        getAgentServicePort(): number;
        getMockChatGptLocalUnscopedApiKey(): Promise<ApiKey>;
        getMockCursorLocalUnscopedApiKey(): Promise<ApiKey>;
    },
) {
    const [{chatGpt}, {cursor}] = await runAllPromises([
        createDemoMockChatGptBot(session, tokenAgent, services),
        createDemoMockCursorBot(session, tokenAgent, services),
    ]);

    return {chatGpt, cursor};
}

export async function createDemoMockChatGptBot(
    session: TestSpaceSession,
    tokenAgent: TokenAgent,
    services?: {
        getAgentServicePort(): number;
        getMockChatGptLocalUnscopedApiKey(): Promise<ApiKey>;
    },
) {
    debug("Creating mock ChatGPT bot");

    const bot = await TestBot.create(session.context, {
        name: "ChatGPT",
        webhookUrl: services
            ? `http://localhost:${services.getAgentServicePort()}/mock/chat-gpt/webhook`
            : undefined,
    });

    if (services) {
        const apiKey = await services.getMockChatGptLocalUnscopedApiKey();
        await bot.createUnscopedApiKey(apiKey);
    }

    const botAccount = await bot.instantiate(session);

    await uploadDemoSpaceBotAvatar(tokenAgent, session, bot.id, "chatGpt");

    debug("Created mock ChatGPT bot");

    return {chatGpt: botAccount};
}

export async function createDemoMockCursorBot(
    session: TestSpaceSession,
    tokenAgent: TokenAgent,
    services?: {
        getAgentServicePort(): number;
        getMockCursorLocalUnscopedApiKey(): Promise<ApiKey>;
    },
) {
    debug("Creating mock Cursor bot");

    const bot = await TestBot.create(session.context, {
        name: "Cursor",
        webhookUrl: services
            ? `http://localhost:${services.getAgentServicePort()}/mock/cursor/webhook`
            : undefined,
    });

    if (services) {
        const apiKey = await services.getMockCursorLocalUnscopedApiKey();
        await bot.createUnscopedApiKey(apiKey);
    }

    const botAccount = await bot.instantiate(session);

    await uploadDemoSpaceBotAvatar(tokenAgent, session, bot.id, "cursor");

    debug("Created mock Cursor bot");

    return {cursor: botAccount};
}
