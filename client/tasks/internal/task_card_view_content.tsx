import {CalendarDate} from "@internationalized/date";
import {CalendarBlank} from "phosphor-react";
import {Ref, cloneElement, forwardRef, useMemo} from "react";
import {AccountAvatar} from "~/client/accounts/account_avatar.js";
import {AccountShortName} from "~/client/accounts/account_short_name.js";
import {Box} from "~/client/design/box.js";
import {TaskDisplayStatusCircle} from "~/client/design/task_display_status_circle.js";
import {useClientInfo} from "~/client/remix/client_info_context.js";
import {usePlatform} from "~/client/remix/platform_context.js";
import {useRouteLayout} from "~/client/remix/route_layout_context.js";
import {useSpacingScale} from "~/client/remix/spacing_scale_context.js";
import {useCurrentDate} from "~/client/remix/use_current_time_rounded_to_hour.js";
import {contentStyles} from "~/client/styles/styles.js";
import {taskCardViewMaxWidth, taskCardViewMinHeight} from "~/client/styles/tasks_shared_styles.js";
import {formatTaskDate} from "~/client/tasks/internal/format_task_date.js";
import {getTaskPriorityName} from "~/client/tasks/internal/get_task_priority_name.js";
import {TaskChildTasksProgressWheel} from "~/client/tasks/internal/task_child_tasks_progress_wheel.js";
import {TaskCollectionChip} from "~/client/tasks/internal/task_collection_chip.js";
import {TaskPriorityIcon} from "~/client/tasks/internal/task_priority_icon.js";
import {addRemLengths, spacing} from "~/shared/design/core/spacing.js";
import {serializeProsemirrorFragmentToHtml} from "~/shared/prosemirror/serialize_prosemirror_node_to_html.js";
import {AccountModelData} from "~/shared/spaces/account_model.js";
import {TaskCollectionModel} from "~/shared/tasks/model/task_collection_model.js";
import {TaskDisplayStatus} from "~/shared/tasks/task_display_status.js";
import {TaskPriority} from "~/shared/tasks/task_priority.js";
import {TaskTitleModel} from "~/shared/tasks/title/task_title.js";

const TaskCardViewContentForwardRef = forwardRef(TaskCardViewContent);
export {TaskCardViewContentForwardRef as TaskCardViewContent};

/**
 * The card is a dense non-editable presentation of a task for easy
 * reading/skimming. By removing the need to edit on this surface we can
 * optimize for reading.
 */
