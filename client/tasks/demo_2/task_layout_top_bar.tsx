import {CaretDown, Plus, User, UserPlus, Users} from "phosphor-react";
import {Box} from "~/client/design/box";
import {Button} from "~/client/design/button";
import {MenuButton} from "~/client/design/menu_button";
import {useNavigate} from "~/client/remix/use_navigate";
import {useSpaceContext} from "~/client/spaces/space_context";
import {serializeTaskQueryFiltersSearchParam} from "~/client/tasks/demo_2/task_query_filter";

export function TaskLayoutTopBar() {
    const navigate = useNavigate();
    const {space} = useSpaceContext();

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
                variant="quiet-on"
                height="6"
                paddingX="2"
                pressErrorTitle="Couldn’t open notepad"
                onPress={() => navigate(`/s/${space.id}/tasks/demo-2`)}
            >
                Notepad
            </Button>
            <Button
                variant="quieter"
                height="6"
                paddingX="2"
                onPress={() => {
                    // NOCOMMIT
                }}
            >
                Planner
            </Button>
            <MenuButton
                width="64"
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

                                await navigate(
                                    `/s/${space.id}/tasks/demo-2/view?filters=${filtersSearchParam}`,
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

                                await navigate(
                                    `/s/${space.id}/tasks/demo-2/view?filters=${filtersSearchParam}`,
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

                                await navigate(
                                    `/s/${space.id}/tasks/demo-2/view?filters=${filtersSearchParam}`,
                                );
                            },
                        },
                    ],
                ]}
            >
                <Button
                    variant="quieter"
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
