import {differenceInDays} from "date-fns";
import {CalendarBlank} from "phosphor-react";
import {cloneElement, useMemo} from "react";
import {AccountAvatar} from "~/client/accounts/account_avatar";
import {AccountShortName} from "~/client/accounts/account_short_name";
import {Box} from "~/client/design/box";
import {useCurrentTimeRoundedToHour} from "~/client/helpers/use_current_time_rounded_to_hour";
import {useClientInfo} from "~/client/remix/client_info_context";
import {TaskTitle} from "~/client/tasks/internal/task_title_schema";
import {TaskStatus, TaskStatusButton} from "~/client/tasks/playground/task_status_button";
import {parseRemLengthNumber, spacing} from "~/shared/design/spacing";
import {ThemeColor} from "~/shared/design/theme_colors";
import {LocalTaskCollectionId} from "~/shared/id/types/id_types";
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

export type LocalTaskCollection = {
    readonly id: LocalTaskCollectionId;
    readonly name: string;
    readonly color: ThemeColor;
};

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
    dueTime,
    collections,
}: {
    status: TaskStatus;
    onStatusChange: (status: TaskStatus) => void;
    title: TaskTitle;
    assignee: AccountModel | null;
    dueTime: Date | null;
    collections: ReadonlyArray<LocalTaskCollection>;
}) {
    const {timeZone} = useClientInfo();
    const currentTime = useCurrentTimeRoundedToHour();

    const fieldElements = useMemo(() => {
        const fieldElements = [];

        if (assignee) {
            fieldElements.push(
                <Box display="flex" alignItems="center" gap="2" maxWidth="32" paddingRight="2">
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

        if (dueTime) {
            const dayDifference = differenceInDays(currentTime, dueTime);

            let dueTimeText: string;
            if (dayDifference === 0) {
                dueTimeText = "Today";
            } else if (dayDifference === 1) {
                dueTimeText = "Yesterday";
            } else if (dayDifference === -1) {
                dueTimeText = "Tomorrow";
            } else {
                const isCurrentYear = currentTime.getFullYear() === dueTime.getFullYear();

                const formatter = new Intl.DateTimeFormat("en-US", {
                    timeZone,
                    calendar: "iso8601",
                    year: !isCurrentYear ? "numeric" : undefined,
                    month: "short",
                    day: "numeric",
                });

                dueTimeText = formatter.format(dueTime);
            }

            fieldElements.push(
                <Box
                    display="flex"
                    alignItems="center"
                    gap="1"
                    color={status === "Open" && dayDifference >= 1 ? "red-60" : "grey-60"}
                    paddingRight="2"
                >
                    <CalendarBlank size={spacing["4"]} />
                    <Box fontStyle="truncate">{dueTimeText}</Box>
                </Box>,
            );
        }

        for (const collection of collections) {
            fieldElements.push(
                <Box
                    backgroundColor="grey-5"
                    height="5"
                    paddingRight="1.5"
                    paddingY="0.5"
                    marginY="-0.5"
                    marginLeft="-0.5"
                    borderRadius="base"
                    display="flex"
                    alignItems="center"
                >
                    <Box width="5" display="flex" justifyContent="center">
                        <Box
                            width="1.5"
                            height="1.5"
                            borderRadius="full"
                            backgroundColor={`${collection.color}-50-const`}
                        />
                    </Box>
                    <Box>{collection.name}</Box>
                </Box>,
            );
        }

        return fieldElements;
    }, [assignee, collections, currentTime, dueTime, status, timeZone]);

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
                    fontSize="100"
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
                <Box display="flex" flexWrap="wrap" columnGap="3" rowGap="3">
                    {fieldElements.map((node, index) => cloneElement(node, {key: index}))}
                </Box>
            )}
        </Box>
    );
}
