import {
    backgroundColorVar,
    colorSchemeVars,
    fontStyles,
    interFontFamily,
    sprinkles,
} from "~/client/web/styles/styles.js";
import {
    interDigitGlyphMaxAdvanceWidth,
    interFontUnitsPerEm,
} from "~/shared/design/core/font_metrics.js";
import {RemLength, Spacing, parseRemLength, spacing} from "~/shared/design/core/spacing.js";

const fontSize = 102;
const fontDigitMaxWidth = Math.ceil(
    fontSize * (interDigitGlyphMaxAdvanceWidth / interFontUnitsPerEm),
);

const badgeHeight = 154;
const badgePaddingX = 26;
const badgeMinWidth = badgeHeight;
const badgeMaxWidth = fontDigitMaxWidth * 3 + badgePaddingX * 2;
const badgeRadius = badgeHeight / 2;

/**
 * The red dot with a notification count we render next to the notifications
 * icon or an inbox entry.
 *
 * The `setInboxLoudNotificationBadge()` function in
 * `RootTabBarController.swift` renders identical UI in Swift code. If we make
 * a change here we also probably need to make a change there.
 */
export function LoudNotificationBadge({
    top,
    right,
    count,
}: {
    top: Spacing | `-${Spacing}` | RemLength;
    right: Spacing | `-${Spacing}` | RemLength;
    count: number;
}) {
    const borderWidth = 16;

    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox={`${-borderWidth} ${-borderWidth} ${badgeMaxWidth + borderWidth} ${
                badgeHeight + borderWidth * 2
            }`}
            className={sprinkles({
                zIndex: "30",
                position: "absolute",
                pointerEvents: "none",
                height: "3",
            })}
            style={{
                height: `${
                    parseRemLength("3") * ((badgeHeight + borderWidth * 2) / badgeHeight)
                }rem`,
                // Use `right` and `translateX` to center the number around a point inset within
                // the positioning context.
                top: `${
                    parseRemLength(
                        top.endsWith("rem")
                            ? top
                            : top.startsWith("-")
                            ? `-${spacing[top.slice(1) as Spacing]}`
                            : spacing[top as Spacing],
                    ) -
                    parseRemLength("3") * (borderWidth / badgeHeight)
                }rem`,
                right: right.endsWith("rem")
                    ? right
                    : right.startsWith("-")
                    ? `-${spacing[right.slice(1) as Spacing]}`
                    : spacing[right as Spacing],
                transform: "translateX(50%)",
            }}
        >
            <LoudNotificationBadgeSvg
                x={badgeMaxWidth / 2}
                y={badgeHeight / 2}
                count={count}
                borderWidth={borderWidth}
            />
        </svg>
    );
}

export function LoudNotificationBadgeSvg({
    x,
    y,
    count,
    borderWidth,
    clipPath,
}: {
    x: number;
    y: number;
    count: number;
    borderWidth?: number;
    clipPath?: {id: string; strokeWidth: number};
}) {
    const countText = count > 99 ? "99+" : count.toString();
    const countTextWidth = countText.length * fontDigitMaxWidth;

    const badgeWidth = Math.max(badgeMinWidth, countTextWidth + badgePaddingX * 2);

    return (
        <>
            {borderWidth && (
                <rect
                    x={x - (badgeWidth + borderWidth * 2) / 2}
                    y={y - (badgeHeight + borderWidth * 2) / 2}
                    width={badgeWidth + borderWidth * 2}
                    height={badgeHeight + borderWidth * 2}
                    rx={badgeRadius + borderWidth}
                    ry={badgeRadius + borderWidth}
                    fill={backgroundColorVar}
                />
            )}
            <rect
                x={x - badgeWidth / 2}
                y={y - badgeHeight / 2}
                width={badgeWidth}
                height={badgeHeight}
                rx={badgeRadius}
                ry={badgeRadius}
                fill={colorSchemeVars["red-50-const"]}
            />
            <text
                x={x}
                y={y}
                textAnchor="middle"
                dominantBaseline="central"
                fontSize={fontSize}
                fontFamily={interFontFamily}
                fontWeight={fontStyles["semi-bold"].fontWeight}
                fill={colorSchemeVars["grey-0-const"]}
            >
                {countText}
            </text>
            {(() => {
                if (!clipPath) return;

                const badgeClipWidth = badgeWidth + clipPath.strokeWidth * 2;
                const badgeClipHeight = badgeHeight + clipPath.strokeWidth * 2;
                const badgeClipRadius = badgeClipHeight / 2;

                // Draws a rectangle with a cutout of the notification badge (plus the
                // `strokeWidth`) to use in the `clipPath` attribute of some other
                // element.
                return (
                    <clipPath id={clipPath.id}>
                        <path
                            fillRule="evenodd"
                            clipRule="evenodd"
                            d={[
                                "M0,0h256v256h-256z",
                                `M${x - badgeClipWidth / 2},${y}`,
                                `A${[
                                    badgeClipRadius,
                                    badgeClipRadius,
                                    0,
                                    0,
                                    1,
                                    x - badgeClipWidth / 2 + badgeClipRadius,
                                    y - badgeClipHeight / 2,
                                ].join(",")}`,
                                `L${x + badgeClipWidth / 2 - badgeClipRadius},${
                                    y - badgeClipHeight / 2
                                }`,
                                `A${[
                                    badgeClipRadius,
                                    badgeClipRadius,
                                    1,
                                    0,
                                    1,
                                    x + badgeClipWidth / 2,
                                    y,
                                ].join(",")}`,
                                `A${[
                                    badgeClipRadius,
                                    badgeClipRadius,
                                    0,
                                    0,
                                    1,
                                    x + badgeClipWidth / 2 - badgeClipRadius,
                                    y + badgeClipHeight / 2,
                                ].join(",")}`,
                                `L${x - badgeClipWidth / 2 + badgeClipRadius},${
                                    y + badgeClipHeight / 2
                                }`,
                                `A${[
                                    badgeClipRadius,
                                    badgeClipRadius,
                                    1,
                                    0,
                                    1,
                                    x - badgeClipWidth / 2,
                                    y,
                                ].join(",")}`,
                                "Z",
                            ].join(" ")}
                        />
                    </clipPath>
                );
            })()}
        </>
    );
}
