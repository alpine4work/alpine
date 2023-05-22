import {useMemo} from "react";
import {Box} from "~/client/design/box";
import {TaskTitle} from "~/client/tasks/internal/task_title_schema";
import {TaskStatus, TaskStatusButton} from "~/client/tasks/playground/task_status_button";
import {parseRemLengthNumber} from "~/shared/design/spacing";
import {serializeProsemirrorFragmentToHtml} from "~/shared/prosemirror/serialize_prosemirror_node_to_html";
import {contentSchemaStyles} from "~/shared/styles/styles";

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

export function TaskCardPresentationalView({
    status,
    onStatusChange,
    title,
}: {
    status: TaskStatus;
    onStatusChange: (status: TaskStatus) => void;
    title: TaskTitle;
}) {
    return (
        <Box
            width="full"
            maxWidth="96"
            minHeight="24"
            boxShadow="elevation-10"
            borderRadius="md"
            padding="5"
        >
            <Box
                display="flex"
                gap="3"
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
        </Box>
    );
}
