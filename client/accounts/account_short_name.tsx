import {useMemo} from "react";
import {parseAccountName} from "~/client/accounts/internal/parse_account_name.js";
import {OverlayPlacement} from "~/client/design/overlay.js";
import {Tooltip} from "~/client/design/tooltip.js";
import {AccountModel} from "~/shared/accounts/account_model.js";

export function AccountShortName({
    account,
    tooltipPlacement,
}: {
    account: AccountModel;
    tooltipPlacement?: OverlayPlacement;
}) {
    const shortName = useMemo(() => getAccountShortNameWithoutFullNameTooltip(account), [account]);

    // NOTE(calebmer): Someday I'd like to have an account card that shows up on
    // hover of avatar or name.
    return (
        <Tooltip content={account.name} placement={tooltipPlacement}>
            <span>{shortName}</span>
        </Tooltip>
    );
}

/**
 * Shorter version of the account's name. If the account has a name formatted
 * like most English names this will just be the first name. We may allow this
 * to be configurable in the future.
 */
export function getAccountShortNameWithoutFullNameTooltip(account: AccountModel): string {
    const {firstName} = parseAccountName(account);
    return firstName;
}
