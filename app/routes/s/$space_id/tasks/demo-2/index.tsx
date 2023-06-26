import {useIsInitialAppRender} from "~/client/helpers/lifecycle/use_is_initial_app_render.js";
import {TaskNotepadView} from "~/client/tasks/demo_2/task_notepad_view.js";

export default function TasksRoute() {
    const isInitialAppRender = useIsInitialAppRender();

    return (
        <TaskNotepadView
            // Fully remount after initial render since our data is coming from
            // `localStorage` so we want our components to be fresh with the
            // correct data.
            //
            // TODO(calebmer): Remove this in a production implementation.
            key={String(isInitialAppRender)}
        />
    );
}
