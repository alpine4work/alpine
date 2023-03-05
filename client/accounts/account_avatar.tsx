import {useMemo} from "react";
import {parseAccountName} from "~/client/accounts/internal/parse_account_name";
import {Box} from "~/client/design/box";
import {spacing} from "~/shared/design/spacing";
import {AccountModel} from "~/shared/models/account_model";

export type AccountAvatarProps = {
    account: AccountModel;
    size?: "6" | "7" | "8" | "10" | `${number}em`;
};

/**
 * A circular image representing the account.
 */
export function AccountAvatar({account, size = "8"}: AccountAvatarProps) {
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

    const actualSize = size.endsWith("em") ? size : (spacing as any)[size];

    return (
        <Box
            flexShrink="0"
            style={{
                width: actualSize,
                height: actualSize,
                // Don't inherit any CSS from parents! The default avatar (built with HTML)
                // should always look the same no matter what context it is rendering in.
                //
                // Important when rendering as a mention in content since the content could be
                // bold, italicized, whatever.
                all: "initial",
                // Inherit the font-size since we allow sizing the avatar with ems.
                fontSize: "inherit",
            }}
        >
            <Box
                backgroundColor="grey-30-const"
                borderRadius="full"
                display="flex"
                justifyContent="center"
                alignItems="center"
                fontStyle="normal"
                color="grey-80-const"
                position="relative"
                zIndex="0"
                userSelect="none"
                style={{
                    width: actualSize,
                    height: actualSize,
                }}
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
        </Box>
    );
}
