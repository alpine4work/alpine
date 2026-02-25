import {ServerActionContext} from "~/server/context/server_action_context.js";
import {
    AccountModelWithoutSpace,
    AccountModelWithoutSpaceData,
} from "~/shared/accounts/account_model_without_space.js";
import {getAccountShortNameWithoutFullNameTooltip} from "~/shared/accounts/get_account_short_name_without_full_name_tooltip.js";
import {joinPrettyConjunctionList} from "~/shared/design/join_pretty_conjunction_list.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {defaultLocale} from "~/shared/helpers/intl/locale.js";
import {printPrettyNumber} from "~/shared/helpers/number/print_pretty_number.js";

/**
 * Number of accounts rendered in a chat search entity title.
 */
export const searchChatEntityResultTitlePreviewAccountCount = 2;

export function prepareSearchDirectChatEntityTitleForResult(
    actorType: ServerActionContext["actor"]["type"],
    {
        previewAccounts,
        accountCount,
    }: {
        previewAccounts: ReadonlyArray<AccountModelWithoutSpace | AccountModelWithoutSpaceData>;
        accountCount: number | null;
    },
) {
    const actualPreviewAccounts = previewAccounts.slice(
        0,
        searchChatEntityResultTitlePreviewAccountCount,
    );

    const accountNames = actualPreviewAccounts.map(account =>
        getAccountShortNameWithoutFullNameTooltip(
            "initialData" in account ? account.initialData : account,
        ),
    );

    if (accountCount === null) {
        accountNames.push("others");
    } else {
        let assumeActorIncludedInAccountCount: boolean;

        switch (actorType) {
            case "Session":
            case "ImpersonatedAccount":
                assumeActorIncludedInAccountCount = true;
                break;
            case "System":
            case "Anonymous":
            case "Bot":
                assumeActorIncludedInAccountCount = false;
                break;
            default:
                throw exhaustive(actorType);
        }

        // Subtract 1 from the account count if this is a session actor since the
        // "others" count should exclude the actor. We are assuming the actor is in
        // this chat. This is a safe assumption since the actor isn't allowed to access
        // direct chats they're not in.
        const actualAccountCount = assumeActorIncludedInAccountCount
            ? accountCount - 1
            : accountCount;

        if (actualAccountCount > actualPreviewAccounts.length) {
            accountNames.push(
                printPrettyNumber(
                    defaultLocale,
                    actualAccountCount - actualPreviewAccounts.length,
                    "other",
                ),
            );
        }
    }

    return joinPrettyConjunctionList(accountNames, "and");
}
