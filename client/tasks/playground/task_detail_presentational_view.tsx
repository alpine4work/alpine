import {CalendarDate} from "@internationalized/date";
import {ReactNode, useId, useMemo} from "react";
import {AccountAvatar} from "~/client/accounts/account_avatar";
import {AccountShortName} from "~/client/accounts/account_short_name";
import {Box} from "~/client/design/box";
import {FocusRing} from "~/client/design/focus_ring";
import {TaskTitle} from "~/client/tasks/internal/task_title_schema";
import {TaskCollectionChip} from "~/client/tasks/playground/internal/task_collection_chip";
import {TaskDetailDueDateField} from "~/client/tasks/playground/internal/task_detail_due_date_field";
import {TaskDetailTitleInput} from "~/client/tasks/playground/internal/task_detail_title_input";
import {LocalTaskCollection} from "~/client/tasks/playground/local_task_collection";
import {TaskStatus, TaskStatusButton} from "~/client/tasks/playground/task_status_button";
import {AccountModel} from "~/shared/models/account_model";
import {fontSizes, sprinkles} from "~/shared/styles/styles";

// TODO(calebmer): Needs:
//
// [x] Title
// [x] Open/close button
// [ ] Assignee field
// [ ] Due date field
// [ ] Collections field
// [ ] Custom fields
// [ ] Subtasks
// [ ] Open detail interaction
// [ ] Notes
// [ ] Comments
// [ ] Activity

export function TaskDetailPresentationalView({
    status,
    onStatusChange,
    title,
    onTitleChange,
    assignee,
    dueDate,
    onDueDateChange,
    collections,
}: {
    status: TaskStatus;
    onStatusChange: (status: TaskStatus) => void;
    title: TaskTitle;
    onTitleChange: (title: TaskTitle) => void;
    assignee: AccountModel | null;
    dueDate: CalendarDate | null;
    onDueDateChange: (dueDate: CalendarDate | null) => void;
    collections: ReadonlyArray<LocalTaskCollection>;
}) {
    return (
        <Box minHeight="full" display="flex">
            <Box
                flexGrow="1"
                maxWidth="160"
                padding="7"
                display="flex"
                flexDirection="column"
                gap="7"
                borderRight="grey-10"
            >
                <Box display="flex" gap="4">
                    <Box
                        flexShrink="0"
                        display="flex"
                        alignItems="center"
                        style={{height: fontSizes["300"].lineHeight}}
                    >
                        <TaskStatusButton
                            size="5"
                            status={status}
                            onStatusChange={onStatusChange}
                        />
                    </Box>
                    <FocusRing isVisibleWhenFocusWithin>
                        <Box
                            flexGrow="1"
                            fontSize="300"
                            // Some extra padding to visually balance the title with the left-aligned
                            // status button.
                            paddingRight="4"
                            color={status === "Closed" ? "grey-60" : "grey-text"}
                        >
                            <TaskDetailTitleInput
                                title={title}
                                onTitleChange={onTitleChange}
                                placeholder="Untitled"
                            />
                        </Box>
                    </FocusRing>
                </Box>
                <Box display="flex" flexDirection="column" gap="5">
                    {useMemo(
                        () => (
                            <TaskDetailViewField label="Assignee">
                                {assignee && (
                                    <Box display="flex" alignItems="center" gap="2">
                                        <Box position="relative" width="4" height="4">
                                            <Box position="absolute" top="-0.5" left="-0.5">
                                                <AccountAvatar size="5" account={assignee} />
                                            </Box>
                                        </Box>
                                        <Box fontStyle="truncate">
                                            <AccountShortName account={assignee} />
                                        </Box>
                                    </Box>
                                )}
                            </TaskDetailViewField>
                        ),
                        [assignee],
                    )}
                    <TaskDetailViewField label="Due date">
                        {({"aria-labelledby": ariaLabelledBy}) =>
                            dueDate && (
                                <TaskDetailDueDateField
                                    status={status}
                                    dueDate={dueDate}
                                    onDueDateChange={onDueDateChange}
                                    aria-labelledby={ariaLabelledBy}
                                />
                            )
                        }
                    </TaskDetailViewField>
                    {useMemo(
                        () => (
                            <TaskDetailViewField label="Collections">
                                <Box display="flex" flexWrap="wrap" gap="3">
                                    {collections.map(collection => (
                                        <Box key={collection.id} marginY="-0.5" marginLeft="-0.5">
                                            <TaskCollectionChip collection={collection} />
                                        </Box>
                                    ))}
                                </Box>
                            </TaskDetailViewField>
                        ),
                        [collections],
                    )}
                </Box>
            </Box>
        </Box>
    );
}

function TaskDetailViewField({
    label,
    children,
}: {
    label: string;
    children?: ReactNode | ((props: {"aria-labelledby": string}) => ReactNode);
}) {
    const labelId = useId();

    return (
        <Box display="flex" gap="5">
            <label
                id={labelId}
                className={sprinkles({
                    display: "block",
                    width: "24",
                    color: "grey-50",
                    textAlign: "right",
                })}
            >
                {label}
            </label>
            <Box>
                {typeof children === "function" ? children({"aria-labelledby": labelId}) : children}
            </Box>
        </Box>
    );
}
