import {Button, Link, Preview, Section} from "@react-email/components";
import {EmailText, emailFontStyles} from "~/server/emails/internal/components/email_text.js";
import {BaseEmailTemplate} from "~/server/emails/internal/templates/base_email_template.js";
import {EmailFooter} from "~/server/emails/internal/templates/email_footer.js";
import {colors} from "~/shared/design/core/colors.js";
import {fontSizesBySpacingScale} from "~/shared/design/core/fonts.js";
import {defaultThemeColor} from "~/shared/design/core/theme_colors.js";

export function SpaceInviteEmailTemplate({
    spaceUrl,
    spaceName,
}: {
    spaceUrl: string;
    spaceName: string;
}) {
    return (
        <BaseEmailTemplate>
            <Preview>{`Welcome to ${spaceName} on Alpine!`}</Preview>
            <EmailText fontStyle="bold">Hi there,</EmailText>{" "}
            <EmailText>
                You’ve been invited to join{" "}
                <span style={{fontWeight: emailFontStyles.bold.fontWeight}}>{spaceName}</span> on
                Alpine – a shared space to collaborate, stay organized, and get things done.
            </EmailText>
            <EmailText>Click the link below to accept your invitation and get started:</EmailText>
            <Section style={{textAlign: "center"}}>
                <Button
                    style={{
                        fontSize: fontSizesBySpacingScale["100"].small.fontSize,
                        color: "white",
                        padding: "10px",
                        backgroundColor: colors[`${defaultThemeColor}-60`],
                        borderRadius: "3px",
                    }}
                    href={`${spaceUrl}/invite/accept`}
                >
                    Join {spaceName}
                </Button>
            </Section>
            <EmailText>– The Alpine Team</EmailText>
            <EmailFooter>
                {" "}
                If you weren’t expecting this invitation, you can{" "}
                <Link
                    href={`${spaceUrl}/invite/reject-and-mark-as-spam`}
                    style={{color: "inherit", textDecoration: "underline"}}
                    target="_blank"
                    rel="noreferrer"
                >
                    mark this as spam
                </Link>{" "}
                in Alpine.
            </EmailFooter>
        </BaseEmailTemplate>
    );
}
