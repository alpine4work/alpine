import {IconContext, SpinnerGap} from "phosphor-react";
import {ReactNode, Ref, useCallback, useId, useImperativeHandle, useRef, useState} from "react";
import {usePress} from "react-aria";
import {useAppContext} from "~/client/web/context/app_context.js";
import {Box} from "~/client/web/design/box.js";
import {FocusRing} from "~/client/web/design/focus_ring.js";
import {renderKeyboardShortcutHint} from "~/client/web/design/render_keyboard_shortcut_hint.js";
import {useReporter} from "~/client/web/design/reporter.js";
import {Tooltip} from "~/client/web/design/tooltip.js";
import {useAlignFontBaselines} from "~/client/web/design/use_align_font_baselines.js";
import {useDelayLoadingIndicator} from "~/client/web/design/use_delay_loading_indicator.js";
import {useLayoutEffectWithoutServerSideWarning} from "~/client/web/helpers/lifecycle/use_layout_effect_without_server_side_warning.js";
import {assignRef} from "~/client/web/helpers/refs/assign_ref.js";
import {ChatBrandIcon} from "~/client/web/icons/brand/chat_brand_icon.js";
import {DocumentBrandIcon} from "~/client/web/icons/brand/document_brand_icon.js";
import {PostBrandIcon} from "~/client/web/icons/brand/post_brand_icon.js";
import {TaskBrandIcon} from "~/client/web/icons/brand/task_brand_icon.js";
import {useClientInfo} from "~/client/web/remix/client_info_context.js";
import {usePlatform} from "~/client/web/remix/platform_context.js";
import {useNavigate, useRootNavigate} from "~/client/web/remix/use_navigate.js";
import {preloadRpc} from "~/client/web/rpc/use_lazy_load_rpc.js";
import {useSpaceContext} from "~/client/web/spaces/space_context.js";
import {
    createWidgetPrimaryMenuBarItemBackgroundInsetY,
    createWidgetPrimaryMenuBarItemDesktopPaddingX,
    createWidgetPrimaryMenuBarItemHeight,
} from "~/client/web/styles/feed_shared_styles.js";
import {
    searchEntityViewMediaSize,
    searchEntityViewTitleFontSize,
} from "~/client/web/styles/search_shared_styles.js";
import {colorSchemeVars, spinAnimationClassName} from "~/client/web/styles/styles.js";
import {spacing} from "~/shared/design/core/spacing.js";
import {delayLoadingIndicatorLimitMs} from "~/shared/design/core/timing.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {generateChronologicalId} from "~/shared/id/chronological_id.js";
import {generateId} from "~/shared/id/id.js";
import {expensivelyGetAllSpaceAccounts} from "~/shared/rpc/spaces_rpc_definitions.js";

export type CreateWidgetPrimaryMenuBarRef = {
    focusFirstItem(): void;
};

