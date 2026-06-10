import {CalendarDate} from "@internationalized/date";
import {renderAccountAvatar} from "~/client/web/accounts/account_avatar_html.js";
import {AccountRegistry} from "~/client/web/accounts/account_registry.js";
import {setupContentFileEntityPreviewContainer} from "~/client/web/content/file_entity/internal/content_file_entity_preview_container.js";
import {
    renderContentFileEntitySiteBreadcrumb,
    siteBreadcrumbToTitleSpacing,
} from "~/client/web/content/file_entity/internal/render_content_file_entity_site_breadcrumb.js";
import {renderTaskDisplayStatusCircle} from "~/client/web/design/task_display_status_circle_html.js";
import {calendarBlankIconSvg} from "~/client/web/icons/calendar_blank_icon_svg.js";
import {caretRightIconSvg} from "~/client/web/icons/caret_right_icon_svg.js";
import {createSvgHtmlGenerator} from "~/client/web/icons/create_svg_html_generator.js";
import {lockBoldFillIconSvg} from "~/client/web/icons/lock_bold_fill_icon_svg.js";
import {SiteRegistry} from "~/client/web/sites/context/site_registry.js";
import {inputPlaceholderFontWeight, sprinkles} from "~/client/web/styles/styles.js";
import {
    taskDetailViewDenseFieldGap,
    taskDetailViewDenseFieldMinHeight,
    taskDetailViewFieldLabelFontSize,
    taskDetailViewTitleFontSize,
    taskDetailViewTitleLineHeight,
} from "~/client/web/styles/tasks_shared_styles.js";
import {formatTaskDate} from "~/client/web/tasks/format_task_date.js";
import {getTaskPriorityName} from "~/client/web/tasks/get_task_priority_name.js";
import {nullTaskAssigneeInputLabel} from "~/client/web/tasks/null_task_assignee_input_label.js";
import {renderTaskChildTasksProgressWheel} from "~/client/web/tasks/task_child_tasks_progress_wheel_html.js";
import {renderTaskCollectionChipBase} from "~/client/web/tasks/task_collection_chip_base_html.js";
import {renderTaskMissingAccountAvatar} from "~/client/web/tasks/task_missing_account_avatar_html.js";
import {renderTaskPriorityIcon} from "~/client/web/tasks/task_priority_icon_html.js";
import {ContentFileLayout} from "~/shared/content/compute_file_row_widths.js";
import {fontSizesBySpacingScale} from "~/shared/design/core/fonts.js";
import {Platform} from "~/shared/design/core/platform.js";
import {addRemLengths, spacing} from "~/shared/design/core/spacing.js";
import {SpacingScale} from "~/shared/design/core/spacing_scale.js";
import {FileEntityModel} from "~/shared/files/file_entity_model.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {HtmlElementGenerator, HtmlTextGenerator} from "~/shared/helpers/html/html_generator.js";
import {filterMapIterable} from "~/shared/helpers/iterable/filter_map_iterable.js";
import {SiteId} from "~/shared/id/types/id_types.js";
import {ClientInfo} from "~/shared/remix/client_info.js";
import {Store} from "~/shared/store/store.js";
import {
    FileTaskEntityModel,
    FileTaskEntityModelSchema,
} from "~/shared/tasks/file_task_entity_model.js";

