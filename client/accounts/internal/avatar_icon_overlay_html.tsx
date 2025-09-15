import {botIconSvg} from "~/client/icons/bot_icon_svg.js";
import {createSvgHtmlGenerator} from "~/client/icons/create_svg_html_generator.js";
import {ghostIconSvg} from "~/client/icons/ghost_icon_svg.js";
import {backgroundColorVar, colorSchemeVars} from "~/client/styles/styles.js";
import {HtmlElementGenerator} from "~/shared/helpers/html/html_generator.js";

// IMPORTANT: If you update the HTML here you should also update
// `<AvatarIconOverlay>` for code that render avatars in React.
export function renderAvatarIconOverlay({
    avatarPixelSize,
    iconType,
}: {
    avatarPixelSize: number;
    iconType: "ghost" | "bot";
}): {
    iconCutoutSpan: HtmlElementGenerator;
    iconOverlay: HtmlElementGenerator;
} {
    const iconCutoutSpanStyleString = [
        "position: absolute",
        "overflow: hidden",
        `width: ${avatarPixelSize}px`,
        `height: ${avatarPixelSize}px`,
    ].join(";");
    const iconCutoutSpan = new HtmlElementGenerator("span");
    iconCutoutSpan.setAttribute("style", iconCutoutSpanStyleString);

    const iconSize = avatarPixelSize / 1.618033988749; // golden ratio
    const iconStyleBase = [
        "position: absolute",
        `width: ${iconSize}px`,
        `height: ${iconSize}px`,
        // Position the SVG container just past the bounding box so that the ghost icon itself is
        // drawn almost exactly at the bottom right corner of the box. This looks correct at all
        // (tested) scales
        `bottom: -1px`,
        `right: -1px`,
    ];

    const iconSvgGenerator = iconType === "bot" ? botIconSvg : ghostIconSvg;

    iconCutoutSpan.appendChild(
        createSvgHtmlGenerator(
            iconSvgGenerator({
                color: backgroundColorVar,
                strokeWidth: 148,
                style: [...iconStyleBase, "overflow: hidden"].join(";"),
            }),
        ),
    );

    return {
        iconCutoutSpan,
        iconOverlay: createSvgHtmlGenerator(
            iconSvgGenerator({
                color: colorSchemeVars["grey-60"],
                style: [...iconStyleBase, "overflow: visible"].join(";"),
            }),
        ) as HtmlElementGenerator,
    };
}
