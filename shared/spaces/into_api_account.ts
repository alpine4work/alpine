import {getAccountShortNameWithoutFullNameTooltip} from "~/shared/accounts/get_account_short_name_without_full_name_tooltip.js";
import {ApiAccount} from "~/shared/api/specification/types/api_specification_convenience_types.open_source.js";
import {serializeDateString} from "~/shared/helpers/date/date_string.open_source.js";
import {AccountModelData} from "~/shared/spaces/account_model.js";

export function intoApiAccount(account: Omit<AccountModelData, "avatar">): ApiAccount {
    return {
        id: account.id,
        name: account.name,
        shortName: getAccountShortNameWithoutFullNameTooltip(account),
        bot: account.botId !== undefined ? {id: account.botId} : undefined,
        space: {
            role: account.space.role,
            addedTime: serializeDateString(account.space.addedTime),
            inactive:
                account.space.state.type === "Active"
                    ? undefined
                    : account.space.state.type === "InvitePending"
                      ? {type: "InvitePending"}
                      : {
                            type: "Removed",
                            removedTime: serializeDateString(account.space.state.removedTime),
                        },
        },
    };
}
