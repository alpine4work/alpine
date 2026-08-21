import {BotsTable} from "~/server/bots/internal/bots_table.js";
import {getBotItemForAuthorizationIfExists} from "~/server/bots/internal/get_bot_item_for_authorization.js";
import {initialBotSettingsItem} from "~/server/bots/internal/initial_bot_settings_item.js";
import {ServerAuthenticatedActionContext} from "~/server/context/server_action_context.js";
import {DynamoTableSchema} from "~/server/dynamo/core/dynamo_table_schema.js";
import {DynamoTransactionEntry} from "~/server/dynamo/core/dynamo_transaction_entry.js";
import {authorizeBotOperation} from "~/server/spaces/authorize_bot_operation.js";
import {createBotNotFoundError} from "~/shared/bots/bot_error_messages.js";
import {createSimpleContent, emptySimpleContent} from "~/shared/content/simple_content_schema.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.open_source.js";
import {BotId} from "~/shared/id/types/id_types.open_source.js";

/**
 * Update the attributes of a bot that the actor has access to.
 *
 * Renaming a bot propagates the new name to the bot's instantiated space accounts
 * asynchronously via the `Name` case of `processUpdateBotAccountsJob()`. The bot
 * item is updated synchronously, so accounts created after the rename already use
 * the new name.
 */
export async function updateBot(
    context: ServerAuthenticatedActionContext,
    {
        botId,
        name,
        description,
        webhook,
    }: {
        botId: BotId;
        name: string;
        // `undefined` leaves the existing description untouched, `null` clears it, a
        // string sets it.
        description?: string | null;
        // `null` clears the webhook entirely. Otherwise the webhook is (re)created from
        // `url`, and `secret` follows the same three-way convention as `description`.
        webhook: {
            url: string;
            secret?: string | null;
        } | null;
    },
): Promise<void> {
    await authorizeBotOperation(context, botId, {type: "Manage"});

    const currentTime = new Date();

    const {didNameChange} = await context.dynamo.retryTransaction(async context => {
        const [botItem, settingsItem] = await runAllPromises([
            getBotItemForAuthorizationIfExists(context, botId),
            BotsTable.getItemIfExists(context, {
                partitionType: "Bot",
                sortRangeType: "SettingsSchema",
                botId,
            }),
        ]);
        if (!botItem) throw createBotNotFoundError(botId);

        const didNameChange = botItem.name !== name;

        // A `null` `webhook` clears the webhook entirely. Otherwise we (re)create the
        // webhook, resolving the secret from `webhook.secret`:
        //
        // - `undefined`: leave the existing secret untouched.
        // - `null`: clear the secret.
        // - a string: set the secret.
        const newWebhook =
            webhook === null
                ? null
                : {
                      url: webhook.url,
                      secret:
                          webhook.secret === undefined
                              ? (botItem.webhook?.secret ?? null)
                              : webhook.secret,
                  };

        const transactionEntries: Array<DynamoTransactionEntry> = [
            BotsTable.transactionDirectlyUpdateItem({
                ...botItem,
                name,
                webhook: newWebhook,
                updatedTime: currentTime,
            }),
        ];

        // The description lives on the `SettingsSchema` item. Preserve any existing
        // settings `schema` and just replace the description (owner-authored plain text
        // stored as simple content). A `undefined` description leaves the stored value
        // untouched.
        //
        // Written in the same transaction as the attributes above so a bot never ends up
        // renamed with a stale description (or vice versa).
        if (description !== undefined) {
            const newDescription =
                description !== null ? createSimpleContent(description) : emptySimpleContent;
            transactionEntries.push(
                settingsItem
                    ? BotsTable.transactionDirectlyUpdateItem({
                          ...settingsItem,
                          description: newDescription,
                      })
                    : BotsTable.transactionCreateItem({
                          partitionType: "Bot",
                          sortRangeType: "SettingsSchema",
                          botId,
                          ...initialBotSettingsItem,
                          description: newDescription,
                      }),
            );
        }

        await DynamoTableSchema.executeTransaction(context, transactionEntries);

        return {didNameChange};
    });

    // Propagate the new name to the bot's instantiated space accounts. Enqueued after
    // the bot item update commits so the job reads the new name. Only send the job
    // when the name actually changed to avoid needless work.
    if (didNameChange) {
        await context.jobs.dangerouslySendMaintenance({
            type: "UpdateBotAccounts",
            botId,
            update: {type: "Name"},
        });
    }
}
