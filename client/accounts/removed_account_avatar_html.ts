/* eslint-disable string-quotes */
import escapeHtml from "escape-html";
import {createSvgHtmlGenerator} from "~/client/icons/create_svg_html_generator.js";
import {backgroundColorVar, borderRadius, colorSchemeVars} from "~/client/styles/styles.js";
import {Spacing, convertRemLengthToPx} from "~/shared/design/core/spacing.js";
import {SpacingScale} from "~/shared/design/core/spacing_scale.js";
import {HtmlElementGenerator} from "~/shared/helpers/html/html_generator.js";

// IMPORTANT: If you update the HTML here you should also update
// `<RemovedAccountAvatar>` for React code that renders avatars.
export function renderRemovedAccountAvatarHtml({
    size,
    spacingScale,
    outerHtml,
}: {
    size: Spacing;
    spacingScale: SpacingScale;
    outerHtml: HtmlElementGenerator;
}) {
    const removedAccountAvatarMaskAndCutoutOuterHtml = outerHtml.appendChild(
        new HtmlElementGenerator("span"),
    );
    const avatarPx = convertRemLengthToPx(size, spacingScale);
    const removedAccountAvatarOuterStyleString = [
        "position: absolute",
        "overflow: hidden",
        `width: ${avatarPx}px`,
        `height: ${avatarPx}px`,
    ].join(";");
    removedAccountAvatarMaskAndCutoutOuterHtml.setAttribute(
        "style",
        removedAccountAvatarOuterStyleString,
    );

    const imageFilterStyleString = [
        `border-radius: ${borderRadius["full"]}`,
        "position: absolute",
        "overflow: hidden",
        `width: ${avatarPx}px`,
        `height: ${avatarPx}px`,
    ].join(";");
    removedAccountAvatarMaskAndCutoutOuterHtml.appendChild(
        // This is the "filter" that grays out the avatar
        createSvgHtmlGenerator(
            `<svg
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 256 256"
                    style=${imageFilterStyleString}
                >
                    <rect
                        x="0"
                        y="0"
                        width="100%"
                        height="100%"
                        fill=${colorSchemeVars["grey-0"]}
                        opacity="0.6"
                    />
                </svg>`,
        ),
    );

    const ghostIconSize = avatarPx / 1.618033988749; // golden ratio
    const ghostIconStylesBase = [
        "position: absolute",
        `width: ${ghostIconSize}px`,
        `height: ${ghostIconSize}px`,
        `bottom: -1px`,
        `right: -1px`,
    ];
    removedAccountAvatarMaskAndCutoutOuterHtml.appendChild(
        createSvgHtmlGenerator(
            ghostIconSvg({
                color: backgroundColorVar,
                eyeColor: backgroundColorVar,
                strokeWidth: 132,
                style: [...ghostIconStylesBase, "overflow: hidden"].join(";"),
            }),
        ),
    );

    outerHtml.appendChild(
        createSvgHtmlGenerator(
            ghostIconSvg({
                color: colorSchemeVars["grey-60"],
                eyeColor: backgroundColorVar,
                strokeWidth: 24,
                style: [...ghostIconStylesBase, "overflow: visible"].join(";"),
            }),
        ),
    );
    return;
}

function ghostIconSvg({
    style = "",
    color,
    eyeColor,
    strokeWidth,
}: {
    className?: string;
    style?: string;
    color: string;
    eyeColor?: string;
    strokeWidth?: number;
}) {
    // prettier-ignore
    return (
      `<svg xmlns="http://www.w3.org/2000/svg"
        viewBox="-144 -144 400 400"
        style="${escapeHtml(style)}"
      >
        <path fill=${color} stroke=${color} stroke-width="${strokeWidth}" stroke-opacity="1" d="M216,216l-29.33-24-29.34,24L128,192,98.67,216,69.33,192,40,216V120a88,88,0,0,1,176,0Z" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="16"/>
        <circle fill=${eyeColor ?? "none"} cx="100" cy="116" r="16"/>
        <circle fill=${eyeColor ?? "none"} cx="156" cy="116" r="16"/>
      </svg>
    `);
}
