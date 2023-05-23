import {useMemo} from "react";
import {Box} from "~/client/design/box";
import {TaskTitle} from "~/client/tasks/internal/task_title_schema";
import {LocalTaskCollection} from "~/client/tasks/playground/local_task_collection";
import {TaskStatus, TaskStatusButton} from "~/client/tasks/playground/task_status_button";
import {AccountModel} from "~/shared/models/account_model";
import {serializeProsemirrorFragmentToHtml} from "~/shared/prosemirror/serialize_prosemirror_node_to_html";
import {fontSizes} from "~/shared/styles/styles";

// TODO(calebmer): Needs:
//
// [ ] Title
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
    return (
        <Box minHeight="full" display="flex">
            <Box flexGrow="1" maxWidth="160" padding="7" borderRight="grey-10">
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
                    <Box
                        flexGrow="1"
                        fontSize="300"
                        // Some extra padding to visually balance the title with the left-aligned
                        // status button.
                        paddingRight="4"
                        color={status === "Closed" ? "grey-60" : "grey-text"}
                        dangerouslySetInnerHTML={useMemo(
                            () => ({
                                __html: serializeProsemirrorFragmentToHtml(title.content),
                            }),
                            [title],
                        )}
                    />
                </Box>
            </Box>
        </Box>
    );
}
