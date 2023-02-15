import {useMemo} from "react";
import {parseAccountName} from "~/client/accounts/internal/parse_account_name";
import {Tooltip} from "~/client/design/tooltip";
import {AccountModel} from "~/shared/models/account_model";

/**
 * Shorter version of the account's name. If the account has a name formatted
 * like most English names this will just be the first name.
 */
export function AccountShortName({account}: {account: AccountModel}) {
    const firstName = useMemo(() => parseAccountName(account).firstName, [account]);

    return (
        <Tooltip content={account.name}>
            <span>{firstName}</span>
        </Tooltip>
    );
}
