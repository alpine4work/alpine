import {useMemo} from "react";
import {useAccountModel} from "~/client/accounts/account_client_store_context_provider.js";
import {OverlayPlacement} from "~/client/design/overlay.js";
import {Tooltip} from "~/client/design/tooltip.js";
import {AccountModel, AccountModelData} from "~/shared/accounts/account_model.js";
import {getAccountShortNameWithoutFullNameTooltip} from "~/shared/accounts/get_account_short_name_without_full_name_tooltip.js";

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
