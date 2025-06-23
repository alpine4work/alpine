import {ContentFileLayout} from "~/client/content/state/content_file_layout_computations.js";
import {renderTaskDisplayStatusCircle} from "~/client/design/task_display_status_circle_html.js";
import {getTaskCollectionColor} from "~/client/styles/get_task_collection_color.js";
import {colorSchemeVars, contentStyles, sprinkles} from "~/client/styles/styles.js";
import {
    taskRowTitleInputPaddingYPx,
    taskRowViewMinHeight,
} from "~/client/styles/tasks_shared_styles.js";
import {fontSizesBySpacingScale} from "~/shared/design/core/fonts.js";
import {Platform} from "~/shared/design/core/platform.js";
import {convertRemLengthToPx} from "~/shared/design/core/spacing.js";
import {SpacingScale, remPxBySpacingScale} from "~/shared/design/core/spacing_scale.js";
import {FileEntityModel} from "~/shared/files/file_entity_model.js";
import {HtmlElementGenerator, HtmlTextGenerator} from "~/shared/helpers/html/html_generator.js";
import {Store} from "~/shared/store/store.js";
import {FileTaskCollectionEntityModelSchema} from "~/shared/tasks/file_task_collection_entity_model.js";

export function renderContentFileTaskCollectionEntityPreview(
    get: <Value>(store: Store<Value>) => Value,
    html: HtmlElementGenerator,
    {
        fileEntity: unknownFileEntity,
        layout,
        platform,
        spacingScale,
    }: {
        fileEntity: FileEntityModel;
        layout: ContentFileLayout;
        platform: Platform;
        spacingScale: SpacingScale;
    },
) {
    const fileEntity = unknownFileEntity.deserialize(FileTaskCollectionEntityModelSchema);

    const remPx = remPxBySpacingScale[spacingScale];
    const blockMaxWidthPx = contentStyles.blockMaxWidthRem[platform] * remPx;

    const isSmallerThanHalfOfBlockMaxWidth =
        layout.width <= (blockMaxWidthPx - contentStyles.fileRowGapWidthRem * remPx) / 2;

    const isSmallerThanThirdOfBlockMaxWidth =
        layout.width <= (blockMaxWidthPx - contentStyles.fileRowGapWidthRem * remPx * 2) / 3;

    // This case is primarily for `<MessageInputFileEntityPreview>`. We need to
    // render super small previews in that case.
    const isSmallerThanFourthOfBlockMaxWidth =
        layout.width <= (blockMaxWidthPx - contentStyles.fileRowGapWidthRem * remPx * 3) / 4;

    const transformScale =
        (isSmallerThanFourthOfBlockMaxWidth
            ? fontSizesBySpacingScale["50"].small.fontSize / 2
            : fontSizesBySpacingScale[
                  isSmallerThanThirdOfBlockMaxWidth
                      ? "50"
                      : isSmallerThanHalfOfBlockMaxWidth
                      ? "75"
                      : "100"
              ].small.fontSize) / fontSizesBySpacingScale["100"].small.fontSize;

    const containerHtml = html.appendChild(new HtmlElementGenerator("div"));

    const containerPadding = isSmallerThanFourthOfBlockMaxWidth
        ? "2"
        : isSmallerThanThirdOfBlockMaxWidth
        ? "3"
        : isSmallerThanHalfOfBlockMaxWidth
        ? "4"
        : "5";
    containerHtml.setAttribute("class", sprinkles({padding: containerPadding}));

    const scaledContainerHtml = containerHtml.appendChild(new HtmlElementGenerator("div"));

    scaledContainerHtml.setAttribute(
        "style",
        [
            `transform: scale(${transformScale})`,
            "transform-origin: 0 0",
            `width: ${
                (layout.width - convertRemLengthToPx(containerPadding, spacingScale) * 2) /
                transformScale
            }px`,
        ].join("; "),
    );

    {
        const headerHtml = scaledContainerHtml.appendChild(new HtmlElementGenerator("div"));

        headerHtml.setAttribute(
            "class",
            sprinkles({
                paddingBottom: "4",
                display: "flex",
                alignItems: "center",
                gap: "1",
            }),
        );

        const headerColorHtml = headerHtml.appendChild(new HtmlElementGenerator("div"));

        headerColorHtml.setAttribute(
            "class",
            sprinkles({
                flexShrink: "0",
                width: "2",
                height: "2",
                backgroundColor: getTaskCollectionColor(fileEntity.collection.getColor()),
                borderRadius: "full",
            }),
        );

        const headerTextHtml = headerHtml.appendChild(new HtmlElementGenerator("div"));

        headerTextHtml.setAttribute(
            "class",
            sprinkles({
                fontSize: "200",
                fontStyle: "truncate-semi-bold",
            }),
        );

        headerTextHtml.appendChild(new HtmlTextGenerator(fileEntity.collection.getName()));
    }

    const tasksContainerHtml = scaledContainerHtml.appendChild(new HtmlElementGenerator("div"));

    const taskRowCount = Math.max(3, fileEntity.previewTasks.length);
    for (let i = 0; i < taskRowCount; i++) {
        const taskRowHtml = tasksContainerHtml.appendChild(new HtmlElementGenerator("div"));

        taskRowHtml.setAttribute(
            "class",
            sprinkles({
                overflow: "hidden",
                position: "relative",
                width: "full",
                height: taskRowViewMinHeight,
                display: "flex",
                alignItems: "center",
            }),
        );

        taskRowHtml.setAttribute(
            "style",
            `box-shadow: 0 1px 0 0 ${colorSchemeVars["grey-5"]}, inset 0 1px 0 0 ${colorSchemeVars["grey-5"]}`,
        );

        // This is a ghost row. Don't render any content in the row.
        if (i >= fileEntity.previewTasks.length) continue;

        const task = fileEntity.previewTasks[i]!;

        const taskDisplayStatusHtml = taskRowHtml.appendChild(new HtmlElementGenerator("div"));

        taskDisplayStatusHtml.setAttribute("class", sprinkles({paddingRight: "2"}));

        taskDisplayStatusHtml.appendChild(
            renderTaskDisplayStatusCircle({
                size: platform === "mobile" ? "5" : "4",
                displayStatus: task.getDisplayStatus(),
            }),
        );

        const taskRowTitleHtml = taskRowHtml.appendChild(new HtmlElementGenerator("div"));

        taskRowTitleHtml.setAttribute(
            "class",
            sprinkles({
                display: "inline-block",
                maxWidth: "full",
                height: taskRowViewMinHeight,
                fontSize: "100",
                fontStyle: "truncate",
            }),
        );

        taskRowTitleHtml.setAttribute(
            "style",
            [
                `line-height: ${contentStyles.paragraphLineHeightVar}`,
                `padding-top: ${taskRowTitleInputPaddingYPx[spacingScale]}px`,
                `padding-bottom: ${taskRowTitleInputPaddingYPx[spacingScale]}px`,
                // Turn off text wrapping. This component emulates a single-line input.
                // https://developer.mozilla.org/en-US/docs/Web/CSS/white-space
                "white-space: pre",
                // `display: inline-block` creates an inline layout which adds extra space
                // below the element. Adding `vertical-align` stops the space from being added.
                // https://stackoverflow.com/questions/27536428/inline-block-element-height-issue
                "vertical-align: top",
                // Render contextual alternate glyphs. User text may be rendered here. Helpful
                // for consistency if the user types anything like 2x2 or an @ mention.
                // eslint-disable-next-line string-quotes
                'font-feature-settings: "calt" on',
            ].join("; "),
        );

        taskRowTitleHtml.appendChild(new HtmlTextGenerator(task.getTitle().getText()));
    }
}
