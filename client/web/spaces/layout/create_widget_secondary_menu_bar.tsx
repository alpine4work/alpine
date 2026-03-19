import {CaretDown, IconContext, SpinnerGap} from "phosphor-react";
import {
    ReactNode,
    Ref,
    RefObject,
    useCallback,
    useId,
    useImperativeHandle,
    useRef,
    useState,
} from "react";
import {usePress} from "react-aria";
import {useAppContext} from "~/client/web/context/app_context.js";
import {Box} from "~/client/web/design/box.js";
import {Button} from "~/client/web/design/button.js";
import {FocusRing} from "~/client/web/design/focus_ring.js";
import {MenuButton} from "~/client/web/design/menu_button.js";
import {useReporter} from "~/client/web/design/reporter.js";
import {Spacer} from "~/client/web/design/spacer.js";
import {useDelayLoadingIndicator} from "~/client/web/design/use_delay_loading_indicator.js";
import {useLayoutEffectWithoutServerSideWarning} from "~/client/web/helpers/lifecycle/use_layout_effect_without_server_side_warning.js";
import {assignRef} from "~/client/web/helpers/refs/assign_ref.js";
import {useLocalStorage} from "~/client/web/helpers/use_local_storage.js";
import {useResizeObserver} from "~/client/web/helpers/use_resize_observer.js";
import {ChannelBrandIcon} from "~/client/web/icons/brand/channel_brand_icon.js";
import {ChatBrandIcon} from "~/client/web/icons/brand/chat_brand_icon.js";
import {DocumentBrandIcon} from "~/client/web/icons/brand/document_brand_icon.js";
import {PostBrandIcon} from "~/client/web/icons/brand/post_brand_icon.js";
import {TaskBrandIcon} from "~/client/web/icons/brand/task_brand_icon.js";
import {TaskCollectionBrandIcon} from "~/client/web/icons/brand/task_collection_brand_icon.js";
import {TaskQueryBrandIcon} from "~/client/web/icons/brand/task_query_brand_icon.js";
import {useClientInfo} from "~/client/web/remix/client_info_context.js";
import {usePlatform} from "~/client/web/remix/platform_context.js";
import {
    getSpacingScaleWithoutListening,
    useSpacingScale,
} from "~/client/web/remix/spacing_scale_context.js";
import {useNavigate, useRootNavigate} from "~/client/web/remix/use_navigate.js";
import {preloadRpc} from "~/client/web/rpc/use_lazy_load_rpc.js";
import {
    CreateWidgetExampleContentRoleSchema,
    allCreateWidgetExampleContentRoles,
    createWidgetExampleContentByRole,
    nameByCreateWidgetExampleContentRole,
    startOfSentenceNameByCreateWidgetExampleContentRole,
} from "~/client/web/spaces/layout/internal/create_widget_example_content.js";
import {
    CreateWidgetChannelExample,
    CreateWidgetChatMessageExample,
    CreateWidgetDocumentExample,
    CreateWidgetPostExample,
    CreateWidgetProjectTaskExample,
    CreateWidgetRoomChatExample,
    CreateWidgetTaskCollectionExample,
    CreateWidgetTaskExample,
    CreateWidgetTaskQueryExample,
    createWidgetExampleHeight,
} from "~/client/web/spaces/layout/internal/create_widget_examples.js";
import {useSpaceContextAndRequireSpaceAccess} from "~/client/web/spaces/space_context.js";
import {
    accentThemeBackgroundColor,
    accentThemeForegroundColor,
    colorSchemeVars,
    spinAnimationClassName,
} from "~/client/web/styles/styles.js";
import {mobilePlatformMaxWindowWidth} from "~/shared/design/core/platform.js";
import {
    Spacing,
    convertRemLengthToPx,
    parseRemLength,
    screenPaddingX,
    spacing,
} from "~/shared/design/core/spacing.js";
import {delayLoadingIndicatorLimitMs} from "~/shared/design/core/timing.js";
import {interleaveArray} from "~/shared/helpers/array/interleave_array.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {isRangeContained} from "~/shared/helpers/geometry/is_range_contained.js";
import {generateChronologicalId} from "~/shared/id/chronological_id.js";
import {generateId} from "~/shared/id/id.js";
import {expensivelyGetAllSpaceAccounts} from "~/shared/rpc/spaces_rpc_definitions.js";
import {serializeTaskQueryFiltersSearchParam} from "~/shared/tasks/task_query_filter.js";

