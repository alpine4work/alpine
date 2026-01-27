import {seedTestAccounts} from "~/server/accounts/seed_test_accounts.js";
import {seedTestBots} from "~/server/bots/seed_test_bots.js";
import {SearchInjectionContextModule} from "~/server/context/injection_context_module.js";
import {DynamoContextModules} from "~/server/dynamo/core/dynamo_context.js";
import {seedTestChannels} from "~/server/forum/data/seed_test_channels.js";
import {JobsContextModule} from "~/server/jobs/core/jobs_context_module.js";
import {seedTestBotAccounts} from "~/server/spaces/seed_test_bot_accounts.js";
import {seedTestSpaces} from "~/server/spaces/seed_test_spaces.js";
import {Context} from "~/shared/context/context.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {assert} from "~/shared/helpers/control/assert.js";

/**
 * Seed DynamoDB with some data in development and test environments.
 *
 * This seed function is idempotent. You may run it however many times you want
 * and it will keep working.
 */
// TODO(calebmer): I'd love to delete this entirely when we have a proper space
// creation/onboarding flow and run that flow instead.
export function seedDynamo(
    context: Context<
        DynamoContextModules & {
            jobs: JobsContextModule;
            searchInjection: SearchInjectionContextModule;
        }
    >,
    options: {
        agentServiceLocalPort: string;
        chatGptLocalUnscopedApiKey: string;
        chatGptLocalScopedApiKey: string;
        cursorLocalUnscopedApiKey: string;
        mockChatGptLocalUnscopedApiKey: string;
    },
): Promise<void> {
    assert(process.env.NODE_ENV !== "production");

    return context.tracer.withSpan("Seed DynamoDB test data", async context => {
        // Make sure accounts exist since everything that follows depends
        // on accounts:
        await seedTestAccounts(context);

        // Make sure spaces exist since everything that follows depends on
        // the spaces:
        await seedTestSpaces(context);

        await runAllPromises([
            seedTestChannels(context),
            seedTestBots(context, options).then(() => seedTestBotAccounts(context)),
        ]);
    });
}
