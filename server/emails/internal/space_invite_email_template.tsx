import {
    Body,
    Button,
    Container,
    Font,
    Head,
    Html,
    Preview,
    Section,
    Text,
} from "@react-email/components";
import {EmailText, emailFontStyles} from "~/server/emails/internal/helpers/email_text.js";
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
        <Html>
            <Head>
                <link rel="preload" href="https://fonts.googleapis.com/css?family=Inter:400,600" />
                <Font fontFamily="Inter" fallbackFontFamily="Times New Roman" />
            </Head>

            <Body>
                <Preview>{`Welcome to ${spaceName} on Alpine!`}</Preview>
                <Container>
                    <Section>
                        <EmailText>
                            <strong style={{fontWeight: emailFontStyles.bold.fontWeight}}>
                                Hi there,
                            </strong>{" "}
                        </EmailText>
                        <EmailText>
                            You’ve been invited to join{" "}
                            <Text style={{fontWeight: emailFontStyles.bold.fontWeight}}>
                                {spaceName}
                            </Text>{" "}
                            on Alpine – a shared space to collaborate, stay organized, and get
                            things done.
                        </EmailText>
                        <EmailText>
                            Click the link below to accept your invitation and get started:
                        </EmailText>

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
                    </Section>
                </Container>
            </Body>
        </Html>
    );
}