export type CreateWidgetSecondaryMenuBarRef = {
    focusFirstItem(): void;
};

export function CreateWidgetSecondaryMenuBar({
    ref,
    scrollRef,
    maxWidth,
    headingType,
    withRootNavigateToCreatedDocument,
    withDocumentAndProjectTaskStartHereBadges,
    withCreateVerbBeforeItemName,
    onCloseWithAnimation,
    onCloseWithoutAnimation,
    onFocusPrimaryMenuBar,
}: {
    ref?: Ref<CreateWidgetSecondaryMenuBarRef>;
    scrollRef?: RefObject<HTMLDivElement | null>;
    maxWidth?: Spacing;
    headingType: "Null" | "Explore";
    withRootNavigateToCreatedDocument: boolean;
    withDocumentAndProjectTaskStartHereBadges: boolean;
    withCreateVerbBeforeItemName: boolean;
    onCloseWithAnimation: () => void;
    onCloseWithoutAnimation: () => void;
    onFocusPrimaryMenuBar: () => void;
}) {
    const context = useAppContext();
    const platform = usePlatform();
    const spacingScale = useSpacingScale();
    const clientInfo = useClientInfo();
    const rootNavigate = useRootNavigate();
    const navigate = useNavigate();
    const {space, currentAccount} = useSpaceContextAndRequireSpaceAccess();

    const menuItemRefs = [
        useRef<HTMLElement & {press(): void}>(null),
        useRef<HTMLElement & {press(): void}>(null),
        useRef<HTMLElement & {press(): void}>(null),
        useRef<HTMLElement & {press(): void}>(null),
        useRef<HTMLElement & {press(): void}>(null),
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

    // We can avoid enabling the resize observer on desktop since we should never be
    // using a mobile layout on desktop.
    const isResizeObserverEnabled =
        !!maxWidth ||
        platform === "mobile" ||
        clientInfo.screenWidth <= mobilePlatformMaxWindowWidth;

    const [resizeObserverRef, resizeObserverRect] = useResizeObserver({
        isDisabled: !isResizeObserverEnabled,
        withSuppressResizeLoopErrorNotification: true,
    });

    const baseExampleWidth = "48";
    const baseExampleWidthPx = convertRemLengthToPx(baseExampleWidth, spacingScale);

    const exampleMobileWidthPx =
        (resizeObserverRect?.width ??
            Math.min(
                clientInfo.screenWidth,
                maxWidth ? convertRemLengthToPx(maxWidth, spacingScale) : Infinity,
            )) -
        convertRemLengthToPx(screenPaddingX[platform], spacingScale) * 2;

    const exampleMobileScale = exampleMobileWidthPx / baseExampleWidthPx;

    const isMobileLayout = exampleMobileWidthPx <= convertRemLengthToPx("28rem", spacingScale);

    const [exampleContentRole, setExampleContentRole] = useLocalStorage(
        "cyberworlds/createWidgetSecondaryMenuBarExampleContentRole",
        CreateWidgetExampleContentRoleSchema,
        "Founder",
    );

    const exampleContent = createWidgetExampleContentByRole[exampleContentRole];

    const items: Array<{
        ref: RefObject<(HTMLElement & {press(): void}) | null>;
        name: string;
        icon: ReactNode;
        description: string;
        example: ReactNode;
        createVerb: string;
        withStartHereBadge?: boolean;
        pressErrorTitle: string;
        onPress: () => Promise<void>;
    }> = [
        {
            ref: menuItemRefs[0],
            name: "document",
            icon: <DocumentBrandIcon />,
            description:
                "Write and share anything. Try presenting your doc as a slideshow or duplicate it to create a template.",
            example: <CreateWidgetDocumentExample content={exampleContent} />,
            createVerb: "Create",
            withStartHereBadge: withDocumentAndProjectTaskStartHereBadges,
            pressErrorTitle: "Couldn\u2019t create document",
            onPress: async () => {
                const documentId = generateId();

                if (withRootNavigateToCreatedDocument) {
                    await rootNavigate(`/s/${space.id}/documents/${documentId}?create&focus`);
                } else {
                    await navigate(`/s/${space.id}/documents/${documentId}?create&focus`);
                }
            },
        },
        {
            ref: menuItemRefs[1],
            name: "task",
            icon: <TaskBrandIcon />,
            description:
                "Track something that needs to get done. Add an assignee or due date to keep things moving.",
            example: <CreateWidgetTaskExample content={exampleContent} />,
            createVerb: "Create",
            pressErrorTitle: "Couldn\u2019t create task",
            onPress: async () => {
                const taskId = generateId();
                await navigate(`/s/${space.id}/tasks/${taskId}?create&focus`);
            },
        },
        {
            ref: menuItemRefs[2],
            name: "project",
            icon: <TaskBrandIcon />,
            description:
                "Track bigger efforts by breaking them up into smaller tasks. Projects are a special kind of task.",
            withStartHereBadge: withDocumentAndProjectTaskStartHereBadges,
            example: <CreateWidgetProjectTaskExample content={exampleContent} />,
            createVerb: "Create",
            pressErrorTitle: "Couldn\u2019t create project",
            onPress: async () => {
                const taskId = generateId();

                const createSearchParam = serializeTaskQueryFiltersSearchParam([
                    {
                        type: "Layout",
                        operation: {
                            type: "OneOf",
                            layouts: ["Project"],
                        },
                    },
                    {
                        type: "Assignee",
                        operation: {
                            type: "OneOf",
                            accounts: [{type: "Account", accountId: currentAccount.id}],
                        },
                    },
                ]);

                await rootNavigate(
                    `/s/${space.id}/tasks/${taskId}?create=${createSearchParam}&focus`,
                );
            },
        },
        {
            ref: menuItemRefs[3],
            name: "task collection",
            icon: <TaskCollectionBrandIcon />,
            description:
                "Group related tasks together in a collection. A task may be added to multiple collections.",
            example: <CreateWidgetTaskCollectionExample content={exampleContent} />,
            createVerb: "Create",
            pressErrorTitle: "Couldn\u2019t create task collection",
            onPress: async () => {
                const collectionId = generateId();
                await navigate(`/s/${space.id}/tasks/collections/${collectionId}?create`);
            },
        },
        {
            ref: menuItemRefs[4],
            name: "task view",
            icon: <TaskQueryBrandIcon />,
            description:
                "Filter and sort tasks however you\u2019d like. Create custom views that fit the way you like to work.",
            example: <CreateWidgetTaskQueryExample content={exampleContent} />,
            createVerb: "Create",
            pressErrorTitle: "Couldn\u2019t create task view",
            onPress: async () => {
                await navigate(`/s/${space.id}/tasks/view`);
            },
        },
        {
            ref: menuItemRefs[5],
            name: "post",
            icon: <PostBrandIcon />,
            description:
                "Start a conversation. Good for decisions, announcements, and anything that doesn\u2019t need an instant reply.",
            example: <CreateWidgetPostExample content={exampleContent} />,
            createVerb: "Create",
            pressErrorTitle: "Couldn\u2019t create post",
            onPress: async () => {
                const draftId = generateChronologicalId();
                await navigate(`/s/${space.id}/posts/new/${draftId}?focus=content`);
            },
        },
        {
            ref: menuItemRefs[6],
            name: "channel",
            icon: <ChannelBrandIcon />,
            description:
                "Organize posts around a topic so the right people can follow along. Posts go into channels and \u201Cfor you\u201D feeds.",
            example: <CreateWidgetChannelExample content={exampleContent} />,
            createVerb: "Create",
            pressErrorTitle: "Couldn\u2019t create channel",
            onPress: async () => {
                await navigate(`/s/${space.id}/channels/new?focus=name`);
            },
        },
        {
            ref: menuItemRefs[7],
            name: "chat message",
            icon: <ChatBrandIcon />,
            description:
                "Send a private message. Best for quick questions and back-and-forths that need a fast reply.",
            example: <CreateWidgetChatMessageExample content={exampleContent} />,
            createVerb: "Send",
            pressErrorTitle: "Couldn\u2019t create chat message",
            onPress: async () => {
                // Start preloading all space accounts to avoid showing a loading spinner in case
                // all space accounts haven't already been loaded. This is a noop if we've loaded
                // all space accounts before.
                preloadRpc(context, expensivelyGetAllSpaceAccounts, {spaceId: space.id});

                await navigate(`/s/${space.id}/chat/new?focus=picker`);
            },
        },
        {
            ref: menuItemRefs[8],
            name: "chat room",
            icon: <ChatBrandIcon />,
            description:
                "A named group chat you can add or remove people from at any time. A good place for real-time chatter.",
            example: <CreateWidgetRoomChatExample content={exampleContent} />,
            createVerb: "Create",
            pressErrorTitle: "Couldn\u2019t create chat room",
            onPress: async () => {
                await navigate(`/s/${space.id}/chat/room/new?focus=name`);
            },
        },
    ];

    assert(menuItemRefs.length === items.length);

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
    }

    return (
        <Box
            ref={resizeObserverRef}
            maxWidth={maxWidth}
            paddingX={screenPaddingX}
            paddingBottom="2"
            paddingTop={isMobileLayout ? "2" : undefined}
        >
            <Box display="flex" justifyContent="space-between" alignItems="center">
                <Box>
                    {headingType === "Explore" && (
                        <>
                            <Box as="span" fontSize="100" fontStyle="semi-bold">
                                Explore
                            </Box>
                            <Box as="span" color="grey-60">
                                {" "}
                                ({items.length})
                            </Box>
                        </>
                    )}
                </Box>
                <Box width={!isMobileLayout ? "48" : undefined} display="flex" alignItems="center">
                    <Box marginX="-2">
                        <MenuButton
                            actions={allCreateWidgetExampleContentRoles.map(role => ({
                                label: startOfSentenceNameByCreateWidgetExampleContentRole[role],
                                isSelected: exampleContentRole === role,
                                onPress: () => setExampleContentRole(role),
                            }))}
                        >
                            <Button
                                variant="quietest"
                                height="6"
                                paddingX="2"
                                icon={<CaretDown />}
                                iconPlacement={!isMobileLayout ? "end" : "start"}
                            >
                                Example ({nameByCreateWidgetExampleContentRole[exampleContentRole]})
                            </Button>
                        </MenuButton>
                    </Box>
                </Box>
            </Box>
            <CreateWidgetSecondaryItemDivider />
            <Box
                role="menubar"
                aria-label="Create"
                aria-orientation="vertical"
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
                        case "ArrowDown": {
                            event.preventDefault();
                            event.stopPropagation();

                            const currentIndex = getFocusedItemIndexIfExists();

                            const nextIndex =
                                currentIndex !== null && currentIndex < menuItemRefs.length - 1
                                    ? currentIndex + 1
                                    : null;

                            if (nextIndex === null) return;

                            const menuItemElement = assertExists(menuItemRefs[nextIndex]!.current);

                            // When using arrow key navigation, scroll the menu in a nice predictable way. The
                            // default browser scroll is a little strange.
                            if (scrollRef) {
                                const scrollElement = assertExists(scrollRef.current);

                                const menuItemRect = menuItemElement.getBoundingClientRect();
                                const scrollRect = scrollElement.getBoundingClientRect();

                                if (
                                    !isRangeContained(
                                        scrollRect.top,
                                        scrollRect.bottom,
                                        menuItemRect.top,
                                        menuItemRect.bottom,
                                    )
                                ) {
                                    if (nextIndex === menuItemRefs.length - 1) {
                                        scrollElement.scrollTop =
                                            scrollElement.scrollHeight - scrollElement.clientHeight;
                                    } else {
                                        scrollElement.scrollTop +=
                                            menuItemRect.bottom +
                                            convertRemLengthToPx(
                                                "2",
                                                getSpacingScaleWithoutListening(),
                                            ) -
                                            scrollRect.bottom;
                                    }
                                }
                            }

                            menuItemElement.focus();
                            return;
                        }

                        // Moves focus to the previous item, optionally wrapping from the first to the
                        // last.
                        //
                        // https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Reference/Roles/menubar_role
                        case "ArrowUp": {
                            event.preventDefault();
                            event.stopPropagation();

                            const currentIndex = getFocusedItemIndexIfExists();

                            const nextIndex =
                                currentIndex !== null && currentIndex > 0 ? currentIndex - 1 : null;

                            if (nextIndex === null) {
                                onFocusPrimaryMenuBar();
                                return;
                            }

                            const menuItemElement = assertExists(menuItemRefs[nextIndex]!.current);

                            // When using arrow key navigation, scroll the menu in a nice predictable way. The
                            // default browser scroll is a little strange.
                            if (scrollRef) {
                                const scrollElement = assertExists(scrollRef.current);

                                const menuItemRect = menuItemElement.getBoundingClientRect();
                                const scrollRect = scrollElement.getBoundingClientRect();

                                if (
                                    !isRangeContained(
                                        scrollRect.top,
                                        scrollRect.bottom,
                                        menuItemRect.top,
                                        menuItemRect.bottom,
                                    )
                                ) {
                                    if (nextIndex === 0) {
                                        scrollElement.scrollTop = 0;
                                    } else {
                                        scrollElement.scrollTop +=
                                            menuItemRect.top -
                                            convertRemLengthToPx(
                                                "2",
                                                getSpacingScaleWithoutListening(),
                                            ) -
                                            scrollRect.top;
                                    }
                                }
                            }

                            menuItemElement.focus();
                            return;
                        }

                        case "Home": {
                            event.preventDefault();
                            event.stopPropagation();

                            // When using arrow key navigation, scroll the menu in a nice predictable way. The
                            // default browser scroll is a little strange.
                            if (scrollRef) {
                                const scrollElement = assertExists(scrollRef.current);
                                scrollElement.scrollTop = 0;
                            }

                            assertExists(menuItemRefs[0].current).focus();
                            return;
                        }

                        case "End": {
                            event.preventDefault();
                            event.stopPropagation();

                            // When using arrow key navigation, scroll the menu in a nice predictable way. The
                            // default browser scroll is a little strange.
                            if (scrollRef) {
                                const scrollElement = assertExists(scrollRef.current);
                                scrollElement.scrollTop =
                                    scrollElement.scrollHeight - scrollElement.clientHeight;
                            }

                            assertExists(menuItemRefs[menuItemRefs.length - 1]!.current).focus();
                            return;
                        }
                    }
                }}
            >
                {interleaveArray(
                    items.map((item, index) => (
                        <CreateWidgetSecondaryItem
                            ref={item.ref}
                            key={item.name}
                            name={item.name}
                            icon={item.icon}
                            description={item.description}
                            example={item.example}
                            createVerb={item.createVerb}
                            pressErrorTitle={item.pressErrorTitle}
                            onPress={item.onPress}
                            withStartHereBadge={item.withStartHereBadge}
                            withCreateVerbBeforeItemName={withCreateVerbBeforeItemName}
                            isMobileLayout={isMobileLayout}
                            baseExampleWidth={baseExampleWidth}
                            exampleMobileScale={exampleMobileScale}
                            onCloseWithAnimation={onCloseWithAnimation}
                            onCloseWithoutAnimation={onCloseWithoutAnimation}
                            isFirstItem={index === 0}
                        />
                    )),
                    index => (
                        <CreateWidgetSecondaryItemDivider key={index} />
                    ),
                )}
            </Box>
        </Box>
    );
}

