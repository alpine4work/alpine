import GraphemeSplitter from "grapheme-splitter";
import {useMemo} from "react";
import {useAccountModel} from "~/client/accounts/account_client_store_context_provider.js";
import {parseAccountName} from "~/client/accounts/internal/parse_account_name.js";
import {Box} from "~/client/design/box.js";
import {AccountModel, AccountModelData} from "~/shared/accounts/account_model.js";
import {Spacing} from "~/shared/design/spacing.js";

/**
 * A circular image representing the account.
 */
export function AccountAvatar({account, size}: {account: AccountModel; size: Spacing}) {
    const accountData = useAccountModel(account);
    return <AccountDataAvatar accountData={accountData} size={size} />;
}

export function AccountDataAvatar({
    accountData,
    size,
}: {
    accountData: AccountModelData;
    size: Spacing;
}) {
    const {firstInitial, lastInitial} = useMemo(() => {
        const splitter = new GraphemeSplitter();

        const {firstName, lastName} = parseAccountName(accountData);

        // We use iterators instead of indexing into the name because iterators give us
        // full Unicode unicode code points. This means grapheme clusters will be
        // split, but surrogate pairs will be preserved.
        //
        // https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/String/@@iterator
        const firstInitial: string = splitter.iterateGraphemes(firstName).next().value;
        const lastInitial: string | null = lastName
            ? splitter.iterateGraphemes(lastName).next().value
            : null;

        return {firstInitial, lastInitial};
    }, [accountData]);

    return (
        <Box
            flexShrink="0"
            width={size}
            height={size}
            backgroundColor="grey-30-const"
            borderRadius="full"
            display="flex"
            justifyContent="center"
            alignItems="center"
            color="grey-80-const"
            position="relative"
            zIndex="0"
        >
            <Box
                fontSize="75"
                style={{transform: `scale(${parseInt(size, 10) / 8})`}}
                aria-hidden="true"
            >
                {firstInitial.toUpperCase()}
                {lastInitial?.toUpperCase()}
            </Box>
        </Box>
    );
}
