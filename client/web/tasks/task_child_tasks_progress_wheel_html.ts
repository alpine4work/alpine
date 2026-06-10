import {createSvgHtmlGenerator} from "~/client/web/icons/create_svg_html_generator.js";
import {colorSchemeVars, sprinkles} from "~/client/web/styles/styles.js";
import {Spacing, convertRemLengthToPx, spacing} from "~/shared/design/core/spacing.js";
import {SpacingScale} from "~/shared/design/core/spacing_scale.js";
import {HtmlElementGenerator} from "~/shared/helpers/html/html_generator.js";

export const taskChildTasksProgressWheelTrackClassName = sprinkles({
    position: "absolute",
    inset: "0",
});

export const taskChildTasksProgressWheelLineClassName = sprinkles({
    position: "absolute",
    inset: "0",
    color: {light: "theme-50-const", dark: "theme-40-const"},
});

/**
 * Renders a task child tasks progress wheel to an `HtmlElementGenerator` object.
 * For rendering progress wheels in `<ContentEditor>` where we can't render React
 * UI.
 *
 * This is a non-interactive version that doesn't support hover/press states.
 */
// IMPORTANT: If you update the HTML here you should also update
// `<TaskChildTasksProgressWheel>` for code that renders progress wheels in React.
export function renderTaskChildTasksProgressWheel({
    childTaskCount,
    closedChildTaskCount,
    spacingScale,
}: {
    childTaskCount: number;
    closedChildTaskCount: number;
    spacingScale: SpacingScale;
}): HtmlElementGenerator {
    const fraction = Math.max(closedChildTaskCount / childTaskCount, 0.1);

    const size: Spacing = "3";

    const viewBoxSize = convertRemLengthToPx(size, spacingScale);
    const strokeWidth = 2;
    const diameter = viewBoxSize - strokeWidth;
    const radius = diameter / 2;
    const circumference = 2 * Math.PI * radius;

    const containerHtml = new HtmlElementGenerator("div");
    containerHtml.setAttribute(
        "style",
        [
            "position: relative",
            `width: ${spacing[size]}`,
            `height: ${spacing[size]}`,
            // NOTE(calebmer, 2024-03-21): Without this, in mobile Safari for iOS when the
            // expand task button is clicked the progress wheel icon shifts ever so slightly.
            // Adding this fixes it.
            "transform: translate(0px, 0px)",
        ].join(";"),
    );

    // Track SVG (background circle)
    const trackSvg = `<svg xmlns="http://www.w3.org/2000/svg" class="${taskChildTasksProgressWheelTrackClassName}" style="color: ${colorSchemeVars["grey-20"]}" fill="currentColor" viewBox="0 0 ${viewBoxSize} ${viewBoxSize}"><circle cx="${viewBoxSize / 2}" cy="${viewBoxSize / 2}" r="${radius}" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1"/></svg>`;
    containerHtml.appendChild(createSvgHtmlGenerator(trackSvg));

    // Progress line SVG
    const pathD = `M ${viewBoxSize / 2}, ${viewBoxSize / 2} m 0, -${radius} a ${radius},${radius} 0 1,1 0,${radius * 2} a ${radius},${radius} 0 1,1 0,-${radius * 2}`;
    const progressSvg = `<svg xmlns="http://www.w3.org/2000/svg" class="${taskChildTasksProgressWheelLineClassName}" fill="currentColor" viewBox="0 0 ${viewBoxSize} ${viewBoxSize}"><path d="${pathD}" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="${strokeWidth}" stroke-dasharray="${fraction * circumference} ${circumference}" style="transition: stroke-dasharray 200ms ease"/></svg>`;
    containerHtml.appendChild(createSvgHtmlGenerator(progressSvg));

    return containerHtml;
}
