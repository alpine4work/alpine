import {Section} from "@react-email/components";
import {EmailFooter} from "~/server/emails/internal/components/email_footer.js";
import {EmailFooterText} from "~/server/emails/internal/components/email_footer_text.js";
import {emailSpacing} from "~/server/emails/internal/components/email_spacing_scale.js";
import {EmailText} from "~/server/emails/internal/components/email_text.js";
import {BaseEmailTemplate} from "~/server/emails/internal/templates/base_email_template.js";
import {assert} from "~/shared/helpers/control/assert.js";

export function SignInOrSignUpEmailTemplate({
    resourceServiceUrl,
    variant,
    code,
    shouldDangerouslyIncludeCodeInSubject = false,
}: {
    resourceServiceUrl: string;
    variant: "SignIn" | "SignUp";
    code: string;

    /**
     * It is convenient for one-time passwords to be in the email subject so if the
     * user has their phone nearby they can see a push notification with the code
     * without having to open their email client.
     *
     * However, it is also a security risk! Consider a screen share where the user is
     * trying to sign in and the notification appears. Or an attacker who has access to
     * a locked phone where they can see push notifications.
     *
     * So we only include the code in the subject if the account the user is signing
     * into is low value. For instance, when the user is creating a new account so the
     * account is empty.
     *
     * See:
     *
     * - https://security.stackexchange.com/questions/238162/is-it-safe-to-send-verification-code-in-the-subject-of-the-email
     * - https://github.com/mozilla/fxa/issues/3567
     */
    shouldDangerouslyIncludeCodeInSubject?: boolean;
}) {
    assert(/^[a-zA-Z0-9]{6}$/.test(code), "Expected code to be six characters");

    const {
        subject: actualSubject,
        description,
        ignoreFooter,
    } = {
        SignIn: {
            subject: "Sign in to Alpine",
            description: "Sign in to Alpine with your one-time passcode:",
            ignoreFooter:
                "If you didn\u2019t try to sign in to Alpine, you can ignore this email. Someone else might have typed your email address by mistake.",
        },
        SignUp: {
            subject: "Sign up for Alpine",
            description: "Sign up for Alpine with your one-time passcode:",
            ignoreFooter:
                "If you didn\u2019t try to sign up for Alpine, you can ignore this email. Someone else might have typed your email address by mistake.",
        },
    }[variant];

    const subject = shouldDangerouslyIncludeCodeInSubject
        ? `Your passcode is ${code}`
        : actualSubject;

    return (
        <BaseEmailTemplate subject={subject} resourceServiceUrl={resourceServiceUrl}>
            <Section>
                <EmailText>{description}</EmailText>
            </Section>
            <Section style={{marginTop: emailSpacing["4"]}}>
                <EmailText color="grey-100" fontSize="700" letterSpacingOverride="0.05em">
                    {code}
                </EmailText>
            </Section>
            <EmailFooter>
                <EmailFooterText>This passcode expires in 10 minutes.</EmailFooterText>
                <EmailFooterText>{ignoreFooter}</EmailFooterText>
            </EmailFooter>
        </BaseEmailTemplate>
    );
}
