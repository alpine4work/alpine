import {Hr, Section} from "@react-email/components";
import {emailSpacing} from "~/server/emails/internal/components/email_spacing_scale.js";

export function EmailFooter({children}: {children: React.ReactNode}) {
    return (
        <Section style={{paddingTop: emailSpacing["3"]}}>
            <Hr style={{marginBottom: emailSpacing["6"]}} />
            {children}
        </Section>
    );
}
