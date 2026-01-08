import {Text} from "@react-email/components";
import {ReactNode} from "react";
import {
    emailSpacing,
    emailSpacingScale,
} from "~/server/emails/internal/components/email_spacing_scale.js";
import {Color, colors} from "~/shared/design/core/colors.js";
import {FontSize, createFontStyles, fontSizesBySpacingScale} from "~/shared/design/core/fonts.js";

// eslint-disable-next-line react-refresh/only-export-components
export const emailFontStyles = createFontStyles({
    interFontFamily: "Inter, Arial, sans-serif",
    commitMonoFontFamily: "monospace",
});

export function EmailText({
    children,
    fontSize = "100",
    fontStyle = "normal",
    color = "grey-80",
    letterSpacingOverride,
    style,
}: {
    children?: ReactNode;
    fontSize?: FontSize;
    fontStyle?: "light" | "normal" | "semi-bold" | "bold";
    letterSpacingOverride?: string;
    style?: React.CSSProperties;
    color?: Color;
}) {
    const actualFontSize = fontSizesBySpacingScale[fontSize][emailSpacingScale];

    return (
        <Text
            className={`text-${color}`}
            style={{
                fontSize: actualFontSize.fontSize,
                letterSpacing: letterSpacingOverride ?? actualFontSize.letterSpacing,
                lineHeight: "1.5em",
                fontStyle: emailFontStyles[fontStyle].fontStyle,
                fontWeight: emailFontStyles[fontStyle].fontWeight,
                // It's easier to reason about paddings then margins with margin collapse. I
                // also don't trust email clients to correctly collapse margins.
                paddingBottom: emailSpacing["2"],
                marginTop: "0px",
                marginBottom: "0px",
                color: colors[color],
                ...style,
            }}
        >
            {children}
        </Text>
    );
}