export function renderContentFileTaskEntityPreview(
    get: <Value>(store: Store<Value>) => Value,
    html: HtmlElementGenerator,
    {
        fileEntity: unknownFileEntity,
        layout,
        clientInfo,
        platform,
        spacingScale,
        accountRegistry,
        siteRegistry,
        currentDate,
    }: {
        fileEntity: FileEntityModel;
        layout: ContentFileLayout;
        clientInfo: ClientInfo;
        platform: Platform;
        spacingScale: SpacingScale;
        accountRegistry: AccountRegistry;
        siteRegistry: SiteRegistry;
        currentDate: CalendarDate;
    },
) {
    const fileEntity = unknownFileEntity.deserialize(FileTaskEntityModelSchema);
    const task = fileEntity.task;

    const referencedSiteById = new Map(
        filterMapIterable(fileEntity.referencedSites, site => {
            if (!site.ok) return;
            return [site.value.id, site.value] as const;
        }),
    );

    const {
        scaledContainerHtml,
        isSmallerThanHalfOfBlockMaxWidth,
        isSmallerThanThirdOfBlockMaxWidth,
    } = setupContentFileEntityPreviewContainer(html, {
        layout,
        platform,
        spacingScale,
        transformScaleBaseFontSize: "100",
    });

    {
        const headerContainerHtml = scaledContainerHtml.appendChild(
            new HtmlElementGenerator("div"),
        );

        headerContainerHtml.setAttribute(
            "class",
            sprinkles({
                display: "flex",
                alignItems: "flex-start",
                gap: "3",
            }),
        );

        const statusCircleContainerHtml = headerContainerHtml.appendChild(
            new HtmlElementGenerator("div"),
        );

        const statusCircleSize = "5";

        statusCircleContainerHtml.setAttribute(
            "class",
            sprinkles({
                flexShrink: "0",
                display: "flex",
                alignItems: "center",
                height: taskDetailViewTitleLineHeight,
            }),
        );

        statusCircleContainerHtml.appendChild(
            renderTaskDisplayStatusCircle({
                size: statusCircleSize,
                displayStatus: task.getDisplayStatus(),
            }),
        );

        const titleContainerHtml = headerContainerHtml.appendChild(new HtmlElementGenerator("div"));

        // Only show the site breadcrumb when the task either has no parent (it's a root
        // task) OR its root parent is in the same site. When a subtask's root parent lives
        // outside the site, the chain `[Site] > [Root parent] > ...` would misrepresent
        // the root parent's actual access policy, so we hide the site breadcrumb instead
        // and let the parent task breadcrumb stand on its own.
        const showSiteBreadcrumb =
            fileEntity.site !== null &&
            (fileEntity.parent === null || isRootParentInSite(fileEntity, fileEntity.site.id));

        const hasBreadcrumb = showSiteBreadcrumb || fileEntity.parent !== null;

        if (hasBreadcrumb) {
            const breadcrumbLineHeight = fontSizesBySpacingScale["75"][spacingScale].lineHeight;

            // Offset the status circle down so it centers on the title row rather than a
            // breadcrumb. Each breadcrumb line above the title contributes its own line height
            // plus the gap it leaves below itself, so sum every line that's actually shown —
            // when both the site and parent breadcrumbs render that's two lines, not one
            // (otherwise the circle lands on the lower breadcrumb).
            const siteBreadcrumbOffset = showSiteBreadcrumb
                ? addRemLengths(breadcrumbLineHeight, siteBreadcrumbToTitleSpacing)
                : addRemLengths();
            const parentBreadcrumbOffset = fileEntity.parent
                ? // `"0.5"` matches the parent breadcrumb row's `padding-bottom` below.
                  addRemLengths(breadcrumbLineHeight, "0.5")
                : addRemLengths();
            const breadcrumbOffset = addRemLengths(siteBreadcrumbOffset, parentBreadcrumbOffset);

            statusCircleContainerHtml.setAttribute(
                "style",
                [
                    `padding-top: ${breadcrumbOffset}`,
                    `height: ${addRemLengths(breadcrumbOffset, taskDetailViewTitleLineHeight)}`,
                ].join("; "),
            );
        }

        if (showSiteBreadcrumb && fileEntity.site) {
            renderContentFileEntitySiteBreadcrumb(
                get,
                siteRegistry,
                titleContainerHtml,
                fileEntity.site,
            );
        }

        if (fileEntity.parent) {
            const parentBreadcrumbsHtml = titleContainerHtml.appendChild(
                new HtmlElementGenerator("div"),
            );

            parentBreadcrumbsHtml.setAttribute(
                "class",
                sprinkles({
                    display: "flex",
                    alignItems: "center",
                    gap: "1.5",
                    paddingBottom: "0.5",
                    color: "grey-50",
                }),
            );

            const parentBreadcrumbsTaskTitleHtml = parentBreadcrumbsHtml.appendChild(
                new HtmlElementGenerator("div"),
            );

            parentBreadcrumbsTaskTitleHtml.setAttribute(
                "class",
                sprinkles({display: "flex", alignItems: "center", gap: "1"}),
            );

            if (fileEntity.parent.rootTask.type === "Unauthorized") {
                parentBreadcrumbsTaskTitleHtml.appendChild(
                    createSvgHtmlGenerator(lockBoldFillIconSvg({size: spacing["2.5"]})),
                );

                parentBreadcrumbsTaskTitleHtml.appendChild(new HtmlTextGenerator("Private"));
            } else {
                parentBreadcrumbsTaskTitleHtml.appendChild(
                    new HtmlTextGenerator(fileEntity.parent.rootTask.task.getTitle().getText()),
                );
            }

            parentBreadcrumbsHtml.appendChild(
                createSvgHtmlGenerator(
                    caretRightIconSvg({className: sprinkles({width: "3", height: "3"})}),
                ),
            );

            if (fileEntity.parent.depth > 1) {
                const parentBreadcrumbsEllipsisHtml = parentBreadcrumbsHtml.appendChild(
                    new HtmlElementGenerator("div"),
                );

                parentBreadcrumbsEllipsisHtml.appendChild(new HtmlTextGenerator("…"));

                parentBreadcrumbsHtml.appendChild(
                    createSvgHtmlGenerator(
                        caretRightIconSvg({className: sprinkles({width: "3", height: "3"})}),
                    ),
                );
            }
        }

        const titleHtml = titleContainerHtml.appendChild(new HtmlElementGenerator("div"));

        titleHtml.setAttribute(
            "class",
            sprinkles({
                fontSize: taskDetailViewTitleFontSize,
                fontStyle: "semi-bold",
            }),
        );

        // Truncate after 3 lines of text. Unofficial syntax that works in all browsers
        // except IE.
        // https://stackoverflow.com/questions/3922739/limit-text-length-to-n-lines-using-css
        titleHtml.setAttribute(
            "style",
            [
                `line-height: ${spacing[taskDetailViewTitleLineHeight]}`,
                "display: -webkit-box",
                "-webkit-line-clamp: 3",
                "line-clamp: 3",
                "-webkit-box-orient: vertical",
                "text-overflow: ellipsis",
                "overflow: hidden",
            ].join("; "),
        );

        titleHtml.appendChild(new HtmlTextGenerator(fileEntity.task.getTitle().getText()));

        if (fileEntity.task.getChildTaskCount() > 0) {
            const subtasksHtml = titleContainerHtml.appendChild(new HtmlElementGenerator("div"));

            subtasksHtml.setAttribute(
                "class",
                sprinkles({
                    paddingTop: "1",
                    display: "flex",
                    alignItems: "center",
                    gap: "1",
                    color: "grey-70",
                }),
            );

            subtasksHtml.appendChild(
                renderTaskChildTasksProgressWheel({
                    childTaskCount: fileEntity.task.getChildTaskCount(),
                    closedChildTaskCount: fileEntity.task.getClosedChildTaskCount(),
                    spacingScale,
                }),
            );

            subtasksHtml.appendChild(
                new HtmlTextGenerator(
                    `${fileEntity.task.getClosedChildTaskCount()}/${fileEntity.task.getChildTaskCount()}`,
                ),
            );
        }
    }

    {
        const spacerHtml = scaledContainerHtml.appendChild(new HtmlElementGenerator("div"));
        spacerHtml.setAttribute("class", sprinkles({height: "4"}));
    }

    {
        const denseFieldsContainerHtml = scaledContainerHtml.appendChild(
            new HtmlElementGenerator("div"),
        );

        denseFieldsContainerHtml.setAttribute(
            "class",
            sprinkles({
                display: "grid",
                gap: taskDetailViewDenseFieldGap,
                paddingLeft: !isSmallerThanThirdOfBlockMaxWidth ? "8" : undefined,
            }),
        );

        denseFieldsContainerHtml.setAttribute(
            "style",
            [
                "grid-template-columns: auto minmax(0, 1fr)",
                "grid-template-rows: repeat(auto-fill, auto)",
                "grid-auto-flow: row dense",
            ].join("; "),
        );

        {
            const assigneeDenseFieldContainerHtml = renderContentFileTaskEntityPreviewDenseField(
                denseFieldsContainerHtml,
                "Assignee",
            );

            if (!fileEntity.assignee) {
                const assigneeHtml = assigneeDenseFieldContainerHtml.appendChild(
                    new HtmlElementGenerator("div"),
                );

                assigneeHtml.setAttribute(
                    "class",
                    sprinkles({
                        display: "flex",
                        alignItems: "center",
                        gap: "1.5",
                        marginY: "-0.5",
                        marginLeft: "-0.5",
                    }),
                );

                assigneeHtml.appendChild(
                    renderTaskMissingAccountAvatar({
                        size: "5",
                        spacingScale,
                    }),
                );

                const assigneeNameHtml = assigneeHtml.appendChild(new HtmlElementGenerator("div"));
                assigneeNameHtml.setAttribute(
                    "class",
                    sprinkles({fontStyle: "truncate", color: "grey-30"}),
                );
                assigneeNameHtml.setAttribute(
                    "style",
                    `font-weight: ${inputPlaceholderFontWeight}`,
                );
                assigneeNameHtml.appendChild(new HtmlTextGenerator(nullTaskAssigneeInputLabel));
            } else {
                const assigneeAccountData = get(
                    accountRegistry.getAccountStore(fileEntity.assignee),
                );

                const assigneeHtml = assigneeDenseFieldContainerHtml.appendChild(
                    new HtmlElementGenerator("div"),
                );

                assigneeHtml.setAttribute(
                    "class",
                    sprinkles({display: "flex", alignItems: "center", gap: "1.5", marginY: "-0.5"}),
                );

                assigneeHtml.appendChild(
                    renderAccountAvatar({
                        accountData: assigneeAccountData,
                        size: "5",
                        spacingScale,
                    }),
                );

                const assigneeNameHtml = assigneeHtml.appendChild(new HtmlElementGenerator("div"));
                assigneeNameHtml.setAttribute("class", sprinkles({fontStyle: "truncate"}));
                assigneeNameHtml.appendChild(new HtmlTextGenerator(assigneeAccountData.name));
            }
        }

        {
            const collectionsDenseFieldContainerHtml = renderContentFileTaskEntityPreviewDenseField(
                denseFieldsContainerHtml,
                "Collections",
            );

            if (fileEntity.collections.length === 0) {
                collectionsDenseFieldContainerHtml.setAttribute(
                    "class",
                    sprinkles({color: "grey-30"}),
                );
                collectionsDenseFieldContainerHtml.setAttribute(
                    "style",
                    `font-weight: ${inputPlaceholderFontWeight}`,
                );

                collectionsDenseFieldContainerHtml.appendChild(new HtmlTextGenerator("None"));
            } else {
                collectionsDenseFieldContainerHtml.setAttribute(
                    "class",
                    sprinkles({
                        maxWidth: "full",
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "flex-start",
                        gap: "2",
                        marginY: "-0.5",
                    }),
                );

                let collectionRows = [];

                const chunkArray = <Item>(
                    array: ReadonlyArray<Item>,
                    maxLength: number,
                ): Array<Array<Item>> => {
                    assert(maxLength > 1);

                    const arrays: Array<Array<Item>> = [];

                    for (const item of array) {
                        const lastArray = arrays[arrays.length - 1];

                        if (lastArray === undefined || lastArray.length === maxLength) {
                            arrays.push([item]);
                        } else {
                            lastArray.push(item);
                        }
                    }

                    return arrays;
                };

                if (isSmallerThanThirdOfBlockMaxWidth) {
                    collectionRows = chunkArray(fileEntity.collections, 2);
                } else if (isSmallerThanHalfOfBlockMaxWidth) {
                    collectionRows = chunkArray(fileEntity.collections, 3);
                } else {
                    collectionRows = chunkArray(fileEntity.collections, 5);
                }

                for (let i = 0; i < collectionRows.length; i++) {
                    const collectionRow = collectionRows[i]!;

                    const collectionRowHtml = collectionsDenseFieldContainerHtml.appendChild(
                        new HtmlElementGenerator("div"),
                    );
                    collectionRowHtml.setAttribute(
                        "class",
                        sprinkles({
                            maxWidth: "full",
                            display: "flex",
                            alignItems: "center",
                            gap: "1.5",
                        }),
                    );

                    for (const collection of collectionRow) {
                        const accessPolicy = collection.getAccessPolicy();
                        let isPrivate = false;
                        switch (accessPolicy.type) {
                            case "Local": {
                                isPrivate = !accessPolicy.defaultGrant;
                                break;
                            }
                            case "Site": {
                                isPrivate = !get(
                                    siteRegistry.getSiteStore(
                                        assertExists(referencedSiteById.get(accessPolicy.siteId)),
                                    ),
                                ).accessPolicy.defaultGrant;
                                break;
                            }
                            default:
                                throw exhaustive(accessPolicy);
                        }

                        collectionRowHtml.appendChild(
                            renderTaskCollectionChipBase({
                                color: collection.getColor(),
                                isPrivate,
                                name: collection.getName(),
                            }),
                        );
                    }

                    if (i === collectionRows.length - 1) {
                        const extraCollectionCount =
                            fileEntity.task.getCollections().getArray().length -
                            fileEntity.collections.length;

                        if (extraCollectionCount > 0) {
                            const extraCollectionCountHtml = collectionRowHtml.appendChild(
                                new HtmlElementGenerator("div"),
                            );
                            extraCollectionCountHtml.setAttribute(
                                "class",
                                sprinkles({color: "grey-70", width: "4", flexShrink: "0"}),
                            );
                            extraCollectionCountHtml.setAttribute(
                                "style",
                                // eslint-disable-next-line cyberworlds/string-quotes
                                `white-space: nowrap; font-feature-settings: "calt" on`,
                            );
                            extraCollectionCountHtml.appendChild(
                                new HtmlTextGenerator(`+${extraCollectionCount}`),
                            );
                        }
                    }
                }
            }
        }

        const priority = task.getPriority();
        if (priority) {
            const priorityDenseFieldContainerHtml = renderContentFileTaskEntityPreviewDenseField(
                denseFieldsContainerHtml,
                "Priority",
            );

            priorityDenseFieldContainerHtml.setAttribute(
                "class",
                sprinkles({display: "flex", alignItems: "center", gap: "1"}),
            );

            priorityDenseFieldContainerHtml.appendChild(
                renderTaskPriorityIcon({
                    size: "4",
                    priority,
                    shouldHighlightUrgent: false,
                }),
            );

            priorityDenseFieldContainerHtml.appendChild(
                new HtmlTextGenerator(getTaskPriorityName(priority)),
            );
        }

        const dueDate = task.getDueDate();
        if (dueDate) {
            const dueDateDenseFieldContainerHtml = renderContentFileTaskEntityPreviewDenseField(
                denseFieldsContainerHtml,
                "Due date",
            );

            const {isAfterDate, dateString} = formatTaskDate({
                timeZone: clientInfo.timeZone,
                locale: clientInfo.locale,
                currentDate,
                date: dueDate,
                shouldFormatAroundToday: true,
            });

            dueDateDenseFieldContainerHtml.setAttribute(
                "class",
                sprinkles({
                    display: "flex",
                    alignItems: "center",
                    gap: "1",
                    color:
                        isAfterDate && task.getDisplayStatus() !== "Closed" ? "red-60" : undefined,
                }),
            );

            dueDateDenseFieldContainerHtml.appendChild(
                createSvgHtmlGenerator(
                    calendarBlankIconSvg({className: sprinkles({width: "4", height: "4"})}),
                ),
            );

            dueDateDenseFieldContainerHtml.appendChild(new HtmlTextGenerator(dateString));
        }
    }
}