function CreateWidgetSecondaryItemDivider() {
    return (
        <Box position="relative" height="4" pointerEvents="none">
            <Box
                position="absolute"
                top="2"
                left="0"
                right="0"
                height="border"
                backgroundColor="grey-5"
            />
        </Box>
    );
}

function CreateWidgetSecondaryItem({
    ref,
    name,
    startOfSentenceName = name[0]!.toUpperCase() + name.slice(1),
    icon,
    description,
    example,
    createVerb,
    withCreateVerbBeforeItemName,
    withStartHereBadge,
    isFirstItem,
    isMobileLayout,
    baseExampleWidth,
    exampleMobileScale,
    onCloseWithAnimation,
    onCloseWithoutAnimation,
    pressErrorTitle,
    onPress,
}: {
    ref: Ref<HTMLElement & {press(): void}>;
    name: string;
    startOfSentenceName?: string;
    icon: ReactNode;
    description: string;
    example: ReactNode;
    createVerb: string;
    withCreateVerbBeforeItemName: boolean;
    withStartHereBadge?: boolean;
    isFirstItem?: boolean;
    isMobileLayout: boolean;
    baseExampleWidth: Spacing;
    exampleMobileScale: number;
    onCloseWithAnimation: () => void;
    onCloseWithoutAnimation: () => void;
    pressErrorTitle: string;
    onPress: () => Promise<void>;
}) {
    const platform = usePlatform();
    const reporter = useReporter();
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

    const {isPressed, pressProps} = usePress({onPress: handlePress});

    return (
        <FocusRing offset="inset">
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
                display="flex"
                flexDirection={!isMobileLayout ? "row" : "column"}
                gap={!isMobileLayout ? "5" : "4"}
                alignItems="center"
                paddingX="3"
                paddingY={isMobileLayout ? "3" : undefined}
                marginX="-3"
                marginY={isMobileLayout ? "1" : undefined}
                borderRadius={platform !== "mobile" ? "1" : undefined}
                backgroundColor={isPressed ? "grey-5" : undefined}
            >
                <Box flexGrow="1">
                    <Box display="flex" alignItems="center" gap="1.5">
                        <Box flexShrink="0" width="4" height="4">
                            <IconContext.Provider value={{size: spacing["4"]}}>
                                {icon}
                            </IconContext.Provider>
                        </Box>
                        <Box fontSize="100" style={{whiteSpace: "nowrap"}}>
                            {withCreateVerbBeforeItemName
                                ? `${createVerb} ${name}`
                                : startOfSentenceName}
                        </Box>
                        {withStartHereBadge && <CreateWidgetSecondaryItemStartHereBadge />}
                        {shouldShowLoadingIndicator && (
                            <Box paddingLeft="1">
                                <SpinnerGap
                                    className={spinAnimationClassName}
                                    size={spacing["4"]}
                                    color={colorSchemeVars["grey-60"]}
                                />
                            </Box>
                        )}
                    </Box>
                    <Spacer space="1.5" />
                    <Box
                        fontSize="50"
                        color="grey-60"
                        paddingRight="10"
                        overflow="hidden"
                        style={{
                            lineHeight: 1.3,
                            // Truncate after 3 lines of text. Unofficial syntax that works in all browsers
                            // except IE.
                            // https://stackoverflow.com/questions/3922739/limit-text-length-to-n-lines-using-css
                            display: "-webkit-box",
                            WebkitLineClamp: 3,
                            lineClamp: 3,
                            WebkitBoxOrient: "vertical",
                            textOverflow: "ellipsis",
                            // Render contextual alternate glyphs. Particularly important that we render
                            // the right "@" for mentions.
                            // eslint-disable-next-line cyberworlds/string-quotes
                            fontFeatureSettings: '"calt" on',
                        }}
                    >
                        {description}
                    </Box>
                </Box>
                <CreateWidgetSecondaryItemExample
                    example={example}
                    isPressed={isPressed}
                    isMobileLayout={isMobileLayout}
                    baseWidth={baseExampleWidth}
                    mobileScale={exampleMobileScale}
                />
            </Box>
        </FocusRing>
    );
}

