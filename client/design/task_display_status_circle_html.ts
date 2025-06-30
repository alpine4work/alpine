// Since we can't import `shared/tasks` from `client/design`, manually inline
// the `TaskDisplayStatus` type. This component lives in `client/design` so we
// can use it anywhere in the product without needing to depend on all the
// `client/tasks` code.

import {checkIconSvg} from "~/client/icons/check_icon_svg.js";
import {createSvgHtmlGenerator} from "~/client/icons/create_svg_html_generator.js";
import {
    accentThemeBackgroundColor,
    accentThemeForegroundColor,
    colorSchemeVars,
    sprinkles,
} from "~/client/styles/styles.js";
import {parseRemLength, spacing} from "~/shared/design/core/spacing.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {HtmlElementGenerator} from "~/shared/helpers/html/html_generator.js";
import {DefaultMap} from "~/shared/helpers/map/default_map.js";

type TaskDisplayStatus = "OpenInactive" | "OpenActive" | "Closed";

export type TaskDisplayStatusCircleSize = "3" | "4" | "5" | "6" | "7";

const computeCircleClassName = (displayStatus: TaskDisplayStatus, isPressed: boolean) =>
    sprinkles({
        // In case the circle is in a flexbox container, don't let it shrink.
        flexShrink: "0",
        position: "relative",
        zIndex: "0",
        borderRadius: "full",
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        overflow: "hidden",
        color: displayStatus === "Closed" ? accentThemeForegroundColor : undefined,
        backgroundColor:
            displayStatus === "Closed"
                ? accentThemeBackgroundColor
                : isPressed
                ? "grey-10"
                : "grey-0",
    });

export const taskDisplayStatusUnpressedCircleClassNameByDisplayStatus = new DefaultMap(
    (displayStatus: TaskDisplayStatus) => computeCircleClassName(displayStatus, false),
);

export const taskDisplayStatusPressedCircleClassNameByDisplayStatus = new DefaultMap(
    (displayStatus: TaskDisplayStatus) => computeCircleClassName(displayStatus, true),
);

export const taskDisplayStatusClosedPressedOverlayClassName = sprinkles({
    display: "block",
    position: "absolute",
    zIndex: "10",
    inset: "0",
    backgroundColor: "grey-100-const",
    pointerEvents: "none",
});

export const taskDisplayStatusActiveHalfCircleContainerClassName = sprinkles({
    display: "block",
    position: "absolute",
    top: "0",
    right: "0",
    overflow: "hidden",
});

export const taskDisplayStatusActiveHalfCircleClassName = sprinkles({
    display: "block",
    position: "absolute",
    top: "0",
    right: "0",
    borderRadius: "full",
    backgroundColor: {light: "theme-20-const", dark: "theme-30-const"},
});

export const taskDisplayStatusActivePressedOverlayClassName = sprinkles({
    display: "block",
    position: "absolute",
    zIndex: "10",
    top: "0",
    right: "0",
    borderRadius: "full",
    backgroundColor: "grey-100-const",
    pointerEvents: "none",
});

export function getTaskDisplayStatusActiveHalfCircleMargin(sizeInt: number) {
    return sizeInt >= 7
        ? // On high-pixel density devices round up to 2.5 and on low-pixel density devices round
          // down to 2.
          2.48
        : sizeInt >= 6
        ? 2
        : sizeInt >= 5
        ? // On high-pixel density devices round up to 1.5 and on low-pixel density devices round
          // down to 1.
          1.49
        : sizeInt >= 4
        ? // On high-pixel density devices round up to 1.5 and on low-pixel density devices round
          // down to 1.
          1.48
        : 1;
}

export function renderTaskDisplayStatusCircle({
    displayStatus,
    size,
    scale = 1,
}: {
    displayStatus: TaskDisplayStatus;
    size: TaskDisplayStatusCircleSize;
    scale?: number;
}) {
    const sizeInt = parseInt(size, 10);
    const activeHalfCircleMargin =
        (getTaskDisplayStatusActiveHalfCircleMargin(sizeInt * scale) + 1) / scale;

    let ariaLabel;
    switch (displayStatus) {
        case "OpenInactive":
            ariaLabel = "Open";
            break;
        case "OpenActive":
            ariaLabel = "Open (active)";
            break;
        case "Closed":
            ariaLabel = "Closed";
            break;
        default:
            throw exhaustive(displayStatus);
    }

    const html = new HtmlElementGenerator("span");

    html.setAttribute("role", "img");
    html.setAttribute("aria-label", ariaLabel);
    html.setAttribute(
        "class",
        taskDisplayStatusUnpressedCircleClassNameByDisplayStatus.getOrSetDefault(displayStatus),
    );
    html.setAttribute("style", `width: ${spacing[size]}; height: ${spacing[size]}`);

    if (displayStatus === "OpenInactive" || displayStatus === "OpenActive") {
        html.setAttribute(
            "style",
            `${html.getAttribute("style")}; box-shadow: inset 0 0 0 ${1 / scale}px ${
                colorSchemeVars["grey-40"]
            }`,
        );
    }

    if (displayStatus === "Closed") {
        html.appendChild(
            createSvgHtmlGenerator(
                checkIconSvg({
                    weight: "bold",
                    className: sprinkles({width: "2.5", height: "2.5"}),
                    style: `transform: scale(${sizeInt / 4})`,
                }),
            ),
        );
    }

    if (displayStatus === "OpenActive") {
        const activeHalfCircleContainerHtml = html.appendChild(new HtmlElementGenerator("span"));

        activeHalfCircleContainerHtml.setAttribute(
            "class",
            taskDisplayStatusActiveHalfCircleContainerClassName,
        );

        activeHalfCircleContainerHtml.setAttribute(
            "style",
            [
                `width: calc(${parseRemLength(size) / 2}rem - ${activeHalfCircleMargin}px)`,
                `height: calc(${spacing[size]} - ${activeHalfCircleMargin * 2}px)`,
                `transform: translateY(${activeHalfCircleMargin}px) translateX(${-activeHalfCircleMargin}px)`,
                // NOTE(calebmer): Safari appears to have a bug where `overflow: hidden` is not
                // actually clipping our circle? After some research it's a known bug that
                // Safari with `overflow: hidden` and `border-radius` doesn't always work. A
                // solution is to use `mask-image` instead. Curiously, I've found setting a
                // mask image that doesn't do any actual masking gets Safari to clip the half
                // circle properly. Going to...go with that for now I guess.
                //
                // This should probably be svg anyway.
                //
                // https://discourse.webflow.com/t/safari-not-hiding-overflow-on-rounded-corner-divs/55060
                "mask-image: linear-gradient(white, white)",
            ].join("; "),
        );

        const activeHalfCircleHtml = activeHalfCircleContainerHtml.appendChild(
            new HtmlElementGenerator("span"),
        );

        activeHalfCircleHtml.setAttribute("class", taskDisplayStatusActiveHalfCircleClassName);

        activeHalfCircleHtml.setAttribute(
            "style",
            [
                `width: calc(${spacing[size]} - ${activeHalfCircleMargin * 2}px)`,
                `height: calc(${spacing[size]} - ${activeHalfCircleMargin * 2}px)`,
            ].join("; "),
        );
    }

    return html;
}
