import {
    Mjml,
    MjmlBody,
    MjmlColumn,
    MjmlFont,
    MjmlHead,
    MjmlPreview,
    MjmlSection,
    MjmlTitle,
} from "mjml-react";
import {EmailText} from "~/server/emails/internal/helpers/email_text.js";
import {colors} from "~/shared/design/core/colors.js";
import {defaultThemeColor} from "~/shared/design/core/theme_colors.js";
import {assert} from "~/shared/helpers/control/assert.js";

export function SignInEmailTemplate({
    code,
    emailAddress,
    shouldDangerouslyIncludeCodeInSubject = false,
}: {
    code: string;
    emailAddress: string;
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
        <Mjml>
            <MjmlHead>
                <MjmlTitle>
                    {shouldDangerouslyIncludeCodeInSubject
                        ? `Your sign in code is ${code}`
                        : "Your sign in code"}
                </MjmlTitle>
                {!shouldDangerouslyIncludeCodeInSubject && (
                    // If we are trying to keep the code out of the email preview, add some preview
                    // text to reduce the likelihood that email clients show the code in a preview.
                    <MjmlPreview>
                        You requested a sign in code. Open this email to see your code. Once you
                        have your code, return to where you were signing in and type the code.
                    </MjmlPreview>
                )}
                <MjmlFont
                    name="Inter"
                    href="https://fonts.googleapis.com/css?family=Inter:400,600"
                />
            </MjmlHead>
            <MjmlBody>
                <MjmlSection>
                    <MjmlColumn>
                        <EmailText>You requested a sign in code. Your code is:</EmailText>
                        <EmailText fontSize="600" fontStyle="bold" letterSpacingOverride="0.03em">
                            {code}
                        </EmailText>
                        <EmailText>
                            Return to where you were signing in and type the code above. Or sign in{" "}
                            <a
                                // TODO(calebmer): Should use localhost in development?
                                href={`https://alpine.inc/sign-in/${encodeURIComponent(
                                    emailAddress,
                                )}`}
                                target="_blank"
                                rel="noreferrer"
                                style={{color: colors[`${defaultThemeColor}-60`]}}
                            >
                                here
                            </a>
                            . This code expires after one hour and can only be used once.
                        </EmailText>
                    </MjmlColumn>
                </MjmlSection>
                <MjmlSection>
                    <MjmlColumn>
                        <EmailText color="grey-60" fontSize="75">
                            If you aren’t trying to sign in to{" "}
                            <a
                                // TODO(calebmer): Should use localhost in development?
                                href="https://alpine.inc"
                                target="_blank"
                                rel="noreferrer"
                                style={{color: colors[`${defaultThemeColor}-60`]}}
                            >
                                Alpine
                            </a>
                            , you can ignore this email.
                        </EmailText>
                    </MjmlColumn>
                </MjmlSection>
            </MjmlBody>
        </Mjml>
    );
}
