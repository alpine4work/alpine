import {EmailText} from "~/server/emails/internal/components/email_text.js";

/**
 * Render text inside `<EmailFooter>`.
 */
export function EmailFooterText({children}: {children: React.ReactNode}) {
    return (
        <EmailText fontSize="25" color="grey-50">
            {children}
        </EmailText>
    );
}
