import {Section} from "@react-email/components";
import {EmailText} from "~/server/emails/internal/components/email_text.js";

export function EmailFooter({children}: {children: React.ReactNode}) {
    return (
        <Section>
            <EmailText fontSize="75" color="grey-50">
                {children}
            </EmailText>
        </Section>
    );
}
