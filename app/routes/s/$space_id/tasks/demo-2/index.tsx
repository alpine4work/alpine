import {useIsInitialAppRender} from "~/client/helpers/lifecycle/use_is_initial_app_render";
import {TaskNotepadView} from "~/client/tasks/demo_2/task_notepad_view";

export default function TasksRoute() {
    const isInitialAppRender = useIsInitialAppRender();

    return (
        <TaskNotepadView
            // Fully remount after initial render since our data is coming from
            // localStorage` so we want our components to be fresh with the
            // correct data.
            key={String(isInitialAppRender)}
        />
    );
}
