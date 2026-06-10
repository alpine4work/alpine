import {animate} from "motion";
import {
    CalendarBlank,
    IconContext,
    SpinnerGap,
    TextIndent,
    TextOutdent,
    User,
} from "phosphor-react";
import {Selection} from "prosemirror-state";
import {ReactNode, Ref, RefObject, useEffect, useId, useRef, useState} from "react";
import {mergeProps, useHover, usePress} from "react-aria";
import {createPortal, flushSync} from "react-dom";
import {Box} from "~/client/web/design/box.js";
import {
    mobileBottomBarKeyboardToolbarHeight,
    mobileBottomBarKeyboardToolbarHeightRem,
} from "~/client/web/design/mobile_bottom_bar.js";
import {useOverlayBlockingPortalElement} from "~/client/web/design/overlay_helpers.js";
import {useReporter} from "~/client/web/design/reporter.js";
import {
    useRegisterBottomBarMobileKeyboardToolbarFrame,
    useWebMobileKeyboardToolbarSafeAreaInsetBottom,
} from "~/client/web/design/subscribe_to_bottom_bar_frame_change.js";
import {useDelayLoadingIndicator} from "~/client/web/design/use_delay_loading_indicator.js";
import {isMobileWebKit} from "~/client/web/helpers/browser/is_mobile_web_kit.js";
import {useLayoutEffectWithoutServerSideWarning} from "~/client/web/helpers/lifecycle/use_layout_effect_without_server_side_warning.js";
import {useStateWithDependenciesWithoutDispatch} from "~/client/web/helpers/lifecycle/use_state_with_dependencies.js";
import {assignRef} from "~/client/web/helpers/refs/assign_ref.js";
import {useClientInfo} from "~/client/web/remix/client_info_context.js";
import {NativeMobileBridge} from "~/client/web/remix/native_mobile_bridge.js";
import {useNavigate} from "~/client/web/remix/use_navigate.js";
import {spinAnimationClassName, sprinkles} from "~/client/web/styles/styles.js";
import {TaskClientQuery} from "~/client/web/tasks/core/task_client_query.js";
import {TaskRowTitleInputRef} from "~/client/web/tasks/internal/task_row_title_input.js";
import {TaskPriorityIcon} from "~/client/web/tasks/task_priority_icon.js";
import {spacing} from "~/shared/design/core/spacing.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {noop} from "~/shared/helpers/control/noop.js";
import {MaybePromise} from "~/shared/helpers/types/maybe_promise.js";
import {TaskModel} from "~/shared/tasks/model/task_model.js";
import {TaskQuerySortCursor} from "~/shared/tasks/task_query_sort_cursor.js";

/**
 * The way our mobile keyboard toolbar works is at the task grid view level we
 * render a `<TaskGridViewMobileKeyboardToolbarContainer>` which is the native
 * mobile bottom bar. It contains disabled buttons. When a `<TaskRowView>` receives
 * focus it renders a `<TaskGridViewMobileKeyboardToolbar>` which portals into the
 * container with buttons that actually work!
 *
 * We use this setup because we want to use the props and state of `<TaskRowView>`
 * to render our keyboard toolbar buttons but for smooth animations between states,
 * want one bottom bar element animating up/down.
 *
 * Instead of portaling into `<TaskGridViewMobileKeyboardToolbarContainer>` we
 * could implement all the buttons at that level by using `TaskRowViewRef`s. But
 * then it's challenging to get access to the row's corresponding `TaskModel` in
 * state since while we have a task key -> `TaskRowViewRef` data structure, we
 * don't have a task key -> `TaskGridViewVirtualizedListStateItem` data structure.
 */
