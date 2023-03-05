import {renderToStaticMarkup} from "react-dom/server";
import {AccountAvatar, AccountAvatarProps} from "~/client/accounts/account_avatar";

/**
 * Render an account avatar to an HTML string. The avatar will be completely
 * non-interactive after rendering to HTML! Useful for rendering an avatar
 * in ProseMirror.
 *
 * This is in a separate module to `<AccountAvatar>` since it depends on
 * `react-dom/server` which can be quite a hefty dependency.
 */
export function renderAccountAvatarToHtml(props: AccountAvatarProps): string {
    return renderToStaticMarkup(<AccountAvatar {...props} />);
}
