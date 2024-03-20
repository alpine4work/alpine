import {CalendarBlank, IconContext, TextIndent, TextOutdent, User} from "phosphor-react";
import {ReactNode, useId} from "react";
import {mergeProps, useHover, usePress} from "react-aria";
import {createPortal} from "react-dom";
import {Box} from "~/client/design/box.js";
import {mobileBottomBarKeyboardToolbarHeight} from "~/client/design/mobile_bottom_bar.js";
import {useOverlayRootPortalElement} from "~/client/design/overlay.js";
import {useRegisterBottomBarMobileKeyboardToolbarFrame} from "~/client/design/subscribe_to_bottom_bar_frame_change.js";
import {useStateWithDependencies} from "~/client/helpers/lifecycle/use_state_with_dependencies.js";
import {useClientInfo} from "~/client/remix/client_info_context.js";
import {TaskPriorityIcon} from "~/client/tasks/internal/task_priority_icon.js";
import {spacing} from "~/shared/design/spacing.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";

export function TaskGridViewMobileKeyboardToolbar() {
    const {isNativeMobile} = useClientInfo();
    const rootPortalElement = assertExists(
        useOverlayRootPortalElement(),
        "Can't server render `<TaskGridViewMobileKeyboardToolbar>`",
    );

    const id = useId();

    useRegisterBottomBarMobileKeyboardToolbarFrame();

    return createPortal(
        <Box
            id={isNativeMobile ? `nmbb-kt-${id}` : id}
            // NOTE(calebmer): This is a little strange, we have a wrapper `<div>` with
            // `spacing["2"]` padding height on our keyboard toolbar. I've observed this
            // makes the animation when the iOS keyboard opens more consistent. Before
            // adding this slop sometimes when animating the keyboard open the toolbar
            // wouldn't be visible until half way through the animation then pop in. This
            // looks janky. You can observe it in [this video][1] ([backup link][2]) if you
            // go frame by frame either time the keyboard opens. The toolbar pops in during
            // the animation. This doesn't happen all the time. It's sporadic, mostly
            // happening when the keyboard opens without needing to scroll the view.
            //
            // My theory is that somewhere iOS or Safari is un-rendering the element while
            // it's offscreen and since we start the animation through non-traditional
            // means (directly writing to Safari's `CALayer` transform property in native
            // code) it gets rendered during the animation not before it. I've found adding
            // this slop fixes the bug and makes the animation much more consistent. I
            // don't have a proven reason as to why but my theory is the slop tricks iOS or
            // Safari into thinking the toolbar is visible onscreen so needs to always be
            // rendered.
            //
            // [1]: https://gist.github.com/assets/8282507/3e2c58e3-d489-4e10-85d1-b0a7c4209e55
            // [2]: https://gist.github.com/calebmer/76c991e6e7c51459aaae1702306b0fa4
            pointerEvents="none"
            paddingTop="2"
            marginTop="-2"
            position="fixed"
            // Render above everything on the page
            zIndex="60"
            left="0"
            right="0"
            style={{
                // `bottom: "-" + mobileBottomBarKeyboardToolbarHeightRem + "rem"` also
                // works except for in our Safari app keyboard support which limits the outlet
                // height to what's visible above the keyboard.
                top: `var(--space-outlet-height, 100svh)`,
                // Our native mobile wrapper looks for compositing layers created from an
                // element with an ID that starts with `nmbb-` and ties their position to
                // the tab bar and software keyboard. So we get smooth animations while the
                // keyboard opens or the tab bar shifts offscreen. To create a compositing
                // layer we need to set `will-change: transform`. It's not specified that
                // `will-change: transform` MUST create a compositing layer, instead some
                // browser engines implement this hint themselves as an optimization.
                //
                // It so happens that WebKit is one of those browsers. Here's the code in
                // WebKit that does this: [part 1][1], [part 2][2].
                //
                // [1]: https://github.com/WebKit/WebKit/blob/b3b7144bd152111660f81e9aecb76b0a4a8642ab/Source/WebCore/rendering/RenderLayerCompositor.cpp#L2831
                // [2]: https://github.com/WebKit/WebKit/blob/b3b7144bd152111660f81e9aecb76b0a4a8642ab/Source/WebCore/rendering/style/WillChangeData.cpp#L158
                willChange: isNativeMobile ? "transform" : undefined,
                // Set `transform` to its initial value assuming the tab bar is up. Since this
                // is a keyboard toolbar (configured with `kt-` in the ID) it doesn't move with
                // the tab bar.
                transform: isNativeMobile ? "translateY(0px)" : undefined,
            }}
            // Suppress React hydration warnings in our native mobile app. The native
            // mobile app sets the `transform` property on this element. Sometimes before
            // React finishes hydrating. This is expected, React can ignore the difference.
            suppressHydrationWarning={isNativeMobile ? true : undefined}
        >
            <Box
                pointerEvents="auto"
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
                <TaskGridViewMobileKeyboardToolbarButton
                    label="Dedent"
                    isActive={false}
                    isDisabled={true}
                    onPress={() => {
                        // NOCOMMIT: Implement
                    }}
                >
                    <TextOutdent />
                </TaskGridViewMobileKeyboardToolbarButton>
                <TaskGridViewMobileKeyboardToolbarButton
                    dividerRight
                    label="Indent"
                    isActive={false}
                    onPress={() => {
                        // NOCOMMIT: Implement
                    }}
                >
                    <TextIndent />
                </TaskGridViewMobileKeyboardToolbarButton>
                <TaskGridViewMobileKeyboardToolbarButton
                    dividerLeft
                    label="Assignee"
                    isActive={false}
                    onPress={() => {
                        // NOCOMMIT: Implement
                    }}
                >
                    <User />
                </TaskGridViewMobileKeyboardToolbarButton>
                <TaskGridViewMobileKeyboardToolbarButton
                    label="Priority"
                    isActive={false}
                    onPress={() => {
                        // NOCOMMIT: Implement
                    }}
                >
                    <TaskPriorityIcon
                        size="5"
                        priority={null}
                        shouldHighlightUrgent={false}
                        withCurrentColorForUnfilledBars={true}
                    />
                </TaskGridViewMobileKeyboardToolbarButton>
                <TaskGridViewMobileKeyboardToolbarButton
                    dividerRight
                    label="Due date"
                    isActive={false}
                    onPress={() => {
                        // NOCOMMIT: Implement
                    }}
                >
                    <CalendarBlank />
                </TaskGridViewMobileKeyboardToolbarButton>
                <TaskGridViewMobileKeyboardToolbarButton
                    dividerLeft
                    label="Done"
                    isActive={false}
                    flexGrow={1.2}
                    onPress={() => {
                        // NOCOMMIT: Implement
                    }}
                >
                    <Box fontSize="100" fontStyle="semi-bold">
                        Done
                    </Box>
                </TaskGridViewMobileKeyboardToolbarButton>
            </Box>
        </Box>,
        rootPortalElement,
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
    onPress,
}: {
    label: string;
    children?: ReactNode;
    dividerLeft?: boolean;
    dividerRight?: boolean;
    isActive: boolean;
    isDisabled?: boolean;
    flexGrow?: number;
    onPress: () => void;
}) {
    const {isHovered, hoverProps} = useHover({});
    const {isPressed, pressProps} = usePress({
        isDisabled,
        onPress,
    });

    const pressAndHoverProps = mergeProps(hoverProps, pressProps);

    // Change this state only when `isPressed` changes. If it becomes active while
    // pressed we don't want to change the color.
    const [isPressedAndActive] = useStateWithDependencies(
        (isPressed: boolean) => isPressed && isActive,
        [isPressed],
    );

    return (
        <>
            {dividerLeft && (
                <Box
                    // We want all space on the toolbar to be touchable so the user doesn't touch
                    // and nothing happens (which can feel like a bug).
                    {...pressAndHoverProps}
                    // In case `pressAndHoverProps` had a `ref`, unset it.
                    ref={null}
                    height="full"
                    width="0.5"
                />
            )}
            <Box
                // None of this is focusable since it's used on mobile where there's no
                // keyboard navigation.
                {...pressAndHoverProps}
                aria-label={label}
                height="full"
                paddingY="1"
                paddingX="0.5"
                display="flex"
                justifyContent="center"
                alignItems="center"
                style={{flexGrow: flexGrow ?? 1}}
            >
                <Box
                    width="full"
                    height="full"
                    color={isDisabled ? "grey-30" : isPressed || isActive ? "grey-text" : "grey-70"}
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
                    borderRadius="md"
                    display="flex"
                    justifyContent="center"
                    alignItems="center"
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
