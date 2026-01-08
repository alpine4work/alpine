import {emailFontStyles} from "~/server/emails/internal/components/email_text.js";
import {colors} from "~/shared/design/core/colors.js";

/**
 * Render bold text inside `<EmailText>`.
 */
export function EmailTextBold({children}: {children: React.ReactNode}) {
    return (
        <strong
            className="text-grey-100"
            style={{color: colors["grey-100"], fontWeight: emailFontStyles.bold.fontWeight}}
        >
            {children}
        </strong>
    );
}
