import {CalendarDate} from "@internationalized/date";
import {CalendarBlank} from "phosphor-react";
import {cloneElement, useMemo} from "react";
import {AccountAvatar} from "~/client/accounts/account_avatar";
import {AccountShortName} from "~/client/accounts/account_short_name";
import {Box} from "~/client/design/box";
import {useCurrentDate} from "~/client/helpers/use_current_time_rounded_to_hour";
import {useClientInfo} from "~/client/remix/client_info_context";
import {TaskTitle} from "~/client/tasks/internal/task_title_schema";
import {formatTaskDueDate} from "~/client/tasks/playground/internal/format_task_due_date";
import {TaskCollectionChip} from "~/client/tasks/playground/internal/task_collection_chip";
import {LocalTaskCollection} from "~/client/tasks/playground/local_task_collection";
import {TaskStatus, TaskStatusButton} from "~/client/tasks/playground/task_status_button";
import {addRemLengths, parseRemLengthNumber, spacing} from "~/shared/design/spacing";
import {AccountModel} from "~/shared/models/account_model";
import {serializeProsemirrorFragmentToHtml} from "~/shared/prosemirror/serialize_prosemirror_node_to_html";
import {contentSchemaStyles} from "~/shared/styles/styles";

// TODO(calebmer): Needs:
//
// [x] Title
// [x] Open/close button
// [x] Assignee field
// [x] Due date field
// [x] Collections field
// [ ] Custom fields
// [ ] Subtasks
// [ ] Open detail interaction
// [ ] Mark as in progress

/**
 * The card is a dense non-editable presentation of a task for easy
 * reading/skimming. By removing the need to edit on this surface we can
 * optimize for reading.
 */
export function TaskCardPresentationalView({
    status,
    onStatusChange,
    title,
    assignee,
    dueDate,
    collections,
}: {
    status: TaskStatus;
    onStatusChange: (status: TaskStatus) => void;
    title: TaskTitle;
    assignee: AccountModel | null;
    dueDate: CalendarDate | null;
    collections: ReadonlyArray<LocalTaskCollection>;
}) {
    const {timeZone, locale} = useClientInfo();
    const currentDate = useCurrentDate();

    const fieldElements = useMemo(() => {
        const fieldElements = [];

        if (assignee) {
            fieldElements.push(
                <Box
                    display="flex"
                    alignItems="center"
                    gap="2"
                    maxWidth="32"
                    style={{
                        paddingRight: !dueDate
                            ? addRemLengths(
                                  spacing["2"],
                                  // A little extra padding to offset the negative margin of collection chips.
                                  // Only when the next field is collections. If we have a due date the extra
                                  // padding will be added there.
                                  spacing["0.5"],
                              )
                            : spacing["2"],
                    }}
                >
                    <Box position="relative" width="4" height="4">
                        <Box position="absolute" top="-0.5" left="-0.5">
                            <AccountAvatar size="5" account={assignee} />
                        </Box>
                    </Box>
                    <Box fontStyle="truncate" color="grey-60">
                        <AccountShortName account={assignee} tooltipPlacement="bottom" />
                    </Box>
                </Box>,
            );
        }

        if (dueDate) {
            const {isAfterDueDate, dueDateString} = formatTaskDueDate({
                timeZone,
                locale,
                currentDate,
                dueDate,
            });

            fieldElements.push(
                <Box
                    display="flex"
                    alignItems="center"
                    gap="1"
                    color={status === "Open" && isAfterDueDate ? "red-60" : "grey-60"}
                    style={{
                        paddingRight: addRemLengths(
                            spacing["2"],
                            // A little extra padding to offset the negative margin of collection chips.
                            spacing["0.5"],
                        ),
                    }}
                >
                    <CalendarBlank size={spacing["4"]} />
                    <Box fontStyle="truncate">{dueDateString}</Box>
                </Box>,
            );
        }

        for (const collection of collections) {
            fieldElements.push(
                <Box marginY="-0.5" marginLeft="-0.5">
                    <TaskCollectionChip collection={collection} />
                </Box>,
            );
        }

        return fieldElements;
    }, [assignee, collections, currentDate, dueDate, locale, status, timeZone]);

    return (
        <Box
            width="full"
            maxWidth="96"
            overflow="hidden"
            backgroundColor="grey-0"
            boxShadow="elevation-5"
            borderRadius="lg"
            padding="4"
            display="flex"
            flexDirection="column"
            gap="4"
        >
            <Box
                display="flex"
                gap="2"
                // Extra margin on the right to balance margin on the left from status button.
                paddingRight="3"
            >
                <Box
                    flexShrink="0"
                    display="flex"
                    alignItems="center"
                    style={{height: contentSchemaStyles.paragraphFontSize.lineHeight}}
                >
                    <TaskStatusButton status={status} onStatusChange={onStatusChange} />
                </Box>
                <Box
                    flexGrow="1"
                    color={status === "Closed" ? "grey-60" : "grey-text"}
                    style={{
                        overflow: "hidden",
                        ...contentSchemaStyles.paragraphFontSize,
                        maxHeight: `${
                            parseRemLengthNumber(contentSchemaStyles.paragraphFontSize.lineHeight) *
                            3
                        }rem`,
                        // Truncate after 3 lines of text. Unofficial syntax that works in all browsers
                        // except IE.
                        // https://stackoverflow.com/questions/3922739/limit-text-length-to-n-lines-using-css
                        display: "-webkit-box",
                        WebkitLineClamp: 3,
                        lineClamp: 3,
                        WebkitBoxOrient: "vertical",
                        textOverflow: "ellipsis",
                    }}
                    dangerouslySetInnerHTML={useMemo(
                        () => ({
                            __html: serializeProsemirrorFragmentToHtml(title.content),
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
