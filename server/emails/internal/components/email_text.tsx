import {Text} from "@react-email/components";
import {ReactNode} from "react";
import {Color, colors} from "~/shared/design/core/colors.js";
import {FontSize, createFontStyles, fontSizesBySpacingScale} from "~/shared/design/core/fonts.js";
import {RemLength, convertRemLengthToPx} from "~/shared/design/core/spacing.js";
import {cast} from "~/shared/helpers/control/cast.js";

// eslint-disable-next-line react-refresh/only-export-components
export const emailFontStyles = createFontStyles({
    interFontFamily: "Inter, Arial, sans-serif",
    commitMonoFontFamily: "monospace",
});

export function EmailText({
    children,
    fontSize = "200",
    fontStyle = "normal",
    letterSpacingOverride,
    style,
    color,
}: {
    children?: ReactNode;
    fontSize?: FontSize;
    fontStyle?: "normal" | "semi-bold" | "bold";
    letterSpacingOverride?: string;
    style?: React.CSSProperties;
    color?: Color;
}) {
    return (
        <Text
            className={color ? `email-text ${color}` : "email-text"}
            style={{
                fontSize: fontSizesBySpacingScale[fontSize].small.fontSize,
                letterSpacing:
                    letterSpacingOverride ?? fontSizesBySpacingScale[fontSize].small.letterSpacing,
                lineHeight: `${convertRemLengthToPx(
                    fontSizesBySpacingScale[fontSize].small.lineHeight,
                    "small",
                )}px`,
                fontStyle: emailFontStyles[fontStyle].fontStyle,
                fontWeight: emailFontStyles[fontStyle].fontWeight,
                marginBottom: convertRemLengthToPx(cast<RemLength>("0.75rem"), "small"),
                marginTop: "0px",
                color: color ? colors[color] : colors["grey-100"],
                ...style,
            }}
        >
            {children}
        </Text>
    );
}