function TaskCardViewContent(
    {
        displayStatus,
        title,
        assigneeAccountData,
        displayCollections,
        dueDate,
        priority,
        childTaskCount,
        closedChildTaskCount,
    }: {
        displayStatus: TaskDisplayStatus;
        title: TaskTitleModel;
        assigneeAccountData: AccountModelData | null;
        displayCollections: ReadonlyArray<TaskCollectionModel>;
        dueDate: CalendarDate | null;
        priority: TaskPriority | null;
        childTaskCount: number;
        closedChildTaskCount: number;
    },
    ref: Ref<HTMLDivElement>,
) {
    const platform = usePlatform();
    const spacingScale = useSpacingScale();
    const routeLayout = useRouteLayout();
    const {timeZone, locale} = useClientInfo();
    const currentDate = useCurrentDate();

    const fieldElements = [];

    if (childTaskCount > 0) {
        fieldElements.push(
            <Box
                display="flex"
                alignItems="center"
                gap="1"
                style={{
                    paddingRight:
                        fieldElements.length === 0
                            ? addRemLengths(
                                  "2",
                                  // A little extra padding to offset the negative margin of collection chips.
                                  "1",
                              )
                            : spacing["2"],
                }}
            >
                <TaskChildTasksProgressWheel
                    childTaskCount={childTaskCount}
                    closedChildTaskCount={closedChildTaskCount}
                />
                <Box color="grey-70">
                    {closedChildTaskCount}/{childTaskCount}
                </Box>
            </Box>,
        );
    }

    if (dueDate) {
        const {isAfterDate: isAfterDueDate, dateString: dueDateString} = formatTaskDate({
            timeZone,
            locale,
            currentDate,
            date: dueDate,
            shouldFormatAroundToday: true,
        });

        fieldElements.push(
            <Box
                display="flex"
                alignItems="center"
                gap="1"
                color={displayStatus !== "Closed" && isAfterDueDate ? "red-60" : "grey-60"}
                style={{
                    paddingRight:
                        fieldElements.length === 0
                            ? addRemLengths(
                                  "2",
                                  // A little extra padding to offset the negative margin of collection chips.
                                  "1",
                              )
                            : spacing["2"],
                }}
            >
                <CalendarBlank size={spacing["4"]} />
                <Box fontStyle="truncate">{dueDateString}</Box>
            </Box>,
        );
    }

    if (priority) {
        fieldElements.push(
            <Box
                display="flex"
                alignItems="center"
                gap="1"
                style={{
                    paddingRight:
                        fieldElements.length === 0
                            ? addRemLengths(
                                  "2",
                                  // A little extra padding to offset the negative margin of collection chips.
                                  "1",
                              )
                            : spacing["2"],
                }}
            >
                <TaskPriorityIcon
                    size="4"
                    priority={priority}
                    shouldHighlightUrgent={displayStatus !== "Closed"}
                />
                <Box fontStyle="truncate">{getTaskPriorityName(priority)}</Box>
            </Box>,
        );
    }

    if (assigneeAccountData) {
        fieldElements.push(
            <Box
                display="flex"
                alignItems="center"
                gap="2"
                maxWidth="32"
                style={{
                    paddingRight:
                        fieldElements.length === 0
                            ? addRemLengths(
                                  "2",
                                  // A little extra padding to offset the negative margin of collection chips.
                                  "1",
                              )
                            : spacing["2"],
                }}
            >
                <Box position="relative" width="4" height="4">
                    <Box position="absolute" top="-0.5" left="-0.5">
                        <AccountAvatar size="5" account={assigneeAccountData} />
                    </Box>
                </Box>
                <Box fontStyle="truncate" color="grey-60">
                    <AccountShortName account={assigneeAccountData} tooltipPlacement="bottom" />
                </Box>
            </Box>,
        );
    }

    // We add fields in reverse so that we can check `fieldElements.length === 0`
    // to tell if we are the last field before collections.
    fieldElements.reverse();

    const maxCollectionCount = routeLayout === "narrow" ? 3 : 5;

    for (const collection of displayCollections.slice(0, maxCollectionCount)) {
        fieldElements.push(
            <Box
                overflow="hidden"
                marginY="-0.5"
                marginLeft="-1"
                style={{maxWidth: `calc(50% - ${spacing["1"]})`}}
            >
                <TaskCollectionChip
                    collection={collection}
                    // Always use the smaller, desktop, task collection chips even on mobile.
                    withDesktopLayout={true}
                />
            </Box>,
        );
    }

    if (displayCollections.length > maxCollectionCount) {
        fieldElements.push(
            // eslint-disable-next-line string-quotes
            <Box color="grey-70" marginLeft="-1" style={{fontFeatureSettings: '"calt"'}}>
                +{displayCollections.length - maxCollectionCount}
            </Box>,
        );
    }

    return (
        <Box
            ref={ref}
            width="full"
            maxWidth={taskCardViewMaxWidth}
            height="full"
            overflow="hidden"
            padding="4"
            display="flex"
            flexDirection="column"
            justifyContent="space-between"
            gap="4"
            position="relative"
            zIndex="0"
            style={{minHeight: taskCardViewMinHeight}}
        >
            <Box
                display="flex"
                gap={platform === "mobile" ? "2.5" : "2"}
                // Extra margin on the right to balance margin on the left from status button.
                paddingRight="3"
            >
                <Box
                    flexShrink="0"
                    display="flex"
                    alignItems="center"
                    style={{height: contentStyles.paragraphFontSize.lineHeight}}
                    // Render status button on top of the press overlay to try and communicate that
                    // it is independently clickable from the rest of the card.
                    position="relative"
                    zIndex="20"
                >
                    <TaskDisplayStatusCircle
                        displayStatus={displayStatus}
                        size={platform === "mobile" ? "5" : "4"}
                    />
                </Box>
                <Box
                    flexGrow="1"
                    color="grey-100"
                    style={{
                        overflow: "hidden",
                        ...contentStyles.paragraphFontSize,
                        maxHeight: contentStyles.paragraphLineHeightPx[spacingScale] * 3,
                        // Truncate after 3 lines of text. Unofficial syntax that works in all browsers
                        // except IE.
                        // https://stackoverflow.com/questions/3922739/limit-text-length-to-n-lines-using-css
                        display: "-webkit-box",
                        WebkitLineClamp: 3,
                        lineClamp: 3,
                        WebkitBoxOrient: "vertical",
                        textOverflow: "ellipsis",
                        // Render contextual alternate glyphs. User text may be rendered here. Helpful
                        // for consistency if the user types anything like 2x2 or an @ mention.
                        // eslint-disable-next-line string-quotes
                        fontFeatureSettings: '"calt" on',
                    }}
                    dangerouslySetInnerHTML={useMemo(
                        () => ({
                            __html: serializeProsemirrorFragmentToHtml(
                                title.getProsemirrorNode().content,
                            ),
                        }),
                        [title],
                    )}
                />
            </Box>
            {fieldElements.length > 0 && (
                <Box display="flex" flexWrap="wrap" gap="3">
                    {fieldElements.map((node, index) => cloneElement(node, {key: index}))}
                </Box>
            )}
        </Box>
    );
}
