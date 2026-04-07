import {createSvgHtmlGenerator} from "~/client/web/icons/create_svg_html_generator.js";
import {lockBoldFillIconSvg} from "~/client/web/icons/lock_bold_fill_icon_svg.js";
import {getTaskCollectionColor} from "~/client/web/styles/get_task_collection_color.js";
import {Sprinkles, colorSchemeVars, sprinkles} from "~/client/web/styles/styles.js";
import {
    taskCollectionChipBorderRadius,
    taskCollectionChipHeight,
    taskCollectionChipPaddingY,
} from "~/client/web/styles/tasks_shared_styles.js";
import {Spacing, spacing} from "~/shared/design/core/spacing.js";
import {ThemeColor} from "~/shared/design/core/theme_colors.js";
import {HtmlElementGenerator, HtmlTextGenerator} from "~/shared/helpers/html/html_generator.js";
import {DefaultMap} from "~/shared/helpers/map/default_map.js";

export const taskCollectionChipBaseClassNameBase = sprinkles({
    fontSize: "75",
    paddingY: taskCollectionChipPaddingY,
    borderRadius: taskCollectionChipBorderRadius,
    display: "inline-flex",
    alignItems: "center",
    // These two properties are particularly important for
    // `<TaskDetailCollectionsField>` which renders an `<input>` as `name` when
    // creating a new collection. If the user types a lot of content then the chip
    // should grow until we reach the max-width then the `<input>` within should start
    // scrolling.
    maxWidth: "full",
    overflow: "hidden",
});

export const taskCollectionChipBaseDesktopLayoutClassName = `${taskCollectionChipBaseClassNameBase} ${sprinkles(
    {
        height: taskCollectionChipHeight.desktop,
        paddingRight: "1.5",
    },
)}`;

export const taskCollectionChipBaseDesktopLayoutWithoutColorClassName = `${taskCollectionChipBaseDesktopLayoutClassName} ${sprinkles(
    {
        paddingLeft: "1.5",
        paddingRight: "1.5",
    },
)}`;

export const taskCollectionChipBaseDesktopLayoutColorDotContainerClassName = sprinkles({
    paddingLeft: "1.5",
    paddingRight: "1",
});

export const taskCollectionChipBaseColorDotClassNameByColor = new DefaultMap(
    (color: Sprinkles["color"]) =>
        sprinkles({
            width: "1.5",
            height: "1.5",
            borderRadius: "full",
            backgroundColor: color,
        }),
);

export const taskCollectionChipBaseNameClassName = sprinkles({
    position: "relative",
    zIndex: "0",
    fontStyle: "normal",
    overflow: "hidden",
    paddingRight: "1.5",
    marginRight: "-1.5",
});

export const taskCollectionChipBaseNameGradientClassName = sprinkles({
    position: "absolute",
    zIndex: "10",
    right: "0",
    top: "0",
    bottom: "0",
    width: "1.5",
});

export const taskCollectionChipLockIconClassName = sprinkles({
    flexShrink: "0",
    marginLeft: "0.5",
    marginRight: "1",
    fill: "grey-40",
});

export const taskCollectionChipLockIconWithoutColorClassName = sprinkles({
    flexShrink: "0",
    marginRight: "1",
    fill: "grey-40",
});

/**
 * Renders a task collection chip to an `HtmlElementGenerator` object. For
 * rendering chips in `<ContentEditor>` where we can't render React UI.
 *
 * This is a non-interactive version that always uses desktop layout and has no
 * press or remove functionality.
 */
// IMPORTANT: If you update the HTML here you should also update
// `<TaskCollectionChipBase>` for code that renders chips in React.
export function renderTaskCollectionChipBase({
    color,
    isPrivate,
    name,
    nameMaxWidth,
}: {
    color: ThemeColor | null;
    isPrivate: boolean;
    name: string;
    nameMaxWidth?: Spacing;
}): HtmlElementGenerator {
    const backgroundColor = colorSchemeVars["grey-5"];

    const chipHtml = new HtmlElementGenerator("div");
    if (process.env.NODE_ENV !== "production") {
        chipHtml.setAttribute("data-testid", "TaskCollectionChip");
    }
    chipHtml.setAttribute(
        "class",
        color !== null
            ? taskCollectionChipBaseDesktopLayoutClassName
            : taskCollectionChipBaseDesktopLayoutWithoutColorClassName,
    );
    chipHtml.setAttribute("style", `background-color: ${backgroundColor}`);

    if (color !== null) {
        const colorDotContainerHtml = chipHtml.appendChild(new HtmlElementGenerator("div"));
        colorDotContainerHtml.setAttribute(
            "class",
            taskCollectionChipBaseDesktopLayoutColorDotContainerClassName,
        );

        const colorDotHtml = colorDotContainerHtml.appendChild(new HtmlElementGenerator("div"));
        colorDotHtml.setAttribute(
            "class",
            taskCollectionChipBaseColorDotClassNameByColor.getOrSetDefault(
                getTaskCollectionColor(color),
            ),
        );
    }

    const nameContainerHtml = chipHtml.appendChild(new HtmlElementGenerator("div"));
    nameContainerHtml.setAttribute("class", taskCollectionChipBaseNameClassName);

    const nameStyleParts = [
        "white-space: nowrap",
        // Render contextual alternate glyphs. User text may be rendered here.
        // eslint-disable-next-line cyberworlds/string-quotes
        'font-feature-settings: "calt" on',
    ];
    if (nameMaxWidth !== undefined) {
        nameStyleParts.push(`max-width: ${spacing[nameMaxWidth]}`);
    }
    nameContainerHtml.setAttribute("style", nameStyleParts.join("; "));

    const nameGradientHtml = nameContainerHtml.appendChild(new HtmlElementGenerator("div"));
    nameGradientHtml.setAttribute("class", taskCollectionChipBaseNameGradientClassName);
    nameGradientHtml.setAttribute(
        "style",
        `background: linear-gradient(to right, transparent, ${backgroundColor} ${spacing["0.5"]})`,
    );

    if (isPrivate) {
        nameContainerHtml.appendChild(
            createSvgHtmlGenerator(
                lockBoldFillIconSvg({
                    size: spacing["2.5"],
                    ariaLabel: "Private lock icon",
                    className:
                        color !== null
                            ? taskCollectionChipLockIconClassName
                            : taskCollectionChipLockIconWithoutColorClassName,
                }),
            ),
        );
    }

    nameContainerHtml.appendChild(new HtmlTextGenerator(name));

    return chipHtml;
}
