import {useMemo} from "react";
import {useAccountModel} from "~/client/web/accounts/account_registry_context.js";
import {OverlayPlacement} from "~/client/web/design/overlay.js";
import {Tooltip} from "~/client/web/design/tooltip.js";
import {getAccountShortNameWithoutFullNameTooltip} from "~/shared/accounts/get_account_short_name_without_full_name_tooltip.js";
import {AccountModel, AccountModelData} from "~/shared/spaces/account_model.js";

export function AccountShortName({
    account,
    tooltipPlacement,
    className,
    isTooltipDisabled,
}: {
    account: AccountModel | AccountModelData;
    tooltipPlacement?: OverlayPlacement;
    className?: string;
    isTooltipDisabled?: boolean;
}) {
    const accountData = useAccountModel(account);

    const shortName = useMemo(
        () => getAccountShortNameWithoutFullNameTooltip(accountData),
        [accountData],
    );

    // NOTE(calebmer): Someday I'd like to have an account card that shows up on hover
    // of avatar or name.
    return (
        <Tooltip
            isDisabled={isTooltipDisabled}
            content={accountData.name}
            placement={tooltipPlacement}
        >
            <span className={className}>{shortName}</span>
        </Tooltip>
    );
}
