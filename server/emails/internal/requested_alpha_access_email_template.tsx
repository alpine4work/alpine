import {
    Mjml,
    MjmlBody,
    MjmlColumn,
    MjmlFont,
    MjmlHead,
    MjmlSection,
    MjmlTitle,
    MjmlText as MjmlUnstyledText,
} from "mjml-react";
import {ReactNode} from "react";
import {Color, colors} from "~/shared/design/colors";
import {convertRemLengthToPx, remPxByPlatform} from "~/shared/design/spacing";
import {defaultThemeColor} from "~/shared/design/theme_colors";
import {interleaveArray} from "~/shared/helpers/array/interleave_array";
import {fontSizes, fontStyles} from "~/shared/styles/styles";

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
                        <MjmlText>
                            New alpha access request from{" "}
                            <strong style={{fontWeight: fontStyles.primaryBold.fontWeight}}>
                                {name}
                            </strong>{" "}
                            ({emailAddress}).
                        </MjmlText>
                        {message.length === 0 ? (
                            <MjmlText>They did not include a message.</MjmlText>
                        ) : (
                            <MjmlText>
                                They included the message: "
                                {interleaveArray(message.split(/[\n\r]/g), index => (
                                    <br key={index} />
                                ))}
                                "
                            </MjmlText>
                        )}
                        <MjmlText>
                            To approve the request, visit the{" "}
                            <a
                                // TODO(calebmer): Should use localhost in development?
                                href="https://cyberworlds.dev/internal/alpha"
                                target="_blank"
                                rel="noreferrer"
                                style={{color: colors[`${defaultThemeColor}-60`]}}
                            >
                                alpha control panel
                            </a>
                            .
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
    fontSize: size = "body",
    fontStyle: style = "primary",
    margin = true,
    letterSpacingOverride,
}: {
    children?: ReactNode;
    color?: Color;
    fontSize?: keyof typeof fontSizes;
    fontStyle?: keyof typeof fontStyles & `primary${string}`;
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
