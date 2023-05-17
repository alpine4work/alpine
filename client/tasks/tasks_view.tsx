import {useRef} from "react";
import {Box} from "~/client/design/box";
import {TaskRowView, TaskRowViewRef} from "~/client/tasks/task_row_view";
import {assertExists} from "~/shared/helpers/control/assert_exists";

export function TasksView() {
    const firstTaskRowRef = useRef<TaskRowViewRef>(null);
    const lastTaskRowRef = useRef<TaskRowViewRef>(null);

    return (
        <Box
            flexGrow="1"
            backgroundColor="grey-0"
            // Create an illusion that our tasks view is a text editor that extends into
            // the margins by giving the margin a text cursor and making it clickable
            // which puts focus in the task.
            //
            // This is an affordance for mouse users, does not need to be usable
            // by keyboard.
            cursor="text"
            onClick={event => {
                // Only handle clicks on the background not covered by content.
                if (event.target === event.currentTarget) {
                    assertExists(lastTaskRowRef.current).focusEnd();
                }
            }}
        >
            <Box
                height="9"
                width="full"
                cursor="text"
                // Create an illusion that our tasks view is a text editor that extends into
                // the margins by giving the margin a text cursor and making it clickable
                // which puts focus in the task.
                //
                // This is an affordance for mouse users, does not need to be usable
                // by keyboard.
                onClick={() => {
                    assertExists(firstTaskRowRef.current).focusStart();
                }}
            />
            <TaskRowView ref={firstTaskRowRef} isFirstRow={true} />
            <TaskRowView isFirstRow={false} />
            <TaskRowView ref={lastTaskRowRef} isFirstRow={false} />
        </Box>
    );
}
