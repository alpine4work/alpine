import GraphemeSplitter from "grapheme-splitter";
import {useMemo} from "react";
import {useAccountModel} from "~/client/accounts/account_client_store_context_provider.js";
import {parseAccountName} from "~/client/accounts/internal/parse_account_name.js";
import {AccountModel, AccountModelData} from "~/shared/accounts/account_model.js";
import {Spacing, spacing} from "~/shared/design/spacing.js";
import {sprinkles} from "~/shared/styles/styles.js";

const avatarClassName = sprinkles({
    flexShrink: "0",
    backgroundColor: "grey-30-const",
    borderRadius: "full",
    display: "flex",
    justifyContent: "center",
    alignItems: "center",
    color: "grey-80-const",
    position: "relative",
    zIndex: "0",
});

const initialsClassName = sprinkles({
    fontSize: "75",
});

// This component is rendered in hot paths (like `<TaskRowView>`) avoid using
// `<Box>` until we implement a transform that automatically inlines `<Box>`.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const Box = null;

/**
 * A circular image representing the account.
 */
export function AccountAvatar({
    account,
    size,
}: {
    account: AccountModel | AccountModelData;
    size: Spacing;
}) {
    // This component is rendered in hot paths (like `<TaskRowView>`) avoid using
    // `sprinkles()` in the component's render function until we implement a
    // transform that automatically inlines `sprinkles()`.
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const sprinkles = null;

    const accountData = useAccountModel(account);

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
        <div className={avatarClassName} style={{width: spacing[size], height: spacing[size]}}>
            <div
                className={initialsClassName}
                style={{transform: `scale(${parseInt(size, 10) / 8})`}}
                aria-hidden="true"
            >
                {firstInitial.toUpperCase()}
                {lastInitial?.toUpperCase()}
            </div>
        </div>
    );
}
