import {Container, Link, Section} from "@react-email/components";
import {EmailText} from "~/server/emails/internal/components/email_text.js";
import {BaseEmailTemplate} from "~/server/emails/internal/templates/base_email_template.js";
import {EmailFooter} from "~/server/emails/internal/templates/email_footer.js";
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

    const title = shouldDangerouslyIncludeCodeInSubject
        ? `Your sign in code is ${code}`
        : "Your sign in code";

    return (
        <BaseEmailTemplate title={title}>
            <Container>
                <Section>
                    <EmailText>You requested a sign in code. Your code is:</EmailText>
                    <EmailText fontSize="600" fontStyle="bold" letterSpacingOverride="0.03em">
                        {code}
                    </EmailText>
                    <EmailText>
                        Return to where you were signing in and type the code above. Or sign in{" "}
                        <Link
                            href={`${baseUrl}/sign-in/${encodeURIComponent(emailAddress)}`}
                            target="_blank"
                            rel="noreferrer"
                            style={{color: colors[`${defaultThemeColor}-60`]}}
                        >
                            here
                        </Link>
                        . This code expires after one hour and can only be used once.
                    </EmailText>
                </Section>
                <EmailFooter>
                    If you aren’t trying to sign in to{" "}
                    <Link
                        href={baseUrl}
                        target="_blank"
                        rel="noreferrer"
                        style={{color: colors[`${defaultThemeColor}-60`]}}
                    >
                        Alpine
                    </Link>
                    , you can ignore this email.
                </EmailFooter>
            </Container>
        </BaseEmailTemplate>
    );
}