function CreateWidgetSecondaryItemExample({
    example,
    isPressed,
    isMobileLayout,
    baseWidth,
    mobileScale,
}: {
    example: ReactNode;
    isPressed: boolean;
    isMobileLayout: boolean;
    baseWidth: Spacing;
    mobileScale: number;
}) {
    const spacingScale = useSpacingScale();

    return (
        <Box
            width={!isMobileLayout ? baseWidth : "full"}
            paddingY={!isMobileLayout ? "3" : undefined}
        >
            <Box
                position="relative"
                zIndex="0"
                flexShrink="0"
                overflow="hidden"
                backgroundColor="grey-0"
                borderRadius="1"
                boxShadow="elevation-5-without-border"
                style={{
                    width: !isMobileLayout
                        ? spacing[baseWidth]
                        : convertRemLengthToPx(baseWidth, spacingScale) * mobileScale,
                    height: !isMobileLayout
                        ? spacing[createWidgetExampleHeight]
                        : convertRemLengthToPx(createWidgetExampleHeight, spacingScale) *
                          mobileScale,
                }}
            >
                <Box
                    position="absolute"
                    zIndex="10"
                    inset="0"
                    border="grey-10-translucent"
                    borderRadius="1"
                    pointerEvents="none"
                    backgroundColor={isPressed ? "grey-5-translucent" : undefined}
                />
                <Box
                    position="relative"
                    zIndex="0"
                    width={baseWidth}
                    style={{
                        transformOrigin: "top left",
                        transform: isMobileLayout ? `scale(${mobileScale})` : undefined,
                    }}
                >
                    {example}
                </Box>
            </Box>
        </Box>
    );
}

function CreateWidgetSecondaryItemStartHereBadge() {
    const paddingX = `${parseRemLength("1") * 1.25}rem`;

    return (
        <Box
            marginLeft="1"
            backgroundColor={accentThemeBackgroundColor}
            color={accentThemeForegroundColor}
            fontSize="50"
            height="4"
            display="flex"
            alignItems="center"
            borderRadius="full"
            style={{paddingLeft: paddingX, paddingRight: paddingX, whiteSpace: "nowrap"}}
        >
            Start here
        </Box>
    );
}
