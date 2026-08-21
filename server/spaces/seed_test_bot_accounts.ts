import {DynamoContextModules} from "~/server/dynamo/core/dynamo_context.js";
import {getDynamoSeedConstants} from "~/server/dynamo/core/dynamo_seed_constants.js";
import {DynamoTableSchema} from "~/server/dynamo/core/dynamo_table_schema.js";
import {isDynamoConditionCheckError} from "~/server/dynamo/core/is_dynamo_condition_check_error.js";
import {JobsContextModule} from "~/server/jobs/core/jobs_context_module.js";
import {internalDangerouslyCreateInstallBotInSpaceTransactionEntries} from "~/server/spaces/install_bot_in_space.js";
import {CacheContextModule} from "~/shared/context/cache_context_module.js";
import {Context} from "~/shared/context/context.js";
import {runAllPromiseThunks} from "~/shared/helpers/async/run_all_promises.open_source.js";
import {assert} from "~/shared/helpers/control/assert.open_source.js";

export async function seedTestBotAccounts(
    context: Context<DynamoContextModules & {jobs: JobsContextModule}>,
) {
    assert(process.env.NODE_ENV !== "production");
    const {
        defaultSpaceId,
        chatGptBotId,
        chatGptBotAccountIdForDefaultSpace,
        claudeBotId,
        claudeBotAccountIdForDefaultSpace,
        cursorBotId,
        cursorBotAccountIdForDefaultSpace,
    } = getDynamoSeedConstants();

    const currentTime = new Date();

    // Seeding runs on a process context which doesn't have the action level cache that
    // reads expect. Give the seed its own cache with a lifetime of this function.
    await context.with(
        {cache: CacheContextModule.new()},
        async context =>
            await runAllPromiseThunks(
                async () => {
                    try {
                        const {transactionEntries} =
                            await internalDangerouslyCreateInstallBotInSpaceTransactionEntries(
                                context,
                                {
                                    currentTime,
                                    spaceId: defaultSpaceId,
                                    botId: chatGptBotId,
                                    accountId: chatGptBotAccountIdForDefaultSpace,
                                },
                            );

                        await DynamoTableSchema.executeTransaction(context, transactionEntries);
                    } catch (error) {
                        // If the data already exists in the database, return without error.
                        if (isDynamoConditionCheckError(error)) return;

                        throw error;
                    }
                },
                async () => {
                    try {
                        const {transactionEntries} =
                            await internalDangerouslyCreateInstallBotInSpaceTransactionEntries(
                                context,
                                {
                                    currentTime,
                                    spaceId: defaultSpaceId,
                                    botId: claudeBotId,
                                    accountId: claudeBotAccountIdForDefaultSpace,
                                },
                            );

                        await DynamoTableSchema.executeTransaction(context, transactionEntries);
                    } catch (error) {
                        // If the data already exists in the database, return without error.
                        if (isDynamoConditionCheckError(error)) return;

                        throw error;
                    }
                },
                async () => {
                    try {
                        const {transactionEntries} =
                            await internalDangerouslyCreateInstallBotInSpaceTransactionEntries(
                                context,
                                {
                                    currentTime,
                                    spaceId: defaultSpaceId,
                                    botId: cursorBotId,
                                    accountId: cursorBotAccountIdForDefaultSpace,
                                },
                            );

                        await DynamoTableSchema.executeTransaction(context, transactionEntries);
                    } catch (error) {
                        // If the data already exists in the database, return without error.
                        if (isDynamoConditionCheckError(error)) return;

                        throw error;
                    }
                },
            ),
    );
}