export function TaskGridViewMobileKeyboardToolbar({
    portalRef,
    maxGridExpandableTaskDepth,
    task,
    parents,
    isFirstTaskInQuery,
    withoutAssigneeField,
    withoutDueDateField,
    isQueryManuallySorted,
    titleInputRef,
    nestWithPreviousTaskRowIfExistsAndExpand,
    unnestTaskIfNestedRow,
    focusAssigneeInput,
    focusPriorityInput,
    focusDueDateInput,
    scrollToAnchorPosition,
}: {
    portalRef: RefObject<HTMLDivElement | null>;
    maxGridExpandableTaskDepth: number;
    task: TaskModel | null;
    parents: ReadonlyArray<{query: TaskClientQuery; cursor: TaskQuerySortCursor}>;
    withoutAssigneeField: boolean;
    withoutDueDateField: boolean;
    isQueryManuallySorted: boolean;
    isFirstTaskInQuery: boolean;
    titleInputRef: RefObject<TaskRowTitleInputRef | null>;
    nestWithPreviousTaskRowIfExistsAndExpand: (titleSelection: Selection) => void;
    unnestTaskIfNestedRow: (titleSelection: Selection) => void;
    focusAssigneeInput: () => void;
    focusPriorityInput: () => void;
    focusDueDateInput: () => void;
    scrollToAnchorPosition: () => void;
}) {
    const portalElement = assertExists(
        portalRef.current,
        "Must render after `<TaskGridViewMobileKeyboardToolbarContainer>` has been rendered",
    );

    const navigate = useNavigate();

    return createPortal(
        <TaskGridViewMobileKeyboardToolbarContent
            onDedentPress={
                isQueryManuallySorted && task && parents.length > 0
                    ? () => {
                          const titleInput = assertExists(titleInputRef.current);
                          unnestTaskIfNestedRow(titleInput.getSelection());
                      }
                    : null
            }
            onIndentPress={
                isQueryManuallySorted &&
                task &&
                !isFirstTaskInQuery &&
                parents.length < maxGridExpandableTaskDepth
                    ? () => {
                          const titleInput = assertExists(titleInputRef.current);
                          nestWithPreviousTaskRowIfExistsAndExpand(titleInput.getSelection());
                      }
                    : null
            }
            withoutAssigneeField={withoutAssigneeField}
            withoutDueDateField={withoutDueDateField}
            isAssigneeActive={!!task?.getAssignee()}
            onAssigneePress={() => {
                // `flushSync()` so React re-renders with an open overlay which influences the
                // anchor position read by `scrollToAnchorPosition()`.
                flushSync(() => focusAssigneeInput());

                scrollToAnchorPosition();
            }}
            isPriorityActive={!!task?.getPriority()}
            onPriorityPress={() => {
                // `flushSync()` so React re-renders with an open overlay which influences the
                // anchor position read by `scrollToAnchorPosition()`.
                flushSync(() => focusPriorityInput());

                scrollToAnchorPosition();
            }}
            isDueDateActive={!!task?.getDueDate()}
            onDueDatePress={() => {
                // `flushSync()` so React re-renders with an open overlay which influences the
                // anchor position read by `scrollToAnchorPosition()`.
                flushSync(() => focusDueDateInput());

                scrollToAnchorPosition();
            }}
            onOpenPress={task ? () => navigate(`/task/${task.id}`) : null}
        />,
        portalElement,
    );
}

