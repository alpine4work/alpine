import {
    Mjml,
    MjmlBody,
    MjmlColumn,
    MjmlFont,
    MjmlHead,
    MjmlPreview,
    MjmlSection,
    MjmlTitle,
    MjmlText as MjmlUnstyledText,
} from "mjml-react";
import {ReactNode} from "react";
import {expireOneTimePasswordAfterMinutes} from "~/server/dynamo/accounts_table";
import {Color, colors} from "~/shared/design/colors";
import {convertRemLengthToPx, remPxByPlatform} from "~/shared/design/spacing";
import {defaultThemeColor} from "~/shared/design/theme_colors";
import {assert} from "~/shared/helpers/control/assert";
import {typographySize, typographyStyle} from "~/shared/styles/styles";

// We write in copy that the code expires after one hour. If we change the
// password expiration time, we should also change the copy.
assert(expireOneTimePasswordAfterMinutes === 60);

// TODO(calebmer): For security, we should say "didn't ask for this email?
// report" or something similar. What's best practice...?
export function SignInEmail({
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
                <MjmlFont name="Inter" href="https://fonts.googleapis.com/css?family=Inter" />
            </MjmlHead>
            <MjmlBody>
                <MjmlSection>
                    <MjmlColumn>
                        <MjmlText>You requested a sign in code. Your code is:</MjmlText>
                        <MjmlText
                            typographySize="heading3"
                            typographyStyle="primarySemiBold"
                            letterSpacingOverride="0.03em"
                        >
                            {code}
                        </MjmlText>
                        <MjmlText>
                            Return to where you were signing in and type the code above. Or sign in{" "}
                            <a
                                // TODO(calebmer): Should use localhost in development?
                                href={`https://cyberworlds.dev/sign-in/${encodeURIComponent(
                                    emailAddress,
                                )}`}
                                target="_blank"
                                rel="noreferrer"
                                style={{color: colors[`${defaultThemeColor}-60`]}}
                            >
                                here
                            </a>
                            . This code expires after one hour and can only be used once.
                        </MjmlText>
                    </MjmlColumn>
                </MjmlSection>
                <MjmlSection>
                    <MjmlColumn>
                        <MjmlText color="grey-60" typographySize="small">
                            If you aren't trying to sign in to{" "}
                            <a
                                // TODO(calebmer): Should use localhost in development?
                                href="https://cyberworlds.dev"
                                target="_blank"
                                rel="noreferrer"
                                style={{color: colors[`${defaultThemeColor}-60`]}}
                            >
                                Cyberworlds
                            </a>
                            , you can ignore this email.
                        </MjmlText>
                    </MjmlColumn>
                </MjmlSection>
            </MjmlBody>
        </Mjml>
    );
}

function MjmlText({
    children,
    color = "grey-100",
    typographySize: size = "body",
    typographyStyle: style = "primary",
    margin = true,
    letterSpacingOverride,
}: {
    children?: ReactNode;
    color?: Color;
    typographySize?: keyof typeof typographySize;
    typographyStyle?: keyof typeof typographyStyle & `primary${string}`;
    margin?: boolean;
    letterSpacingOverride?: string;
}) {
    return (
        <MjmlUnstyledText
            fontFamily="Inter, Arial"
            color={colors[color]}
            fontSize={convertRemLengthToPx(typographySize[size].fontSize, remPxByPlatform.desktop)}
            letterSpacing={letterSpacingOverride ?? typographySize[size].letterSpacing}
            lineHeight={`${convertRemLengthToPx(
                typographySize[size].lineHeight,
                remPxByPlatform.desktop,
            )}px`}
            fontStyle={typographyStyle[style].fontStyle}
            fontWeight={typographyStyle[style].fontWeight}
        >
            {children}
        </MjmlUnstyledText>
    );
}
