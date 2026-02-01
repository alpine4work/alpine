import classNames from "classnames";
import {Plus} from "phosphor-react";
import {Box} from "~/client/web/design/box.js";
import {IconButton} from "~/client/web/design/icon_button.js";
import {usePeekContext} from "~/client/web/remix/peek_context.js";
import {useNavigate} from "~/client/web/remix/use_navigate.js";
import {useSpaceContext} from "~/client/web/spaces/space_context.js";
import {pointerEventsNoneNotInheritedClassName} from "~/client/web/styles/styles.js";
import {greyElevated2ClassName} from "~/shared/design/core/constant_class_names.js";
import {generateId} from "~/shared/id/id.js";
import {
    TaskQueryFilter,
    serializeTaskQueryFiltersSearchParam,
} from "~/shared/tasks/task_query_filter.js";

export function TaskFloatingCreateButton({filters}: {filters?: ReadonlyArray<TaskQueryFilter>}) {
    const navigate = useNavigate();
    const {space} = useSpaceContext();

    const peekContext = usePeekContext();

    // Don't render the floating create button when inside the peek stack. Since if
    // you render a task collection view peek on top of a task collection, it would
    // be weird to see two create buttons next to each other.
    //
    // We do want to show the floating create button in search, though.
    if (peekContext?.withinStack) return null;

    return (
        <Box
            position="absolute"
            bottom="3"
            right="3"
            zIndex="10"
            className={classNames(greyElevated2ClassName, pointerEventsNoneNotInheritedClassName)}
        >
            <IconButton
                variant="quiet-elevation-20"
                size="xl"
                description="Create task"
                // NOTE(calebmer): I feel like the extra button affordance is helpful here. The
                // create button floating in its own little island doesn't feel clearly
                // interactive enough.
                //
                // This is purely based on vibes. I don't have logic for it.
                cursor="pointer"
                pressErrorTitle="Couldn&#x2019;t create task"
                onPress={async () => {
                    if (!filters) {
                        const taskId = generateId();
                        await navigate(`/s/${space.id}/tasks/${taskId}?create&focus`);
                    } else {
                        const createSearchParam = serializeTaskQueryFiltersSearchParam(filters);

                        const taskId = generateId();
                        await navigate(
                            `/s/${space.id}/tasks/${taskId}?create=${createSearchParam}&focus`,
                        );
                    }
                }}
            >
                <Plus />
            </IconButton>
        </Box>
    );
}
