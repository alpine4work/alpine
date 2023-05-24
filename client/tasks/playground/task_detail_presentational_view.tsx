import {CalendarDate} from "@internationalized/date";
import classNames from "classnames";
import {ReactNode, useId, useMemo, useRef} from "react";
import {AccountAvatar} from "~/client/accounts/account_avatar";
import {AccountShortName} from "~/client/accounts/account_short_name";
import {Box} from "~/client/design/box";
import {FocusRing} from "~/client/design/focus_ring";
import {getNextFocusableElementIfExists} from "~/client/design/helpers/get_next_focusable_element";
import {TaskCollectionChip} from "~/client/tasks/playground/internal/task_collection_chip";
import {TaskDetailDueDateField} from "~/client/tasks/playground/internal/task_detail_due_date_field";
import {TaskDetailNotesField} from "~/client/tasks/playground/internal/task_detail_notes_field";
import {TaskDetailTitleInput} from "~/client/tasks/playground/internal/task_detail_title_input";
import {LocalTaskCollection} from "~/client/tasks/playground/local_task_collection";
import {TaskStatus, TaskStatusButton} from "~/client/tasks/playground/task_status_button";
import {AccountModel} from "~/shared/accounts/account_model";
import {assertExists} from "~/shared/helpers/control/assert_exists";
import {fontSizes, sprinkles} from "~/shared/styles/styles";
import {TaskNotesContentWithReferences} from "~/shared/tasks/task_notes_content_schema";
import {TaskTitle} from "~/shared/tasks/task_title_schema";

// TODO(calebmer): Needs:
//
// [x] Title
// [x] Open/close button
// [ ] Assignee field
// [x] Due date field
// [ ] Collections field
// [ ] Custom fields
// [ ] Subtasks
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
    notesContent,
    onNotesContentChange,
}: {
    status: TaskStatus;
    onStatusChange: (status: TaskStatus) => void;
    title: TaskTitle;
    onTitleChange: (title: TaskTitle) => void;
    assignee: AccountModel | null;
    dueDate: CalendarDate | null;
    onDueDateChange: (dueDate: CalendarDate | null) => void;
    collections: ReadonlyArray<LocalTaskCollection>;
    notesContent: TaskNotesContentWithReferences;
    onNotesContentChange: (notesContent: TaskNotesContentWithReferences) => void;
}) {
    return (
        <Box minHeight="full" display="flex">
            <Box
                flexGrow="1"
                maxWidth="160"
                paddingY="5"
                display="flex"
                flexDirection="column"
                gap="10"
                borderRight="grey-10"
            >
                <Box paddingX="5" display="flex" gap="4">
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
                            fontStyle="semi-bold"
                            // Some extra padding to visually balance the title with the left-aligned
                            // status button.
                            paddingRight="4"
                            color={status === "Closed" ? "grey-60" : "grey-text"}
                        >
                            <TaskDetailTitleInput
                                title={title}
                                onTitleChange={onTitleChange}
                                placeholder="Untitled task"
                            />
                        </Box>
                    </FocusRing>
                </Box>
                <Box paddingX="5" display="flex" flexDirection="column" gap="5">
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
                        {({"aria-labelledby": ariaLabelledBy}) => (
                            // TODO(calebmer): Should due date be visible or hidden by default? It is good
                            // for personal workflows but I'd wager unnecessary in many team workflows. If
                            // anything I imagine due dates can be harmful in team workflows!
                            //
                            // Maybe we do something like: Show due date by default in personal views but
                            // not in team views.
                            <TaskDetailDueDateField
                                status={status}
                                dueDate={dueDate}
                                onDueDateChange={onDueDateChange}
                                aria-labelledby={ariaLabelledBy}
                            />
                        )}
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
                <TaskDetailNotesField
                    notesContent={notesContent}
                    onNotesContentChange={onNotesContentChange}
                />
                <Box>
                    <Box paddingX="5" paddingBottom="1.5" color="grey-50">
                        Subtasks
                    </Box>
                    <Box>
                        <Box paddingX="5">
                            <Box
                                height="9"
                                fontSize="100"
                                display="flex"
                                alignItems="center"
                                borderY="grey-5"
                            >
                                Task row 1
                            </Box>
                        </Box>
                        <Box paddingX="5">
                            <Box
                                height="9"
                                fontSize="100"
                                display="flex"
                                alignItems="center"
                                borderBottom="grey-5"
                            >
                                Task row 2
                            </Box>
                        </Box>
                        <Box paddingX="5">
                            <Box
                                height="9"
                                fontSize="100"
                                display="flex"
                                alignItems="center"
                                borderBottom="grey-5"
                            >
                                Task row 3
                            </Box>
                        </Box>
                        <Box paddingX="5">
                            <Box
                                height="9"
                                fontSize="100"
                                display="flex"
                                alignItems="center"
                                borderBottom="grey-5"
                            >
                                Task row 4
                            </Box>
                        </Box>
                        <Box paddingX="5">
                            <Box
                                height="9"
                                fontSize="100"
                                display="flex"
                                alignItems="center"
                                borderBottom="grey-5"
                            >
                                Task row 5
                            </Box>
                        </Box>
                        <Box paddingX="5">
                            <Box
                                height="9"
                                fontSize="100"
                                display="flex"
                                alignItems="center"
                                borderBottom="grey-5"
                            >
                                Task row 6
                            </Box>
                        </Box>
                        <Box paddingX="5">
                            <Box
                                height="9"
                                fontSize="100"
                                display="flex"
                                alignItems="center"
                                borderBottom="grey-5"
                            >
                                Task row 7
                            </Box>
                        </Box>
                        <Box paddingX="5">
                            <Box
                                height="9"
                                fontSize="100"
                                display="flex"
                                alignItems="center"
                                borderBottom="grey-5"
                            >
                                Task row 8
                            </Box>
                        </Box>
                    </Box>
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
    const valueRef = useRef<HTMLDivElement>(null);

    return (
        <Box display="flex" gap="5">
            <label
                id={labelId}
                className={classNames(
                    // NOCOMMIT
                    // tasksStyles.detailViewFieldWidthClassName,
                    sprinkles({
                        display: "block",
                        color: "grey-50",
                        textAlign: "left",
                        width: "16",
                    }),
                )}
                // As an affordance for mouse users, when the label is clicked we focus
                // the first element in the input.
                onClick={() => {
                    getNextFocusableElementIfExists(null, {
                        withinElement: assertExists(valueRef.current),
                    })?.focus();
                }}
            >
                {label}
            </label>
            <Box ref={valueRef}>
                {typeof children === "function" ? children({"aria-labelledby": labelId}) : children}
            </Box>
        </Box>
    );
}
