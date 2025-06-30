import {useMemo} from "react";
import {
    accountAvatarClassName,
    accountAvatarInitialsClassName,
    getAccountAvatarInitials,
} from "~/client/accounts/account_avatar_html.js";
import {useAccountModel} from "~/client/accounts/account_registry_context.js";
import {backgroundColorVar, colorSchemeVars} from "~/client/styles/styles.js";
import {Spacing, spacing} from "~/shared/design/core/spacing.js";
import {AccountModel, AccountModelData} from "~/shared/spaces/account_model.js";

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
    backgroundBorderWidth,
}: {
    account: AccountModel | AccountModelData;
    size: Spacing;
    backgroundBorderWidth?: 1 | 1.5 | 2 | 3;
}) {
    // This component is rendered in hot paths (like `<TaskRowView>`) avoid using
    // `sprinkles()` in the component's render function until we implement a
    // transform that automatically inlines `sprinkles()`.
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const sprinkles = null;

    const accountData = useAccountModel(account);

    const {firstInitial, lastInitial} = useMemo(
        () => getAccountAvatarInitials(accountData),
        [accountData],
    );

    // IMPORTANT: If you update the HTML here you should also update
    // `renderAccountAvatar()` for code that needs to render avatars in
    // `<ContentEditor>`.
    return (
        <span
            className={accountAvatarClassName}
            style={{
                width: spacing[size],
                height: spacing[size],
                backgroundColor: colorSchemeVars["grey-30-const"],
                boxShadow:
                    backgroundBorderWidth !== undefined
                        ? `0px 0px 0px ${backgroundBorderWidth}px ${backgroundColorVar}`
                        : undefined,
            }}
        >
            <span
                className={accountAvatarInitialsClassName}
                style={{transform: `scale(${parseInt(size, 10) / 8})`}}
                aria-hidden="true"
            >
                {firstInitial.toUpperCase()}
                {lastInitial?.toUpperCase()}
            </span>
        </span>
    );
}
