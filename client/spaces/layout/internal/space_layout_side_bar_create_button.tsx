import {Plus, SpinnerGap} from "phosphor-react";
import {ReactNode} from "react";
import {Box} from "~/client/design/box.js";
import {IconButton} from "~/client/design/icon_button.js";
import {MenuButton} from "~/client/design/menu_button.js";
import {ChatBrandBigIcon} from "~/client/icons/brand/chat_brand_big_icon.js";
import {DocumentsBrandBigIcon} from "~/client/icons/brand/documents_brand_big_icon.js";
import {PostBrandBigIcon} from "~/client/icons/brand/post_brand_big_icon.js";
import {TasksBrandBigIcon} from "~/client/icons/brand/tasks_brand_big_icon.js";
import {usePeekStackContext} from "~/client/peek/peek_stack.js";
import {useSpaceContext} from "~/client/spaces/space_context.js";
import {spacing} from "~/shared/design/spacing.js";
import {generateId} from "~/shared/id/id.js";
import {spinAnimationClassName} from "~/shared/styles/styles.js";

// NOTE(calebmer): The icons used here for create actions are the same icons
// used in `<SearchResultView/>`'s `getSearchResultTypeDisplay()`. If you
// change an icon here you should also change it there.
export function SpaceLayoutSideBarCreateButton() {
    const {space} = useSpaceContext();
    const peekStackContext = usePeekStackContext();

    return (
        <MenuButton
            placement="left-start"
            actions={[
                [
                    {
                        withCustomLayout: true,
                        pressErrorTitle: "Couldn’t create post",
                        onPress: async () => {
                            const draftId = generateId();

                            await peekStackContext.push(
                                `/s/${space.id}/posts/new/${draftId}?focus=channel`,
                            );
                        },
                        render: ({isHovered, isPressed, shouldShowPendingSpinner}) => (
                            <SpaceLayoutSideBarCreateButtonItem
                                icon={<PostBrandBigIcon />}
                                label="Post"
                                description="Share your ideas in a channel"
                                isHovered={isHovered}
                                isPressed={isPressed}
                                shouldShowPendingSpinner={shouldShowPendingSpinner}
                            />
                        ),
                    },
                    {
                        withCustomLayout: true,
                        pressErrorTitle: "Couldn’t open new chat",
                        onPress: async () => {
                            await peekStackContext.push(`/s/${space.id}/chat/new`, {focus: true});
                        },
                        render: ({isHovered, isPressed, shouldShowPendingSpinner}) => (
                            <SpaceLayoutSideBarCreateButtonItem
                                icon={<ChatBrandBigIcon />}
                                label="Message"
                                description="Start a chat with anyone"
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
                            <SpaceLayoutSideBarCreateButtonItem
                                icon={<DocumentsBrandBigIcon />}
                                label="Document"
                                description="Write what’s on your mind"
                                isHovered={isHovered}
                                isPressed={isPressed}
                                shouldShowPendingSpinner={shouldShowPendingSpinner}
                            />
                        ),
                    },
                    {
                        withCustomLayout: true,
                        pressErrorTitle: "Couldn’t open tasks",
                        onPress: async () => {
                            await peekStackContext.push(`/s/${space.id}/tasks`);
                        },
                        render: ({isHovered, isPressed, shouldShowPendingSpinner}) => (
                            <SpaceLayoutSideBarCreateButtonItem
                                icon={<TasksBrandBigIcon />}
                                label="Task"
                                description="Keep track of work to do later"
                                isHovered={isHovered}
                                isPressed={isPressed}
                                shouldShowPendingSpinner={shouldShowPendingSpinner}
                            />
                        ),
                    },
                ],
                // NOCOMMIT:
                //
                // [
                //     {
                //         withCustomLayout: true,
                //         pressErrorTitle: "Couldn’t create channel",
                //         onPress: async () => {
                //             const channelId = generateId();

                //             await peekStackContext.push(
                //                 `/s/${space.id}/channels/${channelId}?create`,
                //             );
                //         },
                //         render: ({isHovered, isPressed, shouldShowPendingSpinner}) => (
                //             <SpaceLayoutSideBarCreateButtonItem
                //                 icon={<Hash />}
                //                 label="Channel"
                //                 description="Make a place for posts about some topic"
                //                 isHovered={isHovered}
                //                 isPressed={isPressed}
                //                 shouldShowPendingSpinner={shouldShowPendingSpinner}
                //             />
                //         ),
                //     },
                //     {
                //         withCustomLayout: true,
                //         pressErrorTitle: "Couldn’t create task collection",
                //         onPress: async () => {
                //             const collectionId = generateId();
                //             await peekStackContext.push(
                //                 `/s/${space.id}/tasks/collections/${collectionId}?create`,
                //                 {focus: true},
                //             );
                //         },
                //         render: ({isHovered, isPressed, shouldShowPendingSpinner}) => (
                //             <SpaceLayoutSideBarCreateButtonItem
                //                 icon={<Table />}
                //                 label="Task collection"
                //                 description="Organize a project’s tasks"
                //                 isHovered={isHovered}
                //                 isPressed={isPressed}
                //                 shouldShowPendingSpinner={shouldShowPendingSpinner}
                //             />
                //         ),
                //     },
                //     {
                //         withCustomLayout: true,
                //         pressErrorTitle: "Couldn’t create task collection",
                //         onPress: async () => {
                //             await peekStackContext.push(`/s/${space.id}/tasks/view`, {focus: true});
                //         },
                //         render: ({isHovered, isPressed, shouldShowPendingSpinner}) => (
                //             <SpaceLayoutSideBarCreateButtonItem
                //                 icon={<Funnel />}
                //                 label="Task view"
                //                 description="Filter and sort all your tasks"
                //                 isHovered={isHovered}
                //                 isPressed={isPressed}
                //                 shouldShowPendingSpinner={shouldShowPendingSpinner}
                //             />
                //         ),
                //     },
                // ],
            ]}
        >
            <IconButton size="lg" description="Create" tooltipPlacement="right">
                <Plus />
            </IconButton>
        </MenuButton>
    );
}

function SpaceLayoutSideBarCreateButtonItem({
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
            position="relative"
            paddingX="3"
            paddingY="3"
            display="flex"
            alignItems="center"
            gap="4"
            aria-label={label}
        >
            <Box flexShrink="0" color={isPressed ? "grey-90" : "grey-70"}>
                {icon}
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
