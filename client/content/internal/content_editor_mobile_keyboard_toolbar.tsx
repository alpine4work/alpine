import {animate} from "motion";
import {
    At,
    DotsThreeVertical,
    IconContext,
    Link as LinkIcon,
    ListBullets,
    ListNumbers,
    TextBolder,
    TextItalic,
} from "phosphor-react";
import {ReactNode, useEffect, useId, useRef, useState} from "react";
import {mergeProps, useHover, usePress} from "react-aria";
import {
    ContentEditorMobileKeyboardSubstitute,
    ContentEditorMobileKeyboardSubstituteRef,
} from "~/client/content/internal/content_editor_mobile_fixed_toolbar_keyboard_substitute.js";
import {Box} from "~/client/design/box.js";
import {
    nativeMobileBottomBarKeyboardToolbarHeight,
    nativeMobileBottomBarKeyboardToolbarHeightRem,
} from "~/client/design/native_mobile_bottom_bar.js";
import {isMobileWebKit} from "~/client/helpers/browser/is_mobile_web_kit.js";
import {useIsMounted} from "~/client/helpers/lifecycle/use_is_mounted.js";
import {useClientInfo} from "~/client/remix/client_info_context.js";
import {NativeMobileBridge} from "~/client/remix/native_mobile_bridge.js";
import {spacing} from "~/shared/design/spacing.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {colorSchemeVars} from "~/shared/styles/styles.js";

export function ContentEditorMobileKeyboardToolbar({isFocused}: {isFocused: boolean}) {
    const isMounted = useIsMounted();
    const {isNativeMobile} = useClientInfo();

    const toolbarRef = useRef<HTMLDivElement>(null);
    const substituteRef = useRef<ContentEditorMobileKeyboardSubstituteRef>(null);
    const id = useId();

    const [isSubstituteOpen, setIsSubstituteOpen] = useState(false);

    useEffect(() => {
        if (!isFocused && isSubstituteOpen) {
            const substitute = assertExists(substituteRef.current);
            substitute.closeWithAnimation();
        }
    }, [isSubstituteOpen, isFocused]);

    // If we unmounted while the substitute is open then we need to run
    // `cleanupAfterSubstitute()`.
    useEffect(() => {
        return () => {
            if (!isMounted() && isSubstituteOpen) {
                void NativeMobileBridge?.keyboard.cleanupAfterSubstitute();
            }
        };
    }, [isSubstituteOpen, isMounted]);

    const isFocusedRef = useRef(isFocused);
    useEffect(() => {
        // In our native mobile app, the native mobile wrapper is responsible for
        // making this toolbar visible.
        if (isNativeMobile) return;

        if (isFocusedRef.current === isFocused) return;
        isFocusedRef.current = isFocused;

        const toolbarElement = assertExists(toolbarRef.current);

        if (isFocused) {
            animate(
                toolbarElement,
                {
                    y: [0, `-${nativeMobileBottomBarKeyboardToolbarHeightRem}rem`],
                },
                {
                    duration: 0.2,
                },
            );
        } else {
            animate(
                toolbarElement,
                {
                    y: [`-${nativeMobileBottomBarKeyboardToolbarHeightRem}rem`, 0],
                },
                {
                    duration: 0.2,
                },
            );
        }
    }, [isFocused, isNativeMobile]);

    return (
        <>
            <Box
                ref={toolbarRef}
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
                    // `bottom: "-" + nativeMobileBottomBarKeyboardToolbarHeightRem + "rem"` also
                    // works except for in our Safari app keyboard support which limits the outlet
                    // height to what's visible above the keyboard.
                    top: `var(--space-outlet-height, 100svh)`,
                    transition:
                        // Animate after `--space-outlet-height` changes when the keyboard opens in
                        // mobile Safari (not our native app). This is a little hacky. Ideally we'd run
                        // the animation in our effect again but this is simple and we don't care too
                        // much about mobile Safari (we care a lot about our native app).
                        isFocused && isMobileWebKit && !isNativeMobile
                            ? `top 400ms ease`
                            : undefined,
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
                    height={nativeMobileBottomBarKeyboardToolbarHeight}
                    backgroundColor="grey-5"
                    display="flex"
                    paddingX="1"
                    onPointerDownCapture={event => {
                        // Tapping on the toolbar shouldn't unfocus the content editor since that will
                        // remove the selection and hide the keyboard.
                        event.preventDefault();
                    }}
                >
                    <ContentEditorMobileKeyboardToolbarButton dividerRight>
                        <At />
                    </ContentEditorMobileKeyboardToolbarButton>
                    <ContentEditorMobileKeyboardToolbarButton dividerLeft>
                        <TextBolder />
                    </ContentEditorMobileKeyboardToolbarButton>
                    <ContentEditorMobileKeyboardToolbarButton>
                        <TextItalic />
                    </ContentEditorMobileKeyboardToolbarButton>
                    <ContentEditorMobileKeyboardToolbarButton dividerRight>
                        <LinkIcon />
                    </ContentEditorMobileKeyboardToolbarButton>
                    <ContentEditorMobileKeyboardToolbarButton dividerLeft>
                        <ListBullets />
                    </ContentEditorMobileKeyboardToolbarButton>
                    <ContentEditorMobileKeyboardToolbarButton dividerRight>
                        <ListNumbers />
                    </ContentEditorMobileKeyboardToolbarButton>
                    <ContentEditorMobileKeyboardToolbarButton
                        dividerLeft
                        onPress={() => {
                            if (!NativeMobileBridge) {
                                setIsSubstituteOpen(true);
                            } else {
                                NativeMobileBridge.keyboard.prepareForSubstitute().finally(() => {
                                    setIsSubstituteOpen(true);
                                });
                            }
                        }}
                    >
                        <DotsThreeVertical />
                    </ContentEditorMobileKeyboardToolbarButton>
                </Box>
            </Box>
            {isSubstituteOpen && (
                <ContentEditorMobileKeyboardSubstitute
                    ref={substituteRef}
                    onClose={() => {
                        setIsSubstituteOpen(false);
                        void NativeMobileBridge?.keyboard.cleanupAfterSubstitute();
                    }}
                />
            )}
        </>
    );
}

