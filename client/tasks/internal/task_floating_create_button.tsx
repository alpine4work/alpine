import classNames from "classnames";
import {Plus} from "phosphor-react";
import {Box} from "~/client/design/box.js";
import {IconButton} from "~/client/design/icon_button.js";
import {usePlatform} from "~/client/remix/platform_context.js";
import {useRouteLayout} from "~/client/remix/route_layout_context.js";
import {useNavigate} from "~/client/remix/use_navigate.js";
import {useSpaceContext} from "~/client/spaces/space_context.js";
import {
    greyElevated2ClassName,
    pointerEventsNoneNotInheritedClassName,
} from "~/client/styles/styles.js";
import {generateId} from "~/shared/id/id.js";
import {
    TaskQueryFilter,
    serializeTaskQueryFiltersSearchParam,
} from "~/shared/tasks/task_query_filter.js";

export function TaskFloatingCreateButton({filters}: {filters?: ReadonlyArray<TaskQueryFilter>}) {
    const navigate = useNavigate();
    const platform = usePlatform();
    const routeLayout = useRouteLayout();
    const {space} = useSpaceContext();

    // Don't show the floating create button on narrow layouts. This avoids the
    // case where you have a task collection open then another task collection in a
    // peek and the floating create buttons appear to overlap which looks weird.
    //
    // We do render the floating create button on mobile, though. Since it's handy
    // to quickly create a task on mobile and there are no peeks to create visual
    // conflicts.
    if (platform !== "mobile" && routeLayout === "narrow") return null;

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
                pressErrorTitle="Couldn’t create task"
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
