import {useMemo} from "react";
import {Box} from "~/client/design/box";
import {assert} from "~/shared/helpers/control/assert";
import {AccountModel} from "~/shared/models/account_model";

export function AccountAvatar({
    account,
    size = "8",
}: {
    account: AccountModel;
    size?: "6" | "8" | "10";
}) {
    const {firstInitial, lastInitial} = useMemo(() => {
        assert(account.name.length > 0);
        const nameParts = account.name.split(/\p{White_Space}/u);
        assert(nameParts.length > 0);
        const firstNamePart = nameParts[0]!;
        const lastNamePart = nameParts.length > 1 ? nameParts[nameParts.length - 1]! : null;

        const firstInitial: string = firstNamePart[Symbol.iterator]().next().value;
        const lastInitial: string | null = lastNamePart
            ? lastNamePart[Symbol.iterator]().next().value
            : null;

        return {firstInitial, lastInitial};
    }, [account.name]);

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
                fontSize="xs"
                style={{letterSpacing: "0.05em", transform: `scale(${parseInt(size, 10) / 8})`}}
            >
                {firstInitial.toUpperCase()}
                {lastInitial?.toUpperCase()}
            </Box>
        </Box>
    );
}
