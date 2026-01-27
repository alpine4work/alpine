import {useMemo} from "react";
import {useAccountModel} from "~/client/web/accounts/account_registry_context.js";
import {BotSettingsAccount} from "~/shared/bots/bot_settings_account_schema.js";
import {SettingsDefaultKnownBotAccountModelDataBase} from "~/shared/bots/settings_default_known_bot_account_model_data_types.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";

export function useBotSettingsAccount(
    account: BotSettingsAccount,
): SettingsDefaultKnownBotAccountModelDataBase {
    const accountData = useAccountModel(account.type === "Exists" ? account.account : null);

    return useMemo(() => {
        switch (account.type) {
            case "Exists": {
                assert(accountData);

                return {
                    ...accountData,
                    // Use the `defaultAccountData` avatar if it exists since it'll be SVG and so
                    // scales to large sizes. Unlike the small AVIF file we usually include in
                    // `AccountModel`.
                    avatar: account.defaultAccountData?.avatar ?? accountData.avatar,
                };
            }
            case "OnlyDefaultExists": {
                return account.defaultAccountData;
            }
            default:
                throw exhaustive(account);
        }
    }, [account, accountData]);
}
