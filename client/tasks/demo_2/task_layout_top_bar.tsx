import {
    CalendarCheck,
    CaretDown,
    Notepad,
    Plus,
    Table,
    User,
    UserPlus,
    Users,
} from "phosphor-react";
import {Box} from "~/client/design/box";
import {Button} from "~/client/design/button";
import {MenuButton} from "~/client/design/menu_button";
import {spacing} from "~/shared/design/spacing";

export function TaskLayoutTopBar() {
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
            <Button variant="quiet-on" height="6" paddingX="2">
                Notepad
            </Button>
            <Button variant="quieter" height="6" paddingX="2">
                Planner
            </Button>
            <MenuButton
                width="64"
                actions={[
                    [
                        {
                            label: "New view",
                            icon: <Plus />,
                            onPress: () => {
                                // NOCOMMIT
                            },
                        },
                    ],
                    [
                        {
                            label: "Tasks I’ve created",
                            icon: <UserPlus />,
                            onPress: () => {
                                // NOCOMMIT
                            },
                        },
                        {
                            label: "Tasks assigned to me",
                            icon: <User />,
                            onPress: () => {
                                // NOCOMMIT
                            },
                        },
                        {
                            label: "Tasks I’ve assigned to others",
                            icon: <Users />,
                            onPress: () => {
                                // NOCOMMIT
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