export function TaskGridViewMobileKeyboardToolbarContainer({
    portalRef,
    withoutAssigneeField,
    withoutDueDateField,
}: {
    portalRef: Ref<HTMLDivElement>;
    withoutAssigneeField: boolean;
    withoutDueDateField: boolean;
}) {
    const {isNativeMobile} = useClientInfo();
    const rootPortalElement = assertExists(
        // Render in the blocking portal element so that we render over blocking covers! So
        // you can still interact with the keyboard toolbar even if an
        // `<Overlay isBlocking={true}>` overlay is visible.
        useOverlayBlockingPortalElement(),
        "Can\u2019t server render `<TaskGridViewMobileKeyboardToolbarContainer>`",
    );

    const toolbarRef = useRef<HTMLDivElement>(null);

    const id = useId();

    const [isVisible, setIsVisible] = useState(false);

    const hasInitiallyMountedRef = useRef(false);
    useLayoutEffectWithoutServerSideWarning(() => {
        if (hasInitiallyMountedRef.current) return;
        hasInitiallyMountedRef.current = true;

        // Create a portal element that's disconnected from the DOM. We'll add it to the
        // DOM if a child is portaled in.
        const portalElement = document.createElement("div");

        portalElement.className = sprinkles({
            position: "absolute",
            inset: "0",
        });

        assignRef(portalRef, portalElement);

        let isCancelled = false;
        let isUpdateScheduled = false;

        const observer = new MutationObserver(() => {
            if (isUpdateScheduled) return;
            isUpdateScheduled = true;

            // Wait until right before the animation frame to re-render in case multiple
            // mutations happen (remove node + add node) in this animation frame.
            requestAnimationFrame(() => {
                if (isCancelled) return;

                isUpdateScheduled = false;

                const isVisible = !!portalElement.firstElementChild;

                if (!isVisible && toolbarRef.current) {
                    const toolbarElement = toolbarRef.current;
                    if (toolbarElement.contains(portalElement)) {
                        toolbarElement.firstElementChild!.removeChild(portalElement);
                    }
                }

                // Make sure we synchronously re-render so our `appendChild()`/`removeChild()` is
                // performed in the same paint.
                flushSync(() => setIsVisible(isVisible));

                if (isVisible) {
                    const toolbarElement = assertExists(toolbarRef.current);
                    if (!toolbarElement.contains(portalElement)) {
                        toolbarElement.firstElementChild!.appendChild(portalElement);
                    }
                }
            });
        });

        observer.observe(portalElement, {childList: true});

        return () => {
            isCancelled = true;
            observer.disconnect();
        };
    }, [portalRef]);

    const [isCompletelyHiddenFromState, setIsCompletelyHidden] = useState(true);
    const isCompletelyHidden = isCompletelyHiddenFromState && !isVisible;
    if (isCompletelyHidden !== isCompletelyHiddenFromState)
        setIsCompletelyHidden(isCompletelyHidden);

    const isAnimatingShowRef = useRef(false);
    useEffect(() => {
        // In our native mobile app, the native mobile wrapper is responsible for making
        // this toolbar visible.
        if (NativeMobileBridge) return;

        if (!isVisible) {
            isAnimatingShowRef.current = false;
            return;
        }

        if (isAnimatingShowRef.current) return;
        isAnimatingShowRef.current = true;

        const toolbarElement = assertExists(toolbarRef.current);

        void animate(
            toolbarElement,
            {y: [0, `-${mobileBottomBarKeyboardToolbarHeightRem}rem`]},
            {duration: 0.2},
        );
    }, [isNativeMobile, isVisible]);

    const isAnimatingHideRef = useRef(false);
    useEffect(() => {
        if (isVisible || isCompletelyHiddenFromState) {
            isAnimatingHideRef.current = false;
            return;
        }

        if (isAnimatingHideRef.current) return;
        isAnimatingHideRef.current = true;

        const toolbarElement = assertExists(toolbarRef.current);

        if (!NativeMobileBridge) {
            const animation = animate(
                toolbarElement,
                {y: [`-${mobileBottomBarKeyboardToolbarHeightRem}rem`, 0]},
                {duration: 0.2},
            );

            void animation.finished.finally(() => {
                setIsCompletelyHidden(true);
            });
        } else {
            NativeMobileBridge.keyboard.scheduleAfterAnimation(() => {
                setIsCompletelyHidden(true);
            });
        }
    }, [isCompletelyHiddenFromState, isVisible]);

    useRegisterBottomBarMobileKeyboardToolbarFrame({isDisabled: isCompletelyHidden});
    useWebMobileKeyboardToolbarSafeAreaInsetBottom({isVisible: !isCompletelyHidden});

    if (isCompletelyHidden) return null;

    return createPortal(
        <Box
            ref={toolbarRef}
            id={isNativeMobile ? `nmbb-kt-${id}` : id}
            // NOTE(calebmer): This is a little strange, we have a wrapper `<div>` with
            // `spacing["2"]` padding height on our keyboard toolbar. I've observed this makes
            // the animation when the iOS keyboard opens more consistent. Before adding this
            // slop sometimes when animating the keyboard open the toolbar wouldn't be visible
            // until half way through the animation then pop in. This looks janky. You can
            // observe it in [this video][1] if you go frame by frame either time the keyboard
            // opens. The toolbar pops in during the animation. This doesn't happen all the
            // time. It's sporadic, mostly happening when the keyboard opens without needing to
            // scroll the view.
            //
            // My theory is that somewhere iOS or Safari is un-rendering the element while it's
            // offscreen and since we start the animation through non-traditional means
            // (directly writing to Safari's `CALayer` transform property in native code) it
            // gets rendered during the animation not before it. I've found adding this slop
            // fixes the bug and makes the animation much more consistent. I don't have a
            // proven reason as to why but my theory is the slop tricks iOS or Safari into
            // thinking the toolbar is visible onscreen so needs to always be rendered.
            //
            // [1]: https://gist.github.com/calebmer/167a4853a187b44ed0621e2d667e7873
            pointerEvents="none"
            paddingTop="2"
            marginTop="-2"
            position="absolute"
            // Render above everything on the page
            zIndex="60"
            left="0"
            right="0"
            style={{
                top: `var(--space-outlet-height, 100svh)`,
                transition:
                    // Animate after `--space-outlet-height` changes when the keyboard opens in mobile
                    // Safari (not our native app). This is a little hacky. Ideally we'd run the
                    // animation in our effect again but this is simple and we don't care too much
                    // about mobile Safari (we care a lot about our native app).
                    isVisible && isMobileWebKit && !isNativeMobile ? `top 250ms ease` : undefined,
                // Our native mobile wrapper looks for compositing layers created from an element
                // with an ID that starts with `nmbb-` and ties their position to the tab bar and
                // software keyboard. So we get smooth animations while the keyboard opens or the
                // tab bar shifts offscreen. To create a compositing layer we need to set
                // `will-change: transform`. It's not specified that `will-change: transform` MUST
                // create a compositing layer, instead some browser engines implement this hint
                // themselves as an optimization.
                //
                // It so happens that WebKit is one of those browsers. Here's the code in WebKit
                // that does this: [part 1][1], [part 2][2].
                //
                // [1]:
                //     https://github.com/WebKit/WebKit/blob/b3b7144bd152111660f81e9aecb76b0a4a8642ab/Source/WebCore/rendering/RenderLayerCompositor.cpp#L2831
                // [2]:
                //     https://github.com/WebKit/WebKit/blob/b3b7144bd152111660f81e9aecb76b0a4a8642ab/Source/WebCore/rendering/style/WillChangeData.cpp#L158
                willChange: isNativeMobile ? "transform" : undefined,
                // Set `transform` to its initial value assuming the tab bar is up. Since this is a
                // keyboard toolbar (configured with `kt-` in the ID) it doesn't move with the tab
                // bar.
                transform: isNativeMobile ? "translateY(0px)" : undefined,
                // We don't unmount the grid view keyboard toolbar when it's completely hidden,
                // only hide it visually. So for instance if you're in a task detail view focused
                // on the title, the grid view keyboard toolbar will technically be in the DOM you
                // just won't see it. We need to keep this element in the DOM so siblings can
                // portal in actual toolbar implementations.
                visibility: isCompletelyHidden ? "hidden" : undefined,
                pointerEvents: isCompletelyHidden ? "none" : undefined,
            }}
            inert={isCompletelyHidden ? true : undefined}
            aria-hidden={isCompletelyHidden ? "true" : undefined}
            // Suppress React hydration warnings in our native mobile app. The native mobile
            // app sets the `transform` property on this element. Sometimes before React
            // finishes hydrating. This is expected, React can ignore the difference.
            suppressHydrationWarning={isNativeMobile ? true : undefined}
        >
            <Box
                pointerEvents="auto"
                position="relative"
                height={mobileBottomBarKeyboardToolbarHeight}
                backgroundColor="grey-5"
                display="flex"
                paddingX="0.5"
                onPointerDownCapture={event => {
                    // Tapping on the toolbar shouldn't unfocus the content editor since that will
                    // remove focus and hide the keyboard.
                    event.preventDefault();
                }}
            >
                {/* `portalElement` is added here when we render the toolbar. */}

                {!isVisible && (
                    <Box position="absolute" inset="0">
                        <TaskGridViewMobileKeyboardToolbarContent
                            onDedentPress={null}
                            onIndentPress={null}
                            withoutAssigneeField={withoutAssigneeField}
                            withoutDueDateField={withoutDueDateField}
                            isAssigneeActive={false}
                            onAssigneePress={null}
                            isPriorityActive={false}
                            onPriorityPress={null}
                            isDueDateActive={false}
                            onDueDatePress={null}
                            onOpenPress={null}
                        />
                    </Box>
                )}
            </Box>
        </Box>,
        rootPortalElement,
    );
}

