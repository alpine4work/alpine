import {ShouldRevalidateFunction} from "@remix-run/router";
import {
    deserializeBotIdForLoader,
    deserializeSpaceIdForLoader,
} from "~/app/helpers/deserialize_id_for_loader.js";
import {CustomBotSettingsView} from "~/client/web/bots/custom_bot_settings_view.js";
import {KnownBotSettingsView} from "~/client/web/bots/known_bot_settings_view.js";
import {useLoaderDataWithSchema} from "~/client/web/remix/use_loader_data_with_schema.js";
import {settingsDefaultKnownBotAccountModelDataById} from "~/server/bots/settings_default_known_bot_account_model_data.js";
import {getBotScopedApiKeys} from "~/server/bots/with_spaces/get_bot_scoped_api_keys.js";
import {getBotSettingsForManagement} from "~/server/bots/with_spaces/get_bot_settings_for_management.js";
import {getBotSpaceAndSpaceAccountSettingsValues} from "~/server/bots/with_spaces/get_bot_space_and_space_account_settings_values.js";
import {getBotUnscopedApiKeys} from "~/server/bots/with_spaces/get_bot_unscoped_api_keys.js";
import {getKnownBotSettingsAccount} from "~/server/bots/with_spaces/get_known_bot_settings_account.js";
import {jsonWithSchema} from "~/server/remix/json_with_schema.js";
import {LoaderArgs} from "~/server/remix/loader_context.js";
import {getAllowedBotOperations} from "~/server/spaces/authorize_bot_operation.js";
import {getBotAccountIdForSpaceIfExists} from "~/server/spaces/get_bot_account_id_for_space_if_exists.js";
import {BotOperationTypeSchema} from "~/shared/bots/bot_operation.js";
import {BotSchema} from "~/shared/bots/bot_schema.js";
import {BotSettingsAccountSchema} from "~/shared/bots/bot_settings_account_schema.js";
import {BotSettingsSchemaSchema} from "~/shared/bots/bot_settings_schema.js";
import {BotTokenScope} from "~/shared/bots/bot_token_scope.js";
import {BotOwnerEntitySchema} from "~/shared/bots/owners/bot_owner_entity.js";
import {SimpleContentWithReferencesSchema} from "~/shared/content/simple_content_schema.js";
import {NotFoundError} from "~/shared/error/error.open_source.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.open_source.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.open_source.js";
import {Schema} from "~/shared/schema/schema.js";

const KnownBotSettingsPageSchema = Schema.object({
    type: Schema.value("Known"),
    botAccount: BotSettingsAccountSchema,
    botSettings: Schema.object({
        description: SimpleContentWithReferencesSchema,
        schema: BotSettingsSchemaSchema,
    }),
    botSpaceSettings: Schema.object({
        valuesVersion: Schema.integer,
        values: Schema.map(Schema.string, Schema.unknown()),
        secretPropertyKeysWithValues: Schema.set(Schema.string),
    }),
    botSpaceAccountSettings: Schema.object({
        valuesVersion: Schema.integer,
        values: Schema.map(Schema.string, Schema.unknown()),
    }),
});

const CustomBotSettingsPageApiKeySchema = Schema.object({
    apiKey: Schema.string,
    name: Schema.string.nullable(),
    scope: Schema.unknown<BotTokenScope>().nullable().optional(),
    createdTime: Schema.date,
});

const CustomBotSettingsPageSchema = Schema.object({
    type: Schema.value("Custom"),
    bot: BotSchema.omit(["description"]),
    ownerEntity: BotOwnerEntitySchema,
    allowedOperations: Schema.set(BotOperationTypeSchema),
    webhook: Schema.object({
        url: Schema.string.nullable(),
        secret: Schema.string.nullable(),
    }),
    scopedApiKeys: Schema.array(CustomBotSettingsPageApiKeySchema),
    unscopedApiKeys: Schema.array(CustomBotSettingsPageApiKeySchema),
});

const LoaderSchema = Schema.object({
    page: Schema.union({
        Known: KnownBotSettingsPageSchema,
        Custom: CustomBotSettingsPageSchema,
    }),
});

