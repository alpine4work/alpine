import {MjmlText} from "mjml-react";
import {ReactNode} from "react";
import {Color, colors} from "~/shared/design/core/colors.js";
import {FontSize, createFontStyles, fontSizesBySpacingScale} from "~/shared/design/core/fonts.js";
import {convertRemLengthToPx} from "~/shared/design/core/spacing.js";

// eslint-disable-next-line react-refresh/only-export-components
export const emailFontStyles = createFontStyles({
    interFontFamily: "Inter, Arial, sans-serif",
    commitMonoFontFamily: "monospace",
    sourceSerifFontFamily: "Inter, Arial, sans-serif",
});

export function EmailText({
    children,
    color = "grey-100",
    fontSize = "200",
    fontStyle: style = "normal",
    letterSpacingOverride,
}: {
    children?: ReactNode;
    color?: Color;
    fontSize?: FontSize;
    fontStyle?: "normal" | "semi-bold" | "bold";
    letterSpacingOverride?: string;
}) {
    return (
        <MjmlText
            fontFamily="Inter, Arial"
            color={colors[color]}
            fontSize={fontSizesBySpacingScale[fontSize].small.fontSize}
            letterSpacing={
                letterSpacingOverride ?? fontSizesBySpacingScale[fontSize].small.letterSpacing
            }
            lineHeight={`${convertRemLengthToPx(
                fontSizesBySpacingScale[fontSize].small.lineHeight,
                "small",
            )}px`}
            fontStyle={emailFontStyles[style].fontStyle}
            fontWeight={emailFontStyles[style].fontWeight}
        >
            {children}
        </MjmlText>
    );
}
