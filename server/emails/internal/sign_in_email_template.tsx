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
import {Color, colors} from "~/shared/design/colors";
import {convertRemLengthToPx, remPxByPlatform} from "~/shared/design/spacing";
import {defaultThemeColor} from "~/shared/design/theme_colors";
import {assert} from "~/shared/helpers/control/assert";
import {fontSizes, fontStyles} from "~/shared/styles/styles";

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
                        <MjmlText>You requested a sign in code. Your code is:</MjmlText>
                        <MjmlText
                            fontSize="display-xs"
                            fontStyle="bold"
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
                        <MjmlText color="grey-60" fontSize="xs">
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
    fontSize: size = "md",
    fontStyle: style = "normal",
    margin = true,
    letterSpacingOverride,
}: {
    children?: ReactNode;
    color?: Color;
    fontSize?: keyof typeof fontSizes;
    fontStyle?: "normal" | "semi-bold" | "bold";
    margin?: boolean;
    letterSpacingOverride?: string;
}) {
    return (
        <MjmlUnstyledText
            fontFamily="Inter, Arial"
            color={colors[color]}
            fontSize={convertRemLengthToPx(fontSizes[size].fontSize, remPxByPlatform.desktop)}
            letterSpacing={letterSpacingOverride ?? fontSizes[size].letterSpacing}
            lineHeight={`${convertRemLengthToPx(
                fontSizes[size].lineHeight,
                remPxByPlatform.desktop,
            )}px`}
            fontStyle={fontStyles[style].fontStyle}
            fontWeight={fontStyles[style].fontWeight}
        >
            {children}
        </MjmlUnstyledText>
    );
}
