import {Body, Column, Container, Font, Head, Html, Preview, Section} from "@react-email/components";
import {EmailText} from "~/server/emails/internal/helpers/email_text.js";
import {colors} from "~/shared/design/core/colors.js";
import {defaultThemeColor} from "~/shared/design/core/theme_colors.js";
import {assert} from "~/shared/helpers/control/assert.js";

export function SignInEmailTemplate({
    code,
    emailAddress,
    baseUrl,
    shouldDangerouslyIncludeCodeInSubject = false,
}: {
    code: string;
    emailAddress: string;
    baseUrl: string;
    /**
     * It is convenient for one-time passwords to be in the email subject so if the
     * user has their phone nearby they can see a push notification with the code
     * without having to open their email client.
     *
     * However, it is also a security risk! Consider a screen share where the user
     * is trying to sign in and the notification appears. Or an attacker who has
     * access to a locked phone where they can see push notifications.
     *
     * So we only include the code in the subject if the account the user is
     * signing into is low value. For instance, when the user is creating a new
     * account so the account is empty.
     *
     * See:
     * - https://security.stackexchange.com/questions/238162/is-it-safe-to-send-verification-code-in-the-subject-of-the-email
     * - https://github.com/mozilla/fxa/issues/3567
     */
    shouldDangerouslyIncludeCodeInSubject?: boolean;
}) {
    assert(/^[a-zA-Z0-9]{6}$/.test(code), "Expected code to be six characters");

    return (
        <Html>
            <Head>
                <title>
                    {shouldDangerouslyIncludeCodeInSubject
                        ? `Your sign in code is ${code}`
                        : "Your sign in code"}
                </title>
                <Font
                    fontFamily="Inter"
                    fallbackFontFamily="Arial"
                    webFont={{
                        url: "https://fonts.googleapis.com/css?family=Inter:400,600",
                        format: "woff2",
                    }}
                />
            </Head>
            <Body>
                <Preview data-email-preview="true">
                    {shouldDangerouslyIncludeCodeInSubject
                        ? `Your sign in code is ${code}`
                        : "Your sign in code"}
                </Preview>
                <Container>
                    <Section>
                        <Column>
                            <EmailText>You requested a sign in code. Your code is:</EmailText>
                            <EmailText
                                fontSize="600"
                                fontStyle="bold"
                                letterSpacingOverride="0.03em"
                            >
                                {code}
                            </EmailText>
                            <EmailText>
                                Return to where you were signing in and type the code above. Or sign
                                in{" "}
                                <a
                                    href={`${baseUrl}/sign-in/${encodeURIComponent(emailAddress)}`}
                                    target="_blank"
                                    rel="noreferrer"
                                    style={{color: colors[`${defaultThemeColor}-60`]}}
                                >
                                    here
                                </a>
                                . This code expires after one hour and can only be used once.
                            </EmailText>
                        </Column>
                    </Section>
                    <Section>
                        <Column>
                            <EmailText color="grey-60" fontSize="75">
                                If you aren’t trying to sign in to{" "}
                                <a
                                    href={baseUrl}
                                    target="_blank"
                                    rel="noreferrer"
                                    style={{color: colors[`${defaultThemeColor}-60`]}}
                                >
                                    Alpine
                                </a>
                                , you can ignore this email.
                            </EmailText>
                        </Column>
                    </Section>
                </Container>
            </Body>
        </Html>
    );
}
