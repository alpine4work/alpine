import {setupContentFileEntityPreviewContainer} from "~/client/web/content/file_entity/internal/content_file_entity_preview_container.js";
import {renderContentFileEntitySiteBreadcrumb} from "~/client/web/content/file_entity/internal/render_content_file_entity_site_breadcrumb.js";
import {renderTaskDisplayStatusCircle} from "~/client/web/design/task_display_status_circle_html.js";
import {SiteRegistry} from "~/client/web/sites/context/site_registry.js";
import {getTaskCollectionColor} from "~/client/web/styles/get_task_collection_color.js";
import {colorSchemeVars, contentStyles, sprinkles} from "~/client/web/styles/styles.js";
import {
    taskRowTitleInputPaddingYPx,
    taskRowViewMinHeight,
} from "~/client/web/styles/tasks_shared_styles.js";
import {ContentFileLayout} from "~/shared/content/compute_file_row_layout.js";
import {Platform} from "~/shared/design/core/platform.open_source.js";
import {SpacingScale} from "~/shared/design/core/spacing_scale.open_source.js";
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
        siteRegistry,
    }: {
        fileEntity: FileEntityModel;
        layout: ContentFileLayout;
        platform: Platform;
        spacingScale: SpacingScale;
        siteRegistry: SiteRegistry;
    },
) {
    const fileEntity = unknownFileEntity.deserialize(FileTaskCollectionEntityModelSchema);

    const {scaledContainerHtml} = setupContentFileEntityPreviewContainer(html, {
        layout,
        platform,
        spacingScale,
        transformScaleBaseFontSize: "100",
    });

    if (fileEntity.site) {
        renderContentFileEntitySiteBreadcrumb({
            get,
            siteRegistry,
            parent: scaledContainerHtml,
            site: fileEntity.site,
            platform,
        });
    }

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
                // `display: inline-block` creates an inline layout which adds extra space below
                // the element. Adding `vertical-align` stops the space from being added.
                // https://stackoverflow.com/questions/27536428/inline-block-element-height-issue
                "vertical-align: top",
                // Render contextual alternate glyphs. User text may be rendered here. Helpful
                // for consistency if the user types anything like 2x2 or an @ mention.
                // eslint-disable-next-line cyberworlds/string-quotes
                'font-feature-settings: "calt" on',
            ].join("; "),
        );

        taskRowTitleHtml.appendChild(new HtmlTextGenerator(task.getTitle().getText()));
    }
}
