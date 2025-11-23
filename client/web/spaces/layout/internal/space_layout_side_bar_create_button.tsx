import {Modality, getInteractionModality, setInteractionModality} from "@react-aria/interactions";
import {IconContext, Plus, SpinnerGap} from "phosphor-react";
import {ReactNode, useRef} from "react";
import {Box} from "~/client/web/design/box.js";
import {IconButton} from "~/client/web/design/icon_button.js";
import {MenuButton} from "~/client/web/design/menu_button.js";
import {OverlayTriggerButtonRef} from "~/client/web/design/overlay_trigger_button.js";
import {GlobalKeyDownEvent} from "~/client/web/helpers/global_key_down_event.js";
import {ChannelBrandIcon} from "~/client/web/icons/brand/channel_brand_icon.js";
import {ChatBrandBigIcon} from "~/client/web/icons/brand/chat_brand_big_icon.js";
import {DocumentBrandBigIcon} from "~/client/web/icons/brand/document_brand_big_icon.js";
import {PostBrandBigIcon} from "~/client/web/icons/brand/post_brand_big_icon.js";
import {TaskBrandBigIcon} from "~/client/web/icons/brand/task_brand_big_icon.js";
import {TaskCollectionBrandIcon} from "~/client/web/icons/brand/task_collection_brand_icon.js";
import {TaskQueryBrandIcon} from "~/client/web/icons/brand/task_query_brand_icon.js";
import {usePeekStackContext} from "~/client/web/peek/peek_stack_context.js";
import {useClientInfo} from "~/client/web/remix/client_info_context.js";
import {useSpaceContext} from "~/client/web/spaces/space_context.js";
import {colorSchemeVars, spinAnimationClassName} from "~/client/web/styles/styles.js";
import {spacing} from "~/shared/design/core/spacing.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {generateChronologicalId} from "~/shared/id/chronological_id.js";
import {generateId} from "~/shared/id/id.js";

// NOTE(calebmer): The icons used here for create actions are the same icons
// used in `<SearchEntityView/>`'s `getSearchEntityTypeDisplay()`. If you
// change an icon here you should also change it there.
export function SpaceLayoutSideBarCreateButton() {
    const clientInfo = useClientInfo();
    const {space} = useSpaceContext();
    const peekStackContext = usePeekStackContext();

    const triggerRef = useRef<OverlayTriggerButtonRef>(null);
    const originalInteractionModalityRef = useRef<Modality | null>(null);

    return (
        <GlobalKeyDownEvent
            onGlobalKeyDown={event => {
                // NOTE(calebmer): I'd really like to use Ctrl+N as the keyboard shortcut to
                // open the create menu but unfortunately we can't override that shortcut in
                // Chrome. When we ship a desktop app we should bind Ctrl+N to the create menu.
                if (
                    event.key === "m" &&
                    (clientInfo.isAppleDevice ? event.metaKey : event.ctrlKey)
                ) {
                    event.preventDefault();
                    event.stopPropagation();

                    // Restore the interaction modality from before the create menu opened when the
                    // create menu closes.
                    originalInteractionModalityRef.current = getInteractionModality();
                    setInteractionModality("keyboard");

                    assertExists(triggerRef.current).open({
                        initiallyFocus: "FirstFocusableElement",
                    });
                }
            }}
        >
            <MenuButton
                ref={triggerRef}
                placement="right-start"
                // Centers the first item with the create button.
                offsetAlong="-5"
                onClose={() => {
                    if (originalInteractionModalityRef.current !== null) {
                        setInteractionModality(originalInteractionModalityRef.current);
                        originalInteractionModalityRef.current = null;
                    }
                }}
                actions={[
                    [
                        {
                            withCustomLayout: true,
                            pressErrorTitle: "Couldn’t create document",
                            onPress: async () => {
                                const documentId = generateId();
                                await peekStackContext.push(
                                    `/s/${space.id}/documents/${documentId}?create&focus`,
                                );
                            },
                            render: ({isPressed, shouldShowPendingSpinner}) => (
                                <SpaceLayoutSideBarCreateButtonItem
                                    icon={<DocumentBrandBigIcon />}
                                    label="Document"
                                    description="Write what’s on your mind"
                                    isPressed={isPressed}
                                    shouldShowPendingSpinner={shouldShowPendingSpinner}
                                />
                            ),
                        },
                        {
                            withCustomLayout: true,
                            pressErrorTitle: "Couldn’t open tasks",
                            onPress: async () => {
                                const taskId = generateId();
                                await peekStackContext.push(
                                    `/s/${space.id}/tasks/${taskId}?create&focus`,
                                );
                            },
                            render: ({isPressed, shouldShowPendingSpinner}) => (
                                <SpaceLayoutSideBarCreateButtonItem
                                    icon={<TaskBrandBigIcon />}
                                    label="Task"
                                    description="Keep track of work to do later"
                                    isPressed={isPressed}
                                    shouldShowPendingSpinner={shouldShowPendingSpinner}
                                />
                            ),
                        },
                        {
                            withCustomLayout: true,
                            pressErrorTitle: "Couldn’t create post",
                            onPress: async () => {
                                const draftId = generateChronologicalId();

                                await peekStackContext.push(
                                    `/s/${space.id}/posts/new/${draftId}?focus=content`,
                                );
                            },
                            render: ({isPressed, shouldShowPendingSpinner}) => (
                                <SpaceLayoutSideBarCreateButtonItem
                                    icon={<PostBrandBigIcon />}
                                    label="Post"
                                    description="Share your ideas in a channel"
                                    isPressed={isPressed}
                                    shouldShowPendingSpinner={shouldShowPendingSpinner}
                                />
                            ),
                        },
                        {
                            withCustomLayout: true,
                            pressErrorTitle: "Couldn’t open new chat",
                            onPress: async () => {
                                await peekStackContext.push(`/s/${space.id}/chat/new?focus=picker`);
                            },
                            render: ({isPressed, shouldShowPendingSpinner}) => (
                                <SpaceLayoutSideBarCreateButtonItem
                                    icon={<ChatBrandBigIcon />}
                                    label="Message"
                                    description="Start a chat with anyone"
                                    isPressed={isPressed}
                                    shouldShowPendingSpinner={shouldShowPendingSpinner}
                                />
                            ),
                        },
                    ],
                    [
                        {
                            hasChildren: true,
                            key: "more",
                            label: "More",
                            actions: [
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
                                    icon: <TaskQueryBrandIcon />,
                                    pressErrorTitle: "Couldn’t create task view",
                                    onPress: async () => {
                                        await peekStackContext.push(`/s/${space.id}/tasks/view`);
                                    },
                                },
                                {
                                    label: "Channel",
                                    icon: <ChannelBrandIcon />,
                                    pressErrorTitle: "Couldn’t create channel",
                                    onPress: async () => {
                                        await peekStackContext.push(
                                            `/s/${space.id}/channels/new?focus=name`,
                                        );
                                    },
                                },
                            ],
                        },
                    ],
                ]}
            >
                <IconButton
                    size="lg"
                    description="Create"
                    tooltipPlacement="right"
                    keyboardShortcutHint={clientInfo.isAppleDevice ? "⌘+M" : "Ctrl+M"}
                >
                    <Plus />
                </IconButton>
            </MenuButton>
        </GlobalKeyDownEvent>
    );
}

function SpaceLayoutSideBarCreateButtonItem({
    icon,
    label,
    description,
    isPressed,
    shouldShowPendingSpinner,
}: {
    icon: ReactNode;
    label: string;
    description: string;
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