function TaskGridViewMobileKeyboardToolbarContent({
    onDedentPress,
    onIndentPress,
    withoutAssigneeField,
    withoutDueDateField,
    isAssigneeActive,
    onAssigneePress,
    isPriorityActive,
    onPriorityPress,
    isDueDateActive,
    onDueDatePress,
    onOpenPress,
}: {
    onDedentPress: (() => void) | null;
    onIndentPress: (() => void) | null;
    withoutAssigneeField: boolean;
    withoutDueDateField: boolean;
    isAssigneeActive: boolean;
    onAssigneePress: (() => void) | null;
    isPriorityActive: boolean;
    onPriorityPress: (() => void) | null;
    isDueDateActive: boolean;
    onDueDatePress: (() => void) | null;
    onOpenPress: (() => Promise<void>) | null;
}) {
    return (
        <Box
            width="full"
            height={mobileBottomBarKeyboardToolbarHeight}
            display="flex"
            paddingX="0.5"
        >
            <TaskGridViewMobileKeyboardToolbarButton
                label="Dedent"
                isActive={false}
                isDisabled={!onDedentPress}
                onPress={onDedentPress ?? noop}
            >
                <TextOutdent />
            </TaskGridViewMobileKeyboardToolbarButton>
            <TaskGridViewMobileKeyboardToolbarButton
                dividerRight
                label="Indent"
                isActive={false}
                isDisabled={!onIndentPress}
                onPress={onIndentPress ?? noop}
            >
                <TextIndent />
            </TaskGridViewMobileKeyboardToolbarButton>
            {!withoutAssigneeField && (
                <TaskGridViewMobileKeyboardToolbarButton
                    dividerLeft
                    label="Assignee"
                    isActive={isAssigneeActive}
                    isDisabled={!onAssigneePress}
                    onPress={onAssigneePress ?? noop}
                >
                    <User />
                </TaskGridViewMobileKeyboardToolbarButton>
            )}
            <TaskGridViewMobileKeyboardToolbarButton
                dividerLeft={withoutAssigneeField}
                dividerRight={withoutDueDateField}
                label="Priority"
                isActive={isPriorityActive}
                isDisabled={!onPriorityPress}
                onPress={onPriorityPress ?? noop}
            >
                <TaskPriorityIcon
                    size="5"
                    priority={null}
                    shouldHighlightUrgent={false}
                    withCurrentColorForUnfilledBars={true}
                />
            </TaskGridViewMobileKeyboardToolbarButton>
            {!withoutDueDateField && (
                <TaskGridViewMobileKeyboardToolbarButton
                    dividerRight
                    label="Due date"
                    isActive={isDueDateActive}
                    isDisabled={!onDueDatePress}
                    onPress={onDueDatePress ?? noop}
                >
                    <CalendarBlank />
                </TaskGridViewMobileKeyboardToolbarButton>
            )}
            <TaskGridViewMobileKeyboardToolbarButton
                dividerLeft
                label="Open"
                isActive={false}
                flexGrow={1.1}
                isDisabled={!onOpenPress}
                pressErrorTitle="Couldn&#x2019;t open task"
                onPress={onOpenPress ?? noop}
            >
                <Box
                    fontSize="100"
                    fontStyle="semi-bold"
                    color={onOpenPress ? "grey-100" : undefined}
                >
                    Open
                </Box>
            </TaskGridViewMobileKeyboardToolbarButton>
        </Box>
    );
}

