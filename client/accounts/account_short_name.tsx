import {useMemo} from "react";
import {useAccountModel} from "~/client/accounts/account_client_store_context_provider.js";
import {parseAccountName} from "~/client/accounts/internal/parse_account_name.js";
import {OverlayPlacement} from "~/client/design/overlay.js";
import {Tooltip} from "~/client/design/tooltip.js";
import {AccountModel, AccountModelData} from "~/shared/accounts/account_model.js";

export function AccountShortName({
    account,
    tooltipPlacement,
    className,
}: {
    account: AccountModel | AccountModelData;
    tooltipPlacement?: OverlayPlacement;
    className?: string;
}) {
    const accountData = useAccountModel(account);

    const shortName = useMemo(
        () => getAccountShortNameWithoutFullNameTooltip(accountData),
        [accountData],
    );

    // NOTE(calebmer): Someday I'd like to have an account card that shows up on
    // hover of avatar or name.
    return (
        <Tooltip content={accountData.name} placement={tooltipPlacement}>
            <span className={className}>{shortName}</span>
        </Tooltip>
    );
}

/**
 * Shorter version of the account's name. If the account has a name formatted
 * like most English names this will just be the first name. We may allow this
 * to be configurable in the future.
 */
export function getAccountShortNameWithoutFullNameTooltip(accountData: AccountModelData): string {
    const {firstName} = parseAccountName(accountData);
    return firstName;
}