export function CreateWidgetPrimaryMenuBar({
    ref,
    withOwnKeyboardShortcut,
    withRootNavigateToCreatedDocument,
    onCloseWithAnimation,
    onCloseWithoutAnimation,
    onFocusSecondaryMenuBar,
}: {
    ref?: Ref<CreateWidgetPrimaryMenuBarRef>;
    withOwnKeyboardShortcut: boolean;
    withRootNavigateToCreatedDocument: boolean;
    onCloseWithAnimation: () => void;
    onCloseWithoutAnimation: () => void;
    onFocusSecondaryMenuBar: () => void;
}) {
    const context = useAppContext();
    const rootNavigate = useRootNavigate();
    const navigate = useNavigate();
    const {space} = useSpaceContext();

    const [keyboardShortcutPressedItemIndex, setKeyboardShortcutPressedItemIndex] = useState<
        number | null
    >(null);

    if (keyboardShortcutPressedItemIndex !== null && !withOwnKeyboardShortcut)
        setKeyboardShortcutPressedItemIndex(null);

    const menuItemRefs = [
        useRef<HTMLElement & {press(): void}>(null),
        useRef<HTMLElement & {press(): void}>(null),
        useRef<HTMLElement & {press(): void}>(null),
        useRef<HTMLElement & {press(): void}>(null),
    ] as const;

    const firstMenuItemRef = menuItemRefs[0];

    useImperativeHandle(
        ref,
        () => ({
            focusFirstItem: () => {
                assertExists(firstMenuItemRef.current).focus();
            },
        }),
        [firstMenuItemRef],
    );

    function getFocusedItemIndexIfExists() {
        if (!document.activeElement) return null;

        const index = menuItemRefs.findIndex(
            menuItemRef => menuItemRef?.current === document.activeElement,
        );

        return index === -1 ? null : index;
    }

    function setAriaActiveDescendant(event: React.FocusEvent<HTMLElement>) {
        const itemIndex = getFocusedItemIndexIfExists();
        const itemId =
            itemIndex !== null
                ? (menuItemRefs[itemIndex]!.current?.getAttribute("id") ?? null)
                : null;

        if (itemId !== null) {
            event.currentTarget.setAttribute("aria-activedescendant", itemId);
        } else {
            event.currentTarget.removeAttribute("aria-activedescendant");
        }

        // If the item that's currently "pressed" via keyboard shortcut loses focus then
        // clear the pressed state.
        if (itemIndex !== keyboardShortcutPressedItemIndex) {
            setKeyboardShortcutPressedItemIndex(null);
        }
    }

    return (
        <Box
            role="menubar"
            aria-label="Quick create"
            position="relative"
            zIndex="0"
            display="flex"
            height={createWidgetPrimaryMenuBarItemHeight}
            onFocus={event => {
                setAriaActiveDescendant(event);
            }}
            onBlur={event => {
                setAriaActiveDescendant(event);
            }}
            onKeyDown={event => {
                switch (event.key) {
                    // Moves focus to the next item, optionally wrapping from the last to the first.
                    //
                    // https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Reference/Roles/menubar_role
                    case "ArrowRight": {
                        event.preventDefault();
                        event.stopPropagation();

                        const currentIndex = getFocusedItemIndexIfExists();

                        const nextIndex =
                            currentIndex !== null && currentIndex < menuItemRefs.length - 1
                                ? currentIndex + 1
                                : 0;

                        assertExists(menuItemRefs[nextIndex]!.current).focus();
                        return;
                    }

                    // Moves focus to the previous item, optionally wrapping from the first to the
                    // last.
                    //
                    // https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Reference/Roles/menubar_role
                    case "ArrowLeft": {
                        event.preventDefault();
                        event.stopPropagation();

                        const currentIndex = getFocusedItemIndexIfExists();

                        const nextIndex =
                            currentIndex !== null && currentIndex > 0
                                ? currentIndex - 1
                                : menuItemRefs.length - 1;

                        assertExists(menuItemRefs[nextIndex]!.current).focus();
                        return;
                    }

                    case "Home": {
                        event.preventDefault();
                        event.stopPropagation();

                        assertExists(menuItemRefs[0].current).focus();
                        return;
                    }

                    case "End": {
                        event.preventDefault();
                        event.stopPropagation();

                        assertExists(menuItemRefs[menuItemRefs.length - 1]!.current).focus();
                        return;
                    }

                    // While we don't do anything on `ArrowUp` prevent default so we don't do the
                    // default browser scroll.
                    case "ArrowUp": {
                        event.preventDefault();
                        event.stopPropagation();
                        return;
                    }

                    case "ArrowDown": {
                        event.preventDefault();
                        event.stopPropagation();

                        onFocusSecondaryMenuBar();
                        return;
                    }

                    case "d":
                    case "D": {
                        if (!withOwnKeyboardShortcut) return;

                        event.preventDefault();
                        event.stopPropagation();

                        assertExists(menuItemRefs[0].current).focus();
                        setKeyboardShortcutPressedItemIndex(0);
                        assertExists(menuItemRefs[0].current).press();
                        return;
                    }

                    case "t":
                    case "T": {
                        if (!withOwnKeyboardShortcut) return;

                        event.preventDefault();
                        event.stopPropagation();

                        assertExists(menuItemRefs[1].current).focus();
                        setKeyboardShortcutPressedItemIndex(1);
                        assertExists(menuItemRefs[1].current).press();
                        return;
                    }

                    case "p":
                    case "P": {
                        if (!withOwnKeyboardShortcut) return;

                        event.preventDefault();
                        event.stopPropagation();

                        assertExists(menuItemRefs[2].current).focus();
                        setKeyboardShortcutPressedItemIndex(2);
                        assertExists(menuItemRefs[2].current).press();
                        return;
                    }

                    case "c":
                    case "C": {
                        if (!withOwnKeyboardShortcut) return;

                        event.preventDefault();
                        event.stopPropagation();

                        assertExists(menuItemRefs[3].current).focus();
                        setKeyboardShortcutPressedItemIndex(3);
                        assertExists(menuItemRefs[3].current).press();
                        return;
                    }
                }
            }}
            onKeyUp={event => {
                switch (event.key) {
                    case "d":
                    case "D": {
                        if (!withOwnKeyboardShortcut) return;

                        if (keyboardShortcutPressedItemIndex !== 0) return;
                        setKeyboardShortcutPressedItemIndex(null);
                        return;
                    }

                    case "t":
                    case "T": {
                        if (!withOwnKeyboardShortcut) return;

                        if (keyboardShortcutPressedItemIndex !== 1) return;
                        setKeyboardShortcutPressedItemIndex(null);
                        return;
                    }

                    case "p":
                    case "P": {
                        if (!withOwnKeyboardShortcut) return;

                        if (keyboardShortcutPressedItemIndex !== 2) return;
                        setKeyboardShortcutPressedItemIndex(null);
                        return;
                    }

                    case "c":
                    case "C": {
                        if (!withOwnKeyboardShortcut) return;

                        if (keyboardShortcutPressedItemIndex !== 3) return;
                        setKeyboardShortcutPressedItemIndex(null);
                        return;
                    }
                }
            }}
        >
            <CreateWidgetPrimaryMenuBarItem
                ref={menuItemRefs[0]}
                name="Doc"
                icon={<DocumentBrandIcon />}
                keyboardShortcut="d"
                withOwnKeyboardShortcut={withOwnKeyboardShortcut}
                isPressedFromKeyboardShortcut={keyboardShortcutPressedItemIndex === 0}
                isFirstItem={true}
                onCloseWithAnimation={onCloseWithAnimation}
                onCloseWithoutAnimation={onCloseWithoutAnimation}
                pressErrorTitle="Couldn&#x2019;t create document"
                onPress={async () => {
                    const documentId = generateId();

                    if (withRootNavigateToCreatedDocument) {
                        await rootNavigate(`/s/${space.id}/documents/${documentId}?create&focus`);
                    } else {
                        await navigate(`/s/${space.id}/documents/${documentId}?create&focus`);
                    }
                }}
            />
            <CreateWidgetPrimaryMenuBarItem
                ref={menuItemRefs[1]}
                name="Task"
                icon={<TaskBrandIcon />}
                keyboardShortcut="t"
                withOwnKeyboardShortcut={withOwnKeyboardShortcut}
                isPressedFromKeyboardShortcut={keyboardShortcutPressedItemIndex === 1}
                onCloseWithAnimation={onCloseWithAnimation}
                onCloseWithoutAnimation={onCloseWithoutAnimation}
                pressErrorTitle="Couldn&#x2019;t create task"
                onPress={async () => {
                    const taskId = generateId();
                    await navigate(`/s/${space.id}/tasks/${taskId}?create&focus`);
                }}
            />
            <CreateWidgetPrimaryMenuBarItem
                ref={menuItemRefs[2]}
                name="Post"
                icon={<PostBrandIcon />}
                keyboardShortcut="p"
                withOwnKeyboardShortcut={withOwnKeyboardShortcut}
                isPressedFromKeyboardShortcut={keyboardShortcutPressedItemIndex === 2}
                onCloseWithAnimation={onCloseWithAnimation}
                onCloseWithoutAnimation={onCloseWithoutAnimation}
                pressErrorTitle="Couldn&#x2019;t create post"
                onPress={async () => {
                    const draftId = generateChronologicalId();
                    await navigate(`/s/${space.id}/posts/new/${draftId}?focus=content`);
                }}
            />
            <CreateWidgetPrimaryMenuBarItem
                ref={menuItemRefs[3]}
                name="Chat"
                icon={<ChatBrandIcon />}
                keyboardShortcut="c"
                withOwnKeyboardShortcut={withOwnKeyboardShortcut}
                isPressedFromKeyboardShortcut={keyboardShortcutPressedItemIndex === 3}
                onCloseWithAnimation={onCloseWithAnimation}
                onCloseWithoutAnimation={onCloseWithoutAnimation}
                isLastItem={true}
                pressErrorTitle="Couldn&#x2019;t create chat"
                onPress={async () => {
                    // Start preloading all space accounts to avoid showing a loading spinner in case
                    // all space accounts haven't already been loaded. This is a noop if we've loaded
                    // all space accounts before.
                    preloadRpc(context, expensivelyGetAllSpaceAccounts, {spaceId: space.id});

                    await navigate(`/s/${space.id}/chat/new?focus=picker`);
                }}
            />
        </Box>
    );
}