/**
 * Returns true when the task's root parent (a `TaskModel` whose own access policy
 * is reachable via `getAccessPolicy()`) lives in the site with the given id.
 *
 * Used to decide whether to render the site breadcrumb on a subtask preview. When
 * the root parent isn't in the same site, the chain `[Site] > [Root parent] > ...`
 * would misrepresent the root parent's actual access policy, so the breadcrumb is
 * hidden.
 *
 * If the root parent is `Unauthorized` we can't read its access policy, so we
 * conservatively return `false` and hide the breadcrumb.
 */
function isRootParentInSite(fileEntity: FileTaskEntityModel, siteId: SiteId): boolean {
    if (!fileEntity.parent) return false;
    if (fileEntity.parent.rootTask.type !== "Authorized") return false;
    const rootAccessPolicy = fileEntity.parent.rootTask.task.getAccessPolicy();
    return rootAccessPolicy?.type === "Site" && rootAccessPolicy.siteId === siteId;
}

function renderContentFileTaskEntityPreviewDenseField(
    containerHtml: HtmlElementGenerator,
    label: string,
) {
    const fieldLabelContainerHtml = containerHtml.appendChild(new HtmlElementGenerator("div"));

    fieldLabelContainerHtml.setAttribute(
        "class",
        sprinkles({
            display: "block",
            maxWidth: "24",
            minHeight: taskDetailViewDenseFieldMinHeight,
        }),
    );

    const fieldLabelHtml = fieldLabelContainerHtml.appendChild(new HtmlElementGenerator("div"));

    fieldLabelHtml.setAttribute(
        "class",
        sprinkles({
            fontSize: taskDetailViewFieldLabelFontSize,
            fontStyle: "truncate",
            color: "grey-60",
        }),
    );

    fieldLabelHtml.appendChild(new HtmlTextGenerator(label));

    const fieldValueContainerHtml = containerHtml.appendChild(new HtmlElementGenerator("div"));

    fieldValueContainerHtml.setAttribute(
        "class",
        sprinkles({minHeight: taskDetailViewDenseFieldMinHeight}),
    );

    return fieldValueContainerHtml;
}