function ContentEditorMobileKeyboardToolbarButton({
    children,
    dividerLeft,
    dividerRight,
    onPress,
}: {
    children?: ReactNode;
    dividerLeft?: boolean;
    dividerRight?: boolean;
    onPress?: () => void;
}) {
    const {isHovered, hoverProps} = useHover({});
    const {isPressed, pressProps} = usePress({onPress});

    const hoverAndPressProps = mergeProps(hoverProps, pressProps);

    return (
        <>
            {dividerLeft && (
                <Box
                    // We want all space on the toolbar to be touchable so the user doesn't touch
                    // and nothing happens (which can feel like a bug).
                    {...hoverAndPressProps}
                    // In case `hoverAndPressProps` had a `ref`, unset it.
                    ref={null}
                    height="full"
                    width="1"
                />
            )}
            <Box
                // None of this is focusable since it's used on mobile where there's no
                // keyboard navigation.
                {...hoverAndPressProps}
                flexGrow="1"
                height="full"
                paddingY="1"
                display="flex"
                justifyContent="center"
                alignItems="center"
            >
                <Box
                    width="full"
                    height="full"
                    backgroundColor={isPressed ? "grey-20" : isHovered ? "grey-10" : undefined}
                    borderRadius="md"
                    display="flex"
                    justifyContent="center"
                    alignItems="center"
                >
                    <IconContext.Provider
                        value={{
                            color: isPressed
                                ? colorSchemeVars["grey-text"]
                                : colorSchemeVars["grey-70"],
                            size: spacing["5"],
                        }}
                    >
                        {children}
                    </IconContext.Provider>
                </Box>
            </Box>
            {dividerRight && (
                <Box
                    {...hoverAndPressProps}
                    // In case `hoverAndPressProps` had a `ref`, unset it.
                    ref={null}
                    height="full"
                    width="1"
                    paddingY="2"
                >
                    <Box height="full" borderRight="grey-10" />
                </Box>
            )}
        </>
    );
}
