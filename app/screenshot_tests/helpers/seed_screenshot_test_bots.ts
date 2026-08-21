import {uploadDemoSpaceBotAvatar} from "~/admin/environment/demo_space/upload_demo_space_bot_avatar.js";
import {TestServices} from "~/admin/environment/test/integration/with_integration_test_environment.js";
import {TestActualContext} from "~/admin/environment/test/unit/with_unit_test_environment.js";
import {createDebug} from "~/admin/helpers/create_debug.js";
import {dangerouslyGetBotWithAvatarWithoutAuthorizationIfExists} from "~/server/bots/dangerously_get_bot_with_avatar_without_authorization.js";
import {seedTestBots} from "~/server/bots/test_helpers/seed_test_bots.js";
import {getDynamoSeedConstants} from "~/server/dynamo/core/dynamo_seed_constants.js";
import {TestAccount} from "~/server/spaces/test_helpers/test_account.js";
import {TestSession} from "~/server/spaces/test_helpers/test_session.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.open_source.js";

const debug = createDebug(import.meta.url);

export async function seedScreenshotTestBots(context: TestActualContext, services: TestServices) {
    const {chatGptBotId, claudeBotId, cursorBotId, mockChatGptBotId} = getDynamoSeedConstants();

    // If all the bots and their avatars already exist, we don't need to seed them
    // again. This performance optimization is meaningful since avatar upload can be
    // slow.
    const cacheContext = context.withCache();
    if (
        (await dangerouslyGetBotWithAvatarWithoutAuthorizationIfExists(cacheContext, chatGptBotId))
            ?.avatar &&
        (await dangerouslyGetBotWithAvatarWithoutAuthorizationIfExists(cacheContext, claudeBotId))
            ?.avatar &&
        (await dangerouslyGetBotWithAvatarWithoutAuthorizationIfExists(cacheContext, cursorBotId))
            ?.avatar &&
        (
            await dangerouslyGetBotWithAvatarWithoutAuthorizationIfExists(
                cacheContext,
                mockChatGptBotId,
            )
        )?.avatar
    ) {
        return;
    }

    debug("Creating bots");

    const internalAccount = await TestAccount.create(context, {hasInternalAccess: true});
    const internalSession = await TestSession.create(internalAccount);

    // Seed our bots in the database so they can show up in screenshots.
    await seedTestBots(cacheContext, {
        agentServiceLocalPort: services.getAgentServicePort(),
        mockChatGptLocalUnscopedApiKey: await services.getMockChatGptLocalUnscopedApiKey(),

        // You can't actually run our ChatGPT, Claude, or Cursor bots in the integration
        // test environment because we don't want to make real requests to model providers.
        // To take a screenshot use the mock ChatGPT agent.
        chatGptLocalUnscopedApiKey: null,
        chatGptLocalScopedApiKey: null,
        claudeLocalUnscopedApiKey: null,
        cursorLocalUnscopedApiKey: null,
    });

    debug("Created bots");

    await runAllPromises([
        uploadDemoSpaceBotAvatar(
            services.getAppServiceTokenAgent(),
            internalSession,
            chatGptBotId,
            "chatGpt",
        ),
        uploadDemoSpaceBotAvatar(
            services.getAppServiceTokenAgent(),
            internalSession,
            claudeBotId,
            "claude",
        ),
        uploadDemoSpaceBotAvatar(
            services.getAppServiceTokenAgent(),
            internalSession,
            cursorBotId,
            "cursor",
        ),
        uploadDemoSpaceBotAvatar(
            services.getAppServiceTokenAgent(),
            internalSession,
            mockChatGptBotId,
            "chatGpt",
        ),
    ]);

    debug("Uploaded bot avatars");
}
