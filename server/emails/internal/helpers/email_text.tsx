import {MjmlText} from "mjml-react";
import {ReactNode} from "react";
import {Color, colors} from "~/shared/design/colors.js";
import {convertRemLengthToPx, remPxByPlatform} from "~/shared/design/spacing.js";
import {fontSizes, fontSizesByPlatform, fontStyles} from "~/shared/styles/styles.js";

export function EmailText({
    children,
    color = "grey-100",
    fontSize = "200",
    fontStyle: style = "normal",
    letterSpacingOverride,
}: {
    children?: ReactNode;
    color?: Color;
    fontSize?: keyof typeof fontSizes;
    fontStyle?: "normal" | "semi-bold" | "bold";
    letterSpacingOverride?: string;
}) {
    return (
        <MjmlText
            fontFamily="Inter, Arial"
            color={colors[color]}
            fontSize={fontSizesByPlatform[fontSize].desktop.fontSize}
            letterSpacing={
                letterSpacingOverride ?? fontSizesByPlatform[fontSize].desktop.letterSpacing
            }
            lineHeight={`${convertRemLengthToPx(
                fontSizesByPlatform[fontSize].desktop.lineHeight,
                remPxByPlatform.desktop,
            )}px`}
            fontStyle={fontStyles[style].fontStyle}
            fontWeight={fontStyles[style].fontWeight}
        >
            {children}
        </MjmlText>
    );
}
