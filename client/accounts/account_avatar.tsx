import GraphemeSplitter from "grapheme-splitter";
import {useMemo} from "react";
import {useAccountModel} from "~/client/accounts/account_client_store_context_provider.js";
import {sprinkles} from "~/client/styles/styles.js";
import {parseAccountNameAssumingWesternNameOrder} from "~/shared/accounts/get_account_short_name_without_full_name_tooltip.js";
import {Spacing, spacing} from "~/shared/design/spacing.js";
import {AccountModel, AccountModelData} from "~/shared/spaces/account_model.js";

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
    // These are default CSS styles but make sure we don't inherit other styles
    // when in a `navigation_bar.tsx` title for instance.
    fontSize: "75",
    fontStyle: "normal",
    userSelect: "none",
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

        // TODO(calebmer): If we ever support eastern name order of family name first
        // then given name, the initials should preserve that order. We shouldn't put
        // the given name initial first.
        const {givenName, familyName} = parseAccountNameAssumingWesternNameOrder(accountData);

        // We use iterators instead of indexing into the name because iterators give us
        // full Unicode unicode code points. This means grapheme clusters will be
        // split, but surrogate pairs will be preserved.
        //
        // https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/String/@@iterator
        const firstInitial: string = splitter.iterateGraphemes(givenName).next().value;
        const lastInitial: string | null = familyName
            ? splitter.iterateGraphemes(familyName).next().value
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
