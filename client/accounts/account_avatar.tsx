import {useMemo} from "react";
import {
    accountAvatarClassName,
    accountAvatarInitialsClassName,
    getAccountAvatarInitials,
} from "~/client/accounts/account_avatar_html.js";
import {useAccountModel} from "~/client/accounts/account_registry_context.js";
import {Avatar} from "~/client/design/avatar.js";
import {Spacing} from "~/shared/design/core/spacing.js";
import {AccountModel, AccountModelData} from "~/shared/spaces/account_model.js";

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

    const initialsText = useMemo(
        () => `${firstInitial}${lastInitial ?? ""}`,
        [firstInitial, lastInitial],
    );

    // IMPORTANT: If you update the HTML here you should also update
    // `renderAccountAvatar()` for code that needs to render avatars in
    // `<ContentEditor>`.
    return (
        <Avatar
            avatarClassName={accountAvatarClassName}
            avatarTextClassName={accountAvatarInitialsClassName}
            id={accountData.id}
            text={initialsText}
            size={size}
            backgroundBorderWidth={backgroundBorderWidth}
        />
    );
}
