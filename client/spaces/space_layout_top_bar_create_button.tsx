import {
    ChatsCircle,
    EnvelopeOpen,
    FileText,
    IconContext,
    ListChecks,
    Plus,
    SpinnerGap,
} from "phosphor-react";
import {ReactNode} from "react";
import {Box} from "~/client/design/box";
import {IconButton} from "~/client/design/icon_button";
import {MenuButton} from "~/client/design/menu_button";
import {useShowToast} from "~/client/design/toast";
import {usePeekStackContext} from "~/client/peek/peek_stack";
import {useSpaceContext} from "~/client/spaces/space_context";
import {spacing} from "~/shared/design/spacing";
import {UnimplementedError} from "~/shared/error/error";
import {errorDisplayMessage} from "~/shared/error/error_display_message";
import {generateId} from "~/shared/id/id";
import {spinAnimationClassName} from "~/shared/styles/styles";

export function SpaceLayoutTopBarCreateButton() {
    const {space} = useSpaceContext();
    const showToast = useShowToast();
    const peekStackContext = usePeekStackContext();

    return (
        <MenuButton
            actions={[
                {
                    withCustomLayout: true,
                    onPress: () => {
                        showToast({
                            type: "Error",
                            title: "Can not find a channel to post in",
                            error: new UnimplementedError("Chat has not been implemented yet", {
                                displayMessage: errorDisplayMessage`Chat has not been implemented yet.`,
                            }),
                        });
                    },
                    render: ({isHovered, isPressed, shouldShowPendingSpinner}) => (
                        <SpaceLayoutTopBarCreateButtonItem
                            icon={<ChatsCircle />}
                            label="Send a chat message"
                            description="Start a conversation with anyone"
                            isHovered={isHovered}
                            isPressed={isPressed}
                            shouldShowPendingSpinner={shouldShowPendingSpinner}
                        />
                    ),
                },
                {
                    withCustomLayout: true,
                    onPress: () => {
                        showToast({
                            type: "Error",
                            title: "Can not find a channel to post in",
                            error: new UnimplementedError(
                                "Channel explorer has not been implemented yet",
                                {
                                    displayMessage: errorDisplayMessage`Channel explorer has not been implemented yet.`,
                                },
                            ),
                        });
                    },
                    render: ({isHovered, isPressed, shouldShowPendingSpinner}) => (
                        <SpaceLayoutTopBarCreateButtonItem
                            icon={<EnvelopeOpen />}
                            label="Post in a channel"
                            description="Share your ideas with everyone"
                            isHovered={isHovered}
                            isPressed={isPressed}
                            shouldShowPendingSpinner={shouldShowPendingSpinner}
                        />
                    ),
                },
                {
                    withCustomLayout: true,
                    pressErrorTitle: "Couldn’t create document",
                    onPress: async () => {
                        const documentId = generateId();
                        await peekStackContext.push(
                            `/s/${space.id}/documents/${documentId}?create`,
                            {focus: true},
                        );
                    },
                    render: ({isHovered, isPressed, shouldShowPendingSpinner}) => (
                        <SpaceLayoutTopBarCreateButtonItem
                            icon={<FileText />}
                            label="Create a document"
                            description="Write what’s on your mind"
                            isHovered={isHovered}
                            isPressed={isPressed}
                            shouldShowPendingSpinner={shouldShowPendingSpinner}
                        />
                    ),
                },
                {
                    withCustomLayout: true,
                    onPress: () => {
                        showToast({
                            type: "Error",
                            title: "Can not create a task",
                            error: new UnimplementedError("Tasks have not been implemented yet", {
                                displayMessage: errorDisplayMessage`Tasks have not been implemented yet.`,
                            }),
                        });
                    },
                    render: ({isHovered, isPressed, shouldShowPendingSpinner}) => (
                        <SpaceLayoutTopBarCreateButtonItem
                            icon={<ListChecks />}
                            label="Create a task"
                            description="Keep track of work to do later"
                            isHovered={isHovered}
                            isPressed={isPressed}
                            shouldShowPendingSpinner={shouldShowPendingSpinner}
                        />
                    ),
                },
            ]}
        >
            <IconButton size="md" description="Create" tooltipPlacement="bottom">
                <Plus />
            </IconButton>
        </MenuButton>
    );
}

function SpaceLayoutTopBarCreateButtonItem({
    icon,
    label,
    description,
    isHovered,
    isPressed,
    shouldShowPendingSpinner,
}: {
    icon: ReactNode;
    label: string;
    description: string;
    isHovered: boolean;
    isPressed: boolean;
    shouldShowPendingSpinner: boolean;
}) {
    return (
        <Box
            paddingLeft="3"
            paddingRight="3"
            paddingY="3"
            display="flex"
            alignItems="center"
            gap="3"
        >
            <Box
                flexShrink="0"
                padding="2"
                backgroundColor={
                    isPressed
                        ? {light: "grey-20", dark: "grey-30"}
                        : isHovered
                        ? {light: "grey-10", dark: "grey-20"}
                        : {light: "grey-5", dark: "grey-10"}
                }
                color={isPressed ? "grey-90" : {light: "grey-70", dark: "grey-80"}}
                borderRadius="full"
            >
                <IconContext.Provider
                    value={{
                        size: spacing["6"],
                        weight: "light",
                        color: "currentColor",
                    }}
                >
                    {icon}
                </IconContext.Provider>
            </Box>
            <Box flexGrow="1">
                <Box fontStyle="semi-bold" fontSize="100" paddingBottom="0.5">
                    {label}
                </Box>
                <Box fontSize="75" color="grey-60">
                    {description}
                </Box>
            </Box>
            <Box flexShrink="0" width="4">
                {shouldShowPendingSpinner && (
                    <SpinnerGap className={spinAnimationClassName} size={spacing["4"]} />
                )}
            </Box>
        </Box>
    );
}
