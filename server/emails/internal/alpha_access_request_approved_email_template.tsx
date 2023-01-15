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
import {fontSizes, fontStyles} from "~/shared/styles/styles";

export function AlphaAccessRequestApprovedEmailTemplate() {
    return (
        <Mjml>
            <MjmlHead>
                <MjmlTitle>
                    Welcome friend! Your access request to Cyberworlds was approved
                </MjmlTitle>
                <MjmlFont
                    name="Inter"
                    href="https://fonts.googleapis.com/css?family=Inter:400,600"
                />
            </MjmlHead>
            <MjmlBody>
                <MjmlSection>
                    <MjmlColumn>
                        <MjmlText>
                            Thanks for requesting access to{" "}
                            <a
                                // TODO(calebmer): Should use localhost in development?
                                href="https://cyberworlds.dev"
                                target="_blank"
                                rel="noreferrer"
                                style={{color: colors[`${defaultThemeColor}-60`]}}
                            >
                                Cyberworlds
                            </a>
                            . You can now{" "}
                            <a
                                // TODO(calebmer): Should use localhost in development?
                                href="https://cyberworlds.dev/sign-in"
                                target="_blank"
                                rel="noreferrer"
                                style={{color: colors[`${defaultThemeColor}-60`]}}
                            >
                                sign in
                            </a>{" "}
                            with this email address. I'm excited to share what we're working on with
                            you!
                        </MjmlText>
                        <MjmlText>
                            What you'll find when you sign in is the very beginning of our product.
                            There's not much, it's early stage, and works best on desktop (but will
                            work on mobile). We'll continuously deploy updates to{" "}
                            <a
                                // TODO(calebmer): Should use localhost in development?
                                href="https://cyberworlds.dev"
                                target="_blank"
                                rel="noreferrer"
                                style={{color: colors[`${defaultThemeColor}-60`]}}
                            >
                                https://cyberworlds.dev
                            </a>{" "}
                            over the next year.
                        </MjmlText>
                        <MjmlText>
                            We've prepared for you a couple documents written with our product so
                            you can learn more about our plan. Including a{" "}
                            <a
                                href="https://cyberworlds.dev/s/111hc413nfdxa6vwspnhm3ejsc/documents/nfwdfnzt86ktkw25mk5knpx6fw"
                                target="_blank"
                                rel="noreferrer"
                                style={{color: colors[`${defaultThemeColor}-60`]}}
                            >
                                vision and strategy
                            </a>{" "}
                            doc, a{" "}
                            <a
                                href="https://cyberworlds.dev/s/111hc413nfdxa6vwspnhm3ejsc/documents/w1675bxd15e10cf0mhrmdcgq24"
                                target="_blank"
                                rel="noreferrer"
                                style={{color: colors[`${defaultThemeColor}-60`]}}
                            >
                                execution plan
                            </a>{" "}
                            doc, and a doc with information on how to invest in our{" "}
                            <a
                                href="https://cyberworlds.dev/s/111hc413nfdxa6vwspnhm3ejsc/documents/w1675bxd15e10cf0mhrmdcgq24"
                                target="_blank"
                                rel="noreferrer"
                                style={{color: colors[`${defaultThemeColor}-60`]}}
                            >
                                friends and family round
                            </a>
                            .
                        </MjmlText>
                        <MjmlText>
                            I want to hear what you think! Feel free to respond directly to this
                            email with any feedback or questions. I'll be sending you updates to
                            this email address over the next year with our progress.
                        </MjmlText>
                        <MjmlText>
                            Cheers,
                            <br />
                            Caleb Meredith
                        </MjmlText>
                    </MjmlColumn>
                </MjmlSection>
            </MjmlBody>
        </Mjml>
    );
}

function MjmlText({
    children,
    color = "grey-dark",
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
