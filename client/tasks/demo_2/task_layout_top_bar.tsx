import {CaretDown, Plus, User, UserPlus, Users} from "phosphor-react";
import {Box} from "~/client/design/box";
import {Button} from "~/client/design/button";
import {MenuButton} from "~/client/design/menu_button";
import {useNavigate} from "~/client/remix/use_navigate";
import {useSpaceContext} from "~/client/spaces/space_context";
import {TaskLayoutTopBarCollectionsButton} from "~/client/tasks/demo_2/internal/task_layout_top_bar_collections_button";
import {useLocalTasksState} from "~/client/tasks/demo_2/local_tasks_state";
import {serializeTaskQueryFiltersSearchParam} from "~/client/tasks/demo_2/task_query_filter";
import {serializeTaskQuerySortsSearchParam} from "~/client/tasks/demo_2/task_query_sort";

export function TaskLayoutTopBar({
    isNotepadTabActive,
    isCollectionsTabActive,
    isViewsTabActive,
}: {
    isNotepadTabActive: boolean;
    isCollectionsTabActive: boolean;
    isViewsTabActive: boolean;
}) {
    const navigate = useNavigate();
    const {space} = useSpaceContext();
    const [state] = useLocalTasksState();

    return (
        <Box
            flexShrink="0"
            height="10"
            backgroundColor="grey-0"
            borderBottom="grey-10"
            position="relative"
            zIndex="10"
            display="flex"
            alignItems="center"
            gap="4"
            paddingX="2"
        >
            <Button
                variant={isNotepadTabActive ? "quiet-on" : "quieter"}
                height="6"
                paddingX="2"
                pressErrorTitle="Couldn’t open notepad"
                onPress={() => navigate(`/s/${space.id}/tasks/demo-2`)}
            >
                Notepad
            </Button>
            <TaskLayoutTopBarCollectionsButton
                state={state}
                isCollectionsTabActive={isCollectionsTabActive}
            />
            <MenuButton
                width="64"
                iconSize="4"
                actions={[
                    [
                        {
                            label: "New view",
                            icon: <Plus />,
                            pressErrorTitle: "Couldn’t create new view",
                            onPress: async () => {
                                await navigate(`/s/${space.id}/tasks/demo-2/view`);
                            },
                        },
                    ],
                    [
                        {
                            label: "Tasks I’ve created",
                            icon: <UserPlus />,
                            pressErrorTitle: "Couldn’t open view",
                            onPress: async () => {
                                const filtersSearchParam = serializeTaskQueryFiltersSearchParam([
                                    {
                                        type: "Creator",
                                        operation: {
                                            type: "OneOf",
                                            accounts: [{type: "CurrentAccount"}],
                                        },
                                    },
                                ]);

                                const sortsSearchParam = serializeTaskQuerySortsSearchParam([
                                    {
                                        type: "CreatedDate",
                                        direction: "Descending",
                                    },
                                ]);

                                await navigate(
                                    `/s/${space.id}/tasks/demo-2/view?filter=${filtersSearchParam}&sort=${sortsSearchParam}`,
                                );
                            },
                        },
                        {
                            label: "Tasks assigned to me",
                            icon: <User />,
                            pressErrorTitle: "Couldn’t open view",
                            onPress: async () => {
                                const filtersSearchParam = serializeTaskQueryFiltersSearchParam([
                                    {
                                        type: "Assignee",
                                        operation: {
                                            type: "OneOf",
                                            accounts: [{type: "CurrentAccount"}],
                                        },
                                    },
                                ]);

                                const sortsSearchParam = serializeTaskQuerySortsSearchParam([
                                    {
                                        type: "CreatedDate",
                                        direction: "Descending",
                                    },
                                ]);

                                await navigate(
                                    `/s/${space.id}/tasks/demo-2/view?filter=${filtersSearchParam}&sort=${sortsSearchParam}`,
                                );
                            },
                        },
                        {
                            label: "Tasks I’ve assigned to others",
                            icon: <Users />,
                            pressErrorTitle: "Couldn’t open view",
                            onPress: async () => {
                                const filtersSearchParam = serializeTaskQueryFiltersSearchParam([
                                    {
                                        type: "Assigner",
                                        operation: {
                                            type: "OneOf",
                                            accounts: [{type: "CurrentAccount"}],
                                        },
                                    },
                                ]);

                                const sortsSearchParam = serializeTaskQuerySortsSearchParam([
                                    {
                                        type: "CreatedDate",
                                        direction: "Descending",
                                    },
                                ]);

                                await navigate(
                                    `/s/${space.id}/tasks/demo-2/view?filter=${filtersSearchParam}&sort=${sortsSearchParam}`,
                                );
                            },
                        },
                    ],
                ]}
            >
                <Button
                    variant={isViewsTabActive ? "quiet-on" : "quieter"}
                    height="6"
                    paddingX="2"
                    icon={<CaretDown />}
                    iconPlacement="end"
                >
                    Views
                </Button>
            </MenuButton>
        </Box>
    );
}