function CreateWidgetPrimaryMenuBarItem({
    ref,
    name,
    icon,
    keyboardShortcut,
    withOwnKeyboardShortcut,
    isPressedFromKeyboardShortcut,
    isFirstItem,
    isLastItem,
    onCloseWithAnimation,
    onCloseWithoutAnimation,
    pressErrorTitle,
    onPress,
}: {
    ref: Ref<HTMLElement & {press(): void}>;
    name: string;
    icon: ReactNode;
    keyboardShortcut: string;
    withOwnKeyboardShortcut: boolean;
    isPressedFromKeyboardShortcut: boolean;
    isFirstItem?: boolean;
    isLastItem?: boolean;
    onCloseWithAnimation: () => void;
    onCloseWithoutAnimation: () => void;
    pressErrorTitle: string;
    onPress: () => Promise<void>;
}) {
    const platform = usePlatform();
    const reporter = useReporter();
    const clientInfo = useClientInfo();
    const id = useId();

    const [isPending, setIsPending] = useState(false);
    const shouldShowLoadingIndicator = useDelayLoadingIndicator(isPending);

    const handlePress = () => {
        if (isPending) return;

        const promiseStartTime = new Date();
        setIsPending(true);

        onPress().then(
            () => {
                setIsPending(false);

                // Our animation principle is to respond to user input immediately without
                // animation.
                //
                // If the item had to go into a loading state we consider the click long enough ago
                // that it is no longer a direct action.
                if (
                    new Date().getTime() - promiseStartTime.getTime() >
                    delayLoadingIndicatorLimitMs
                ) {
                    onCloseWithAnimation();
                } else {
                    onCloseWithoutAnimation();
                }
            },
            error => {
                setIsPending(false);
                reporter.displayError(pressErrorTitle, error);
            },
        );
    };

    const handlePressRef = useRef(handlePress);
    useLayoutEffectWithoutServerSideWarning(() => {
        handlePressRef.current = handlePress;
    });

    const {isPressed: isPressedFromState, pressProps} = usePress({onPress: handlePress});

    const isPressed = isPressedFromState || isPressedFromKeyboardShortcut;

    const keyboardShortcutFontSize = withOwnKeyboardShortcut ? "75" : "50";

    // We want to baseline align our `fontSize="75"` keyboard shortcut with our
    // centered `fontSize="100"` item name. Calculate the offset for center aligned
    // `fontSize="75"` using font metrics.
    const keyboardShortcutBaselineAlignmentMarginTop = useAlignFontBaselines(
        keyboardShortcutFontSize,
        "100",
    );

    return (
        <FocusRing
            // The focus ring should render around the same space as the `isPressed`
            // background.
            offset="inset"
            inset={createWidgetPrimaryMenuBarItemBackgroundInsetY}
            targetBorderRadius="1"
        >
            <Box
                ref={useCallback(
                    (element: HTMLButtonElement) => {
                        if (element === null) {
                            assignRef(ref, null);
                        } else {
                            const actualElement = Object.assign(element, {
                                press: () => {
                                    handlePressRef.current();
                                },
                            });

                            assignRef(ref, actualElement);
                        }
                    },
                    [ref],
                )}
                id={id}
                role="menuitem"
                tabIndex={isFirstItem ? 0 : -1}
                {...pressProps}
                position="relative"
                zIndex="0"
                flexGrow="1"
                width="full"
                minWidth="flex-fit"
                height={createWidgetPrimaryMenuBarItemHeight}
                paddingX={
                    platform === "desktop"
                        ? createWidgetPrimaryMenuBarItemDesktopPaddingX
                        : undefined
                }
                display="flex"
                alignItems="center"
                justifyContent={platform === "desktop" ? "space-between" : "center"}
                gap="2"
            >
                {isPressed && (
                    <Box
                        position="absolute"
                        zIndex="-10"
                        top={createWidgetPrimaryMenuBarItemBackgroundInsetY}
                        bottom={createWidgetPrimaryMenuBarItemBackgroundInsetY}
                        left={
                            platform === "desktop"
                                ? createWidgetPrimaryMenuBarItemBackgroundInsetY
                                : "1"
                        }
                        right={
                            platform === "desktop"
                                ? createWidgetPrimaryMenuBarItemBackgroundInsetY
                                : "1"
                        }
                        borderRadius="1"
                        backgroundColor="grey-5"
                    />
                )}
                <Box flexShrink="0" display="flex" alignItems="center" gap="1.5">
                    <IconContext.Provider value={{size: spacing[searchEntityViewMediaSize]}}>
                        {icon}
                    </IconContext.Provider>
                    <Box position="relative" fontSize={searchEntityViewTitleFontSize}>
                        {name}
                    </Box>
                </Box>
                {shouldShowLoadingIndicator ? (
                    <SpinnerGap
                        className={spinAnimationClassName}
                        size={spacing["4"]}
                        color={colorSchemeVars["grey-60"]}
                    />
                ) : platform === "desktop" ? (
                    <Box
                        minWidth="flex-fit"
                        style={{marginTop: keyboardShortcutBaselineAlignmentMarginTop}}
                    >
                        <Tooltip
                            content={
                                withOwnKeyboardShortcut
                                    ? "Keyboard shortcut"
                                    : `To create press ${renderKeyboardShortcutHint(
                                          clientInfo,
                                          "mod",
                                          "m",
                                      )} then ${keyboardShortcut}`
                            }
                            placement="bottom"
                        >
                            <Box
                                position="relative"
                                zIndex="0"
                                color="grey-50"
                                textAlign="center"
                                fontSize={keyboardShortcutFontSize}
                                fontStyle="truncate"
                            >
                                <Box
                                    // Pointer slop area so the tooltip is generous as to when it activates. You don't
                                    // have to exactly hover over the keyboard shortcut text.
                                    position="absolute"
                                    zIndex="-10"
                                    width="full"
                                    minWidth="6"
                                    height="6"
                                    style={{
                                        top: "50%",
                                        left: "50%",
                                        transform: "translate(-50%, -50%)",
                                    }}
                                />
                                {withOwnKeyboardShortcut
                                    ? keyboardShortcut
                                    : `${renderKeyboardShortcutHint(
                                          clientInfo,
                                          "mod",
                                          "m",
                                      )}, ${keyboardShortcut}`}
                            </Box>
                        </Tooltip>
                    </Box>
                ) : null}
                {!isLastItem && (
                    <Box
                        position="absolute"
                        zIndex="10"
                        top="3"
                        bottom="3"
                        width="border"
                        backgroundColor="grey-5"
                        pointerEvents="none"
                        style={{
                            // Rounds up to 0.5px on high-DPI screens and rounds down to 0px on low-DPI
                            // screens.
                            right: -0.45,
                        }}
                    />
                )}
            </Box>
        </FocusRing>
    );
}
