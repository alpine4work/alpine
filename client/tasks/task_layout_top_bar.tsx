import {CaretDown, Plus, User, UserPlus, Users} from "phosphor-react";
import {Box} from "~/client/design/box.js";
import {Button} from "~/client/design/button.js";
import {MenuButton} from "~/client/design/menu_button.js";
import {useNavigate} from "~/client/remix/use_navigate.js";
import {useSpaceContext} from "~/client/spaces/space_context.js";
import {TaskLayoutTopBarCollectionsButton} from "~/client/tasks/internal/task_layout_top_bar_collections_button.js";
import {spacing} from "~/shared/design/spacing.js";
import {colorSchemeVars} from "~/shared/styles/styles.js";
import {serializeTaskQueryFiltersSearchParam} from "~/shared/tasks/task_query_filter.js";
import {serializeTaskQuerySortsSearchParam} from "~/shared/tasks/task_query_sort.js";

export function TaskLayoutTopBar({
    isNotepadTabActive,
    isCollectionsTabActive,
    isViewsTabActive,
    withoutBorderBottom,
}: {
    isNotepadTabActive: boolean;
    isCollectionsTabActive: boolean;
    isViewsTabActive: boolean;
    withoutBorderBottom: boolean;
}) {
    const navigate = useNavigate();
    const {space} = useSpaceContext();

    return (
        <Box
            flexShrink="0"
            backgroundColor="grey-0"
            position="relative"
            zIndex="10"
            display="flex"
            alignItems="center"
            gap="4"
            paddingX="2"
            style={{
                height: !withoutBorderBottom ? spacing["10"] : `calc(${spacing["10"]} - 1px)`,
                borderBottomWidth: !withoutBorderBottom ? 1 : 0,
                borderBottomColor: colorSchemeVars["grey-10"],
            }}
        >
            <Button
                variant={isNotepadTabActive ? "quiet-on" : "quieter"}
                height="6"
                paddingX="2"
                pressErrorTitle="Couldn’t open notepad"
                onPress={() => navigate(`/s/${space.id}/tasks`)}
            >
                Notepad
            </Button>
            <TaskLayoutTopBarCollectionsButton isCollectionsTabActive={isCollectionsTabActive} />
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
                                await navigate(`/s/${space.id}/tasks/view`);
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
                                        type: "CreatedTime",
                                        direction: "Descending",
                                    },
                                ]);

                                await navigate(
                                    `/s/${space.id}/tasks/view?filter=${filtersSearchParam}&sort=${sortsSearchParam}`,
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
                                        type: "CreatedTime",
                                        direction: "Descending",
                                    },
                                ]);

                                await navigate(
                                    `/s/${space.id}/tasks/view?filter=${filtersSearchParam}&sort=${sortsSearchParam}`,
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
                                        type: "CreatedTime",
                                        direction: "Descending",
                                    },
                                ]);

                                await navigate(
                                    `/s/${space.id}/tasks/view?filter=${filtersSearchParam}&sort=${sortsSearchParam}`,
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
