import {useMemo} from "react";
import {parseAccountName} from "~/client/accounts/internal/parse_account_name";
import {Box} from "~/client/design/box";
import {AccountModel} from "~/shared/models/account_model";

/**
 * A circular image representing the account.
 */
export function AccountAvatar({
    account,
    size = "8",
}: {
    account: AccountModel;
    size?: "5" | "6" | "7" | "8" | "10";
}) {
    const {firstInitial, lastInitial} = useMemo(() => {
        const {firstName, lastName} = parseAccountName(account);

        // We use iterators instead of indexing into the name because iterators give us
        // full Unicode unicode code points. This means grapheme clusters will be
        // split, but surrogate pairs will be preserved.
        //
        // https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/String/@@iterator
        const firstInitial: string = firstName[Symbol.iterator]().next().value;
        const lastInitial: string | null = lastName
            ? lastName[Symbol.iterator]().next().value
            : null;

        return {firstInitial, lastInitial};
    }, [account]);

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
