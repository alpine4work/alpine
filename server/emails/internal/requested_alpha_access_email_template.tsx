import {Mjml, MjmlBody, MjmlColumn, MjmlFont, MjmlHead, MjmlSection, MjmlTitle} from "mjml-react";
import {EmailText, emailFontStyles} from "~/server/emails/internal/helpers/email_text.js";
import {colors} from "~/shared/design/core/colors.js";
import {defaultThemeColor} from "~/shared/design/core/theme_colors.js";
import {interleaveArray} from "~/shared/helpers/array/interleave_array.js";

/**
 * Very basic email only sent to internal users. This design isn't high enough
 * quality for end users.
 */
export function RequestedAlphaAccessEmailTemplate({
    name,
    emailAddress,
    message,
}: {
    name: string;
    emailAddress: string;
    message: string;
}) {
    const truncatedName = name.slice(0, 30);
    const title = `${
        name.length > truncatedName.length ? `“${truncatedName}…”` : truncatedName
    } requested alpha access`;

    return (
        <Mjml>
            <MjmlHead>
                <MjmlTitle>{title}</MjmlTitle>
                <MjmlFont
                    name="Inter"
                    href="https://fonts.googleapis.com/css?family=Inter:400,600"
                />
            </MjmlHead>
            <MjmlBody>
                <MjmlSection>
                    <MjmlColumn>
                        <EmailText>
                            New alpha access request from{" "}
                            <strong style={{fontWeight: emailFontStyles.bold.fontWeight}}>
                                {name}
                            </strong>{" "}
                            ({emailAddress}).
                        </EmailText>
                        {message.length === 0 ? (
                            <EmailText>They did not include a message.</EmailText>
                        ) : (
                            <EmailText>
                                They included the message: “
                                {interleaveArray(message.split(/[\n\r]/g), index => (
                                    <br key={index} />
                                ))}
                                ”
                            </EmailText>
                        )}
                        <EmailText>
                            To approve the request, visit the{" "}
                            <a
                                // TODO(calebmer): Should use localhost in development?
                                href="https://alpine.inc/internal/alpha"
                                target="_blank"
                                rel="noreferrer"
                                style={{color: colors[`${defaultThemeColor}-60`]}}
                            >
                                alpha control panel
                            </a>
                            .
                        </EmailText>
                    </MjmlColumn>
                </MjmlSection>
            </MjmlBody>
        </Mjml>
    );
}
