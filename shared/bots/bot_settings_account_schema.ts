import {SettingsDefaultKnownBotAccountModelDataSchema} from "~/shared/bots/settings_default_known_bot_account_model_data_types.js";
import {Schema, SchemaType} from "~/shared/schema/schema.js";
import {AccountModel} from "~/shared/spaces/account_model.js";

export type BotSettingsAccount = SchemaType<typeof BotSettingsAccountSchema>;

export const BotSettingsAccountSchema = Schema.union({
    Exists: Schema.object({
        type: Schema.value("Exists"),
        account: AccountModel.schema,
        defaultAccountData: SettingsDefaultKnownBotAccountModelDataSchema.nullable(),
    }),
    OnlyDefaultExists: Schema.object({
        type: Schema.value("OnlyDefaultExists"),
        defaultAccountData: SettingsDefaultKnownBotAccountModelDataSchema,
    }),
});