function TaskGridViewMobileKeyboardToolbarButton({
    label,
    children,
    dividerLeft,
    dividerRight,
    isActive,
    isDisabled,
    flexGrow,
    pressErrorTitle,
    onPress,
}: {
    label: string;
    children?: ReactNode;
    dividerLeft?: boolean;
    dividerRight?: boolean;
    isActive: boolean;
    isDisabled?: boolean;
    flexGrow?: number;
    pressErrorTitle?: string;
    onPress: () => MaybePromise<void>;
}) {
    const reporter = useReporter();

    const [isPending, setIsPending] = useState(false);

    const {isHovered, hoverProps} = useHover({});

    const {isPressed, pressProps} = usePress({
        // Toolbar buttons should not be focusable since we don't want the content editor
        // to lose focus.
        preventFocusOnPress: true,
        isDisabled,
        onPress: event => {
            const defaultPressErrorTitle =
                event.pointerType === "touch"
                    ? "The button you tapped didn\u2019t work"
                    : "The button you clicked didn\u2019t work";

            let promise;
            try {
                promise = onPress?.();
            } catch (error) {
                reporter.displayError(pressErrorTitle ?? defaultPressErrorTitle, error);
                return;
            }

            // If the press returns a promise:
            //
            // - Show a loading spinner after a short delay
            // - Show a toast if there was an error
            if (promise instanceof Promise) {
                setIsPending(true);

                assert(
                    pressErrorTitle,
                    "If `onPress` returns a promise then the `pressErrorTitle` prop is required",
                );

                promise.then(
                    () => {
                        setIsPending(false);
                    },
                    error => {
                        setIsPending(false);
                        reporter.displayError(pressErrorTitle, error);
                    },
                );
            }
        },
    });

    const pressAndHoverProps = mergeProps(hoverProps, pressProps);

    // Change this state only when `isPressed` changes. If it becomes active while
    // pressed we don't want to change the color.
    const isPressedAndActive = useStateWithDependenciesWithoutDispatch(
        ([isPressed]) => isPressed && isActive,
        [isPressed],
    );

    // We wait a bit before showing our pending spinner. Some actions are very fast so
    // we delay showing a spinner to avoid a loading spinner flicker which can be
    // jarring.
    const shouldShowPendingSpinner = useDelayLoadingIndicator(isPending);

    return (
        <>
            {dividerLeft && (
                <Box
                    // We want all space on the toolbar to be touchable so the user doesn't touch and
                    // nothing happens (which can feel like a bug).
                    {...pressAndHoverProps}
                    // In case `pressAndHoverProps` had a `ref`, unset it.
                    ref={null}
                    height="full"
                    width="0.5"
                />
            )}
            <Box
                // None of this is focusable since it's used on mobile where there's no keyboard
                // navigation.
                {...pressAndHoverProps}
                aria-label={label}
                height="full"
                paddingY="1"
                paddingX="0.5"
                display="flex"
                justifyContent="center"
                alignItems="center"
                position="relative"
                style={{flexGrow: flexGrow ?? 1}}
            >
                {shouldShowPendingSpinner && (
                    <Box
                        position="absolute"
                        inset="0"
                        display="flex"
                        justifyContent="center"
                        alignItems="center"
                    >
                        <SpinnerGap className={spinAnimationClassName} size={spacing["5"]} />
                    </Box>
                )}
                <Box
                    width="full"
                    height="full"
                    color={isDisabled ? "grey-30" : isPressed || isActive ? "grey-100" : "grey-70"}
                    backgroundColor={
                        isDisabled
                            ? undefined
                            : isPressedAndActive
                              ? "grey-20"
                              : isHovered && isPressed
                                ? "grey-20"
                                : isPressed || isActive || isHovered
                                  ? "grey-10"
                                  : undefined
                    }
                    borderRadius="1.5"
                    display="flex"
                    justifyContent="center"
                    alignItems="center"
                    opacity={shouldShowPendingSpinner ? "0" : undefined}
                >
                    <IconContext.Provider
                        value={{
                            color: "currentColor",
                            size: spacing["5"],
                        }}
                    >
                        {children}
                    </IconContext.Provider>
                </Box>
            </Box>
            {dividerRight && (
                <Box
                    {...pressAndHoverProps}
                    // In case `pressAndHoverProps` had a `ref`, unset it.
                    ref={null}
                    height="full"
                    width="0.5"
                    paddingY="2"
                >
                    <Box height="full" borderRight="grey-10" />
                </Box>
            )}
        </>
    );
}
