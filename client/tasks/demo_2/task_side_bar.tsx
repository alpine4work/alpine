import {CalendarBlank, IconContext, Notepad} from "phosphor-react";
import {ReactNode} from "react";
import {Box} from "~/client/design/box";
import {spacing} from "~/shared/design/spacing";
import {colorSchemeVars} from "~/shared/styles/styles";

export function TaskSideBar() {
    return (
        <Box
            width="64"
            height="full"
            backgroundColor="grey-0"
            borderRight="grey-10"
            overflowX="hidden"
            overflowY="scroll"
        >
            <Box padding="2" display="flex" flexDirection="column">
                <TaskSideBarNavigationItem icon={<Notepad />} label="Notepad" isSelected={true} />
                <TaskSideBarNavigationItem
                    label="Planner"
                    icon={<CalendarBlank />}
                    isSelected={false}
                />
            </Box>
        </Box>
    );
}

function TaskSideBarNavigationItem({
    label,
    icon,
    isSelected,
}: {
    label: string;
    icon: ReactNode;
    isSelected: boolean;
}) {
    return (
        <Box
            padding="2"
            display="flex"
            gap="1.5"
            borderRadius="md"
            backgroundColor={isSelected ? "grey-5" : undefined}
        >
            <IconContext.Provider
                value={{
                    color: colorSchemeVars["grey-70"],
                    size: spacing["4"],
                }}
            >
                {icon}
            </IconContext.Provider>
            <Box>{label}</Box>
        </Box>
    );
}
