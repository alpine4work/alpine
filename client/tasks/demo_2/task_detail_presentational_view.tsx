import {CalendarDate} from "@internationalized/date";
import {DotsThree} from "phosphor-react";
import {ReactNode, useId, useMemo, useRef} from "react";
import {AccountAvatar} from "~/client/accounts/account_avatar";
import {AccountShortName} from "~/client/accounts/account_short_name";
import {Box} from "~/client/design/box";
import {getNextFocusableElementIfExists} from "~/client/design/helpers/get_next_focusable_element";
import {IconButton} from "~/client/design/icon_button";
import {MenuButton} from "~/client/design/menu_button";
import {useIsMobile} from "~/client/remix/use_is_mobile";
import {TaskCollectionChip} from "~/client/tasks/demo_2/internal/task_collection_chip";
import {TaskDetailDueDateField} from "~/client/tasks/demo_2/internal/task_detail_due_date_field";
import {TaskDetailNotesField} from "~/client/tasks/demo_2/internal/task_detail_notes_field";
import {TaskDetailTitleInput} from "~/client/tasks/demo_2/internal/task_detail_title_input";
import {LocalTaskCollection} from "~/client/tasks/demo_2/local_task_collection";
import {TaskAssignee, TaskStatus, TaskStatusButton} from "~/client/tasks/demo_2/task_status_button";
import {AccountModel} from "~/shared/accounts/account_model";
import {Spacing, assertSpacing} from "~/shared/design/spacing";
import {UnimplementedError} from "~/shared/error/error";
import {assertExists} from "~/shared/helpers/control/assert_exists";
import {sprinkles} from "~/shared/styles/styles";
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
// [ ] Mark as in progress
// [ ] Subtasks
// [x] Notes
// [ ] Comments
// [ ] Activity
// [ ] Dark mode pass

export const taskDetailPresentationalViewMaxWidth: Spacing = "160";

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
    assignee: TaskAssignee | null;
    dueDate: CalendarDate | null;
    onDueDateChange: (dueDate: CalendarDate | null) => void;
    collections: ReadonlyArray<LocalTaskCollection>;
    notesContent: TaskNotesContentWithReferences;
    onNotesContentChange: (notesContent: TaskNotesContentWithReferences) => void;
}) {
    const isMobile = useIsMobile();
    const padding: Spacing = isMobile ? "3" : "5";

    return (
        <Box
            maxWidth={taskDetailPresentationalViewMaxWidth}
            paddingY={padding}
            display="flex"
            flexDirection="column"
            gap="10"
            position="relative"
            backgroundColor="grey-0"
        >
            <Box paddingX={padding} display="flex" flexDirection="column" gap="3">
                <TaskStatusButton
                    size="5"
                    assignee={assignee}
                    status={status}
                    onStatusChange={onStatusChange}
                />
                <Box
                    position="absolute"
                    top={assertSpacing(`${parseInt(padding, 10) - 2}`)}
                    right={assertSpacing(`${parseInt(padding, 10) - 2}`)}
                >
                    <MenuButton
                        actions={[
                            {
                                label: "Copy link",
                                pressErrorTitle: "Couldn’t copy task link",
                                onPress: async () => {
                                    // NOCOMMIT
                                    throw new UnimplementedError("TODO");
                                },
                            },
                        ]}
                    >
                        <IconButton description="More" withoutTooltip={true}>
                            <DotsThree />
                        </IconButton>
                    </MenuButton>
                </Box>
                <TaskDetailTitleInput
                    status={status}
                    title={title}
                    onTitleChange={onTitleChange}
                    placeholder="Untitled task"
                />
            </Box>
            <TaskDetailViewDenseFields
                status={status}
                assigneeAccount={assignee?.account ?? null}
                dueDate={dueDate}
                onDueDateChange={onDueDateChange}
                collections={collections}
                padding={padding}
            />
            <TaskDetailNotesField
                notesContent={notesContent}
                onNotesContentChange={onNotesContentChange}
                padding={padding}
            />
            <Box>
                <Box paddingX={padding} paddingBottom="1.5" color="grey-60">
                    Subtasks
                </Box>
                <Box>
                    {/* <Box paddingX={padding}>
                            <Box
                                height="9"
                                fontSize="100"
                                display="flex"
                                alignItems="center"
                                borderY="grey-5"
                                style={inputPlaceholderStyles}
                            >
                                Add a subtask…
                            </Box>
                        </Box> */}
                    <Box paddingX={padding}>
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
                    <Box paddingX={padding}>
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
                    <Box paddingX={padding}>
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
                    <Box paddingX={padding}>
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
                    <Box paddingX={padding}>
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
                    <Box paddingX={padding}>
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
                    <Box paddingX={padding}>
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
                    <Box paddingX={padding}>
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
    );
}

function TaskDetailViewDenseFields({
    status,
    assigneeAccount,
    dueDate,
    onDueDateChange,
    collections,
    padding,
}: {
    status: TaskStatus;
    assigneeAccount: AccountModel | null;
    dueDate: CalendarDate | null;
    onDueDateChange: (dueDate: CalendarDate | null) => void;
    collections: ReadonlyArray<LocalTaskCollection>;
    padding: Spacing;
}) {
    return (
        <Box
            paddingX={padding}
            display="grid"
            flexDirection="column"
            gap="5"
            style={{
                gridTemplateColumns: "auto 1fr",
                gridTemplateRows: "repeat(3, auto)",
                gridAutoFlow: "row dense",
            }}
        >
            {useMemo(
                () => (
                    <TaskDetailViewField label="Assignee">
                        {assigneeAccount && (
                            <Box display="flex" alignItems="center" gap="2">
                                <Box position="relative" width="4" height="4">
                                    <Box position="absolute" top="-0.5" left="-0.5">
                                        <AccountAvatar size="5" account={assigneeAccount} />
                                    </Box>
                                </Box>
                                <Box fontStyle="truncate">
                                    <AccountShortName account={assigneeAccount} />
                                </Box>
                            </Box>
                        )}
                    </TaskDetailViewField>
                ),
                [assigneeAccount],
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
        <>
            <label
                id={labelId}
                className={sprinkles({
                    display: "block",
                    maxWidth: "24",
                    fontStyle: "truncate",
                    color: "grey-60",
                })}
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
        </>
    );
}
