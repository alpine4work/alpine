import {IconContext, Plus, SpinnerGap} from "phosphor-react";
import {ReactNode} from "react";
import {Box} from "~/client/design/box.js";
import {IconButton} from "~/client/design/icon_button.js";
import {MenuButton} from "~/client/design/menu_button.js";
import {ChannelBrandIcon} from "~/client/icons/brand/channel_brand_icon.js";
import {ChatBrandBigIcon} from "~/client/icons/brand/chat_brand_big_icon.js";
import {DocumentBrandBigIcon} from "~/client/icons/brand/document_brand_big_icon.js";
import {PostBrandBigIcon} from "~/client/icons/brand/post_brand_big_icon.js";
import {TaskBrandBigIcon} from "~/client/icons/brand/task_brand_big_icon.js";
import {TaskCollectionBrandIcon} from "~/client/icons/brand/task_collection_brand_icon.js";
import {TaskViewBrandIcon} from "~/client/icons/brand/task_view_brand_icon.js";
import {usePeekStackContext} from "~/client/peek/peek_stack.js";
import {useSpaceContext} from "~/client/spaces/space_context.js";
import {spacing} from "~/shared/design/spacing.js";
import {generateId} from "~/shared/id/id.js";
import {colorSchemeVars, spinAnimationClassName} from "~/shared/styles/styles.js";

// NOTE(calebmer): The icons used here for create actions are the same icons
// used in `<SearchResultView/>`'s `getSearchResultTypeDisplay()`. If you
// change an icon here you should also change it there.
export function SpaceLayoutSideBarCreateButton() {
    const {space} = useSpaceContext();
    const peekStackContext = usePeekStackContext();

    return (
        <MenuButton
            placement="left-start"
            size="brand-icons"
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
                                icon={<DocumentBrandBigIcon />}
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
                                icon={<TaskBrandBigIcon />}
                                label="Task"
                                description="Keep track of work to do later"
                                isHovered={isHovered}
                                isPressed={isPressed}
                                shouldShowPendingSpinner={shouldShowPendingSpinner}
                            />
                        ),
                    },
                ],
                [
                    {
                        hasChildren: true,
                        label: "More",
                        actions: [
                            {
                                label: "Channel",
                                icon: <ChannelBrandIcon />,
                                pressErrorTitle: "Couldn’t create channel",
                                onPress: async () => {
                                    const channelId = generateId();

                                    await peekStackContext.push(
                                        `/s/${space.id}/channels/${channelId}?create`,
                                    );
                                },
                            },
                            {
                                label: "Task collection",
                                icon: <TaskCollectionBrandIcon />,
                                pressErrorTitle: "Couldn’t create task collection",
                                onPress: async () => {
                                    const collectionId = generateId();

                                    await peekStackContext.push(
                                        `/s/${space.id}/tasks/collections/${collectionId}?create`,
                                    );
                                },
                            },
                            {
                                label: "Task view",
                                icon: <TaskViewBrandIcon />,
                                pressErrorTitle: "Couldn’t create task view",
                                onPress: async () => {
                                    await peekStackContext.push(`/s/${space.id}/tasks/view`);
                                },
                            },
                        ],
                    },
                ],
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
            padding="2.5"
            display="flex"
            alignItems="center"
            gap="3"
            aria-label={label}
        >
            <Box flexShrink="0">
                <IconContext.Provider
                    value={{
                        color: isPressed ? colorSchemeVars["grey-90"] : colorSchemeVars["grey-80"],
                    }}
                >
                    {icon}
                </IconContext.Provider>
            </Box>
            <Box flexGrow="1">
                <Box fontStyle="semi-bold" fontSize="100">
                    {label}
                </Box>
                <Box fontSize="75" color="grey-60">
                    {description}
                </Box>
            </Box>
            <Box flexShrink="0" width="4" color="grey-70">
                {shouldShowPendingSpinner && (
                    <SpinnerGap className={spinAnimationClassName} size={spacing["4"]} />
                )}
            </Box>
        </Box>
    );
}
