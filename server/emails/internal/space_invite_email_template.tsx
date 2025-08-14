import {
    Mjml,
    MjmlBody,
    MjmlButton,
    MjmlColumn,
    MjmlFont,
    MjmlHead,
    MjmlSection,
    MjmlTitle,
} from "mjml-react";
import {EmailText, emailFontStyles} from "~/server/emails/internal/helpers/email_text.js";
import {colors} from "~/shared/design/core/colors.js";
import {defaultThemeColor} from "~/shared/design/core/theme_colors.js";

export function SpaceInviteEmailTemplate({
    spaceUrl,
    spaceName,
}: {
    spaceUrl: string;
    spaceName: string;
}) {
    return (
        <Mjml>
            <MjmlHead>
                <MjmlTitle>{`Welcome to ${spaceName} on Alpine!`}</MjmlTitle>
                <MjmlFont
                    name="Inter"
                    href="https://fonts.googleapis.com/css?family=Inter:400,600"
                />
            </MjmlHead>
            <MjmlBody>
                <MjmlSection>
                    <MjmlColumn>
                        <EmailText>
                            <strong style={{fontWeight: emailFontStyles.bold.fontWeight}}>
                                Hi there,
                            </strong>{" "}
                        </EmailText>
                        <EmailText>
                            You’ve been invited to join{" "}
                            <strong style={{fontWeight: emailFontStyles.bold.fontWeight}}>
                                {spaceName}
                            </strong>{" "}
                            on Alpine – a shared space to collaborate, stay organized, and get
                            things done.
                        </EmailText>
                        <EmailText>
                            Click the link below to accept your invitation and get started:
                        </EmailText>
                        <MjmlButton
                            padding="20px"
                            backgroundColor={colors[`${defaultThemeColor}-60`]}
                            href={`${spaceUrl}/invite/accept`}
                        >
                            Join {spaceName}
                        </MjmlButton>
                        <EmailText>– The Alpine Team</EmailText>
                        <EmailText fontSize="25">
                            If you weren’t expecting this invitation,{" "}
                            <a
                                href={`${spaceUrl}/invite/reject-and-mark-as-spam`}
                                style={{color: "inherit"}}
                                target="_blank"
                                rel="noreferrer"
                            >
                                click here to mark this as spam.
                            </a>
                        </EmailText>
                    </MjmlColumn>
                </MjmlSection>
            </MjmlBody>
        </Mjml>
    );
}
