import {createSvgHtmlGenerator} from "~/client/web/icons/create_svg_html_generator.js";
import {
    colorSchemeVars,
    pingAnimationWithDelayClassName,
    sprinkles,
} from "~/client/web/styles/styles.js";
import {Spacing, spacing} from "~/shared/design/core/spacing.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.open_source.js";
import {HtmlElementGenerator, HtmlGenerator} from "~/shared/helpers/html/html_generator.js";
import {TaskPriority} from "~/shared/tasks/task_priority.js";

export const taskPriorityIconClassName = sprinkles({
    flexShrink: "0",
});

export const taskPriorityIconUrgentContainerClassName = sprinkles({
    flexShrink: "0",
    position: "relative",
    zIndex: "0",
});

export const taskPriorityIconUrgentPingContainerClassName = sprinkles({
    position: "absolute",
    inset: "0",
    zIndex: "-10",
});

export const taskPriorityIconUrgentCircleFillHighlightedClassName = sprinkles({
    fill: "red-50-const",
});

export const taskPriorityIconUrgentCircleFillNotHighlightedClassName = sprinkles({
    fill: {light: "grey-70", dark: "grey-20"},
});

// IMPORTANT: If you update the HTML here you should also update
// `<TaskPriorityIcon>` for code that renders priority icons in React.
/**
 * Renders a task priority icon to an `HtmlGenerator` object. For rendering icons
 * in `<ContentEditor>` where we can't render React UI.
 */
export function renderTaskPriorityIcon({
    size,
    priority,
    shouldHighlightUrgent,
    withCurrentColorForUnfilledBars,
}: {
    size: Spacing;
    priority: TaskPriority | null;
    shouldHighlightUrgent: boolean;
    withCurrentColorForUnfilledBars?: boolean;
}): HtmlGenerator {
    const filledBarColor = colorSchemeVars["grey-80"];
    const unfilledBarColor = withCurrentColorForUnfilledBars
        ? "currentColor"
        : colorSchemeVars["grey-20"];

    let fillBar1: boolean;
    let fillBar2: boolean;
    let fillBar3: boolean;

    switch (priority) {
        case null: {
            fillBar1 = false;
            fillBar2 = false;
            fillBar3 = false;
            break;
        }
        case "Low": {
            fillBar1 = true;
            fillBar2 = false;
            fillBar3 = false;
            break;
        }
        case "Medium": {
            fillBar1 = true;
            fillBar2 = true;
            fillBar3 = false;
            break;
        }
        case "High": {
            fillBar1 = true;
            fillBar2 = true;
            fillBar3 = true;
            break;
        }
        case "Urgent": {
            return renderTaskPriorityIconUrgent({size, shouldHighlightUrgent});
        }
        default:
            throw exhaustive(priority);
    }

    const sizeStyle = `width: ${spacing[size]}; height: ${spacing[size]}`;

    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" class="${taskPriorityIconClassName}" style="${sizeStyle}"><rect x="23.5" y="5" width="2" height="22" rx="1" fill="${fillBar3 ? filledBarColor : unfilledBarColor}"/><rect x="15" y="10.5" width="2" height="16.5" rx="1" fill="${fillBar2 ? filledBarColor : unfilledBarColor}"/><rect x="6.5" y="16" width="2" height="11" rx="1" fill="${fillBar1 ? filledBarColor : unfilledBarColor}"/></svg>`;

    return createSvgHtmlGenerator(svg);
}

// Derived from Phosphor's `<WarningCircle>` icon but we made the exclamation mark
// bigger and duotone.
function renderTaskPriorityIconUrgent({
    size,
    shouldHighlightUrgent,
}: {
    size: Spacing;
    shouldHighlightUrgent: boolean;
}): HtmlElementGenerator {
    const sizeStyle = `width: ${spacing[size]}; height: ${spacing[size]}`;

    const containerHtml = new HtmlElementGenerator("div");
    containerHtml.setAttribute("class", taskPriorityIconUrgentContainerClassName);

    if (shouldHighlightUrgent) {
        const pingContainerHtml = containerHtml.appendChild(new HtmlElementGenerator("div"));
        pingContainerHtml.setAttribute(
            "class",
            `${pingAnimationWithDelayClassName} ${taskPriorityIconUrgentPingContainerClassName}`,
        );

        const pingSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" style="${sizeStyle}"><circle cx="16" cy="16" r="13" fill="${colorSchemeVars["red-50-const"]}"/></svg>`;
        pingContainerHtml.appendChild(createSvgHtmlGenerator(pingSvg));
    }

    const circleClassName = shouldHighlightUrgent
        ? taskPriorityIconUrgentCircleFillHighlightedClassName
        : taskPriorityIconUrgentCircleFillNotHighlightedClassName;

    const mainSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" style="${sizeStyle}"><circle cx="16" cy="16" r="13" class="${circleClassName}"/><rect x="15" y="9" width="2" height="9" rx="1" fill="${colorSchemeVars["grey-0-const"]}"/><circle cx="16" cy="21.5" r="1.5" fill="${colorSchemeVars["grey-0-const"]}"/></svg>`;
    containerHtml.appendChild(createSvgHtmlGenerator(mainSvg));

    return containerHtml;
}