// We don't need to reload if the URL doesn't change.
export const shouldRevalidate: ShouldRevalidateFunction = ({
    currentUrl: immutableCurrentUrl,
    nextUrl: immutableNextUrl,
}) => {
    const currentUrl = new URL(immutableCurrentUrl);
    const nextUrl = new URL(immutableNextUrl);

    return nextUrl.toString() !== currentUrl.toString();
};

export async function loader({context: unauthenticatedContext, params}: LoaderArgs) {
    const spaceId = deserializeSpaceIdForLoader(params.spaceId);
    const botId = deserializeBotIdForLoader(params.botId);

    const context = (await unauthenticatedContext.actor.authenticate()).actor.authorizeSession();
    const accountId = context.actor.getAccountId();

    // Known catalog bots (e.g. ChatGPT, Cursor) get the install/uninstall settings
    // page. Everything else is a custom bot managed by its owner.
    if (!settingsDefaultKnownBotAccountModelDataById.get().has(botId)) {
        // TODO (rmtobin, #bot-permissions): There is no non-`Manage` view of a custom bot.
        // Both `getBotSettingsForManagement()` and `getBotScopedApiKeys()` authorize
        // `Manage`, so this loader throws for anyone who can only `View` the bot.
        // `CustomBotSettingsView` already renders read-only when `Manage` is absent, but
        // that path is unreachable until we add a `View`-gated way to load the bot's
        // settings and skip the API keys.
        const [botAccountId, botSettings, scopedApiKeys, unscopedApiKeys, allowedOperations] =
            await runAllPromises([
                getBotAccountIdForSpaceIfExists(context, botId, spaceId),
                getBotSettingsForManagement(context, botId),
                getBotScopedApiKeys(context, {botId, spaceId}),
                getBotUnscopedApiKeys(context, {botId}),
                getAllowedBotOperations(context, botId, {spaceId, accountId}),
            ]);

        // Custom bots get instantiated into a space on creation, so they should always
        // have an account.
        if (botAccountId === null) {
            throw new NotFoundError("Bot account not found");
        }

        return jsonWithSchema(LoaderSchema, {
            page: {
                type: "Custom",
                bot: botSettings.bot,
                ownerEntity: botSettings.ownerEntity,
                webhook: {url: botSettings.webhookUrl, secret: botSettings.webhookSecret},
                scopedApiKeys,
                unscopedApiKeys,
                allowedOperations,
            },
        });
    }

    const [botAccount, botSettings] = await runAllPromises([
        getKnownBotSettingsAccount(context, spaceId, botId, {consistency: "StrongWithinCache"}),
        getBotSpaceAndSpaceAccountSettingsValues(context, spaceId, accountId, botId, {
            consistency: "StrongWithinCache",
        }),
    ]);

    return jsonWithSchema(LoaderSchema, {
        page: {
            type: "Known",
            botAccount,
            botSettings: {
                description: botSettings.description,
                schema: botSettings.schema,
            },
            botSpaceSettings: {
                valuesVersion: botSettings.spaceValuesVersion,
                values: botSettings.spaceValues,
                secretPropertyKeysWithValues: botSettings.spaceSecretPropertyKeysWithValues,
            },
            botSpaceAccountSettings: {
                valuesVersion: botSettings.accountValuesVersion,
                values: botSettings.accountValues,
            },
        },
    });
}

export default function SpaceBotSettingsRoute() {
    const {page} = useLoaderDataWithSchema(LoaderSchema);

    switch (page.type) {
        case "Known":
            return (
                <KnownBotSettingsView
                    botAccount={page.botAccount}
                    botSettings={page.botSettings}
                    botSpaceSettings={page.botSpaceSettings}
                    botSpaceAccountSettings={page.botSpaceAccountSettings}
                />
            );
        case "Custom":
            return (
                <CustomBotSettingsView
                    bot={page.bot}
                    webhook={page.webhook}
                    ownerEntity={page.ownerEntity}
                    unscopedApiKeys={page.unscopedApiKeys}
                    scopedApiKeys={page.scopedApiKeys}
                    allowedOperations={page.allowedOperations}
                />
            );
        default:
            throw exhaustive(page);
    }
}
