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
import {ReactNode, useId} from "react";
import {mergeProps, useHover, usePress} from "react-aria";
import {Box} from "~/client/design/box.js";
import {nativeMobileBottomBarKeyboardToolbarHeight} from "~/client/design/native_mobile_bottom_bar.js";
import {useClientInfo} from "~/client/remix/client_info_context.js";
import {spacing} from "~/shared/design/spacing.js";
import {colorSchemeVars} from "~/shared/styles/styles.js";

// NOCOMMIT: Animate in on mobile

export function ContentEditorMobileFixedToolbar({isFocused}: {isFocused: boolean}) {
    const {isNativeMobile} = useClientInfo();

    const id = useId();

    return (
        <Box
            id={isNativeMobile ? `nmbb-kt-${id}` : id}
            position="fixed"
            // Render above everything on the page
            zIndex="60"
            left="0"
            right="0"
            bottom={
                isNativeMobile || !isFocused
                    ? `-${nativeMobileBottomBarKeyboardToolbarHeight}`
                    : "0"
            }
            height={nativeMobileBottomBarKeyboardToolbarHeight}
            backgroundColor="grey-5"
            display="flex"
            paddingX="1"
            style={{
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
            onPointerDown={event => {
                // Tapping on the toolbar shouldn't unfocus the content editor since that will
                // remove the selection and hide the keyboard.
                event.preventDefault();
            }}
        >
            <ContentEditorMobileFixedToolbarButton dividerRight>
                <At />
            </ContentEditorMobileFixedToolbarButton>
            <ContentEditorMobileFixedToolbarButton dividerLeft>
                <TextBolder />
            </ContentEditorMobileFixedToolbarButton>
            <ContentEditorMobileFixedToolbarButton>
                <TextItalic />
            </ContentEditorMobileFixedToolbarButton>
            <ContentEditorMobileFixedToolbarButton dividerRight>
                <LinkIcon />
            </ContentEditorMobileFixedToolbarButton>
            <ContentEditorMobileFixedToolbarButton dividerLeft>
                <ListBullets />
            </ContentEditorMobileFixedToolbarButton>
            <ContentEditorMobileFixedToolbarButton dividerRight>
                <ListNumbers />
            </ContentEditorMobileFixedToolbarButton>
            <ContentEditorMobileFixedToolbarButton dividerLeft>
                <DotsThreeVertical />
            </ContentEditorMobileFixedToolbarButton>
        </Box>
    );
}

function ContentEditorMobileFixedToolbarButton({
    children,
    dividerLeft,
    dividerRight,
}: {
    children?: ReactNode;
    dividerLeft?: boolean;
    dividerRight?: boolean;
}) {
    const {isHovered, hoverProps} = useHover({});
    const {isPressed, pressProps} = usePress({});

    const hoverAndPressProps = mergeProps(hoverProps, pressProps);

    return (
        <>
            {dividerLeft && (
                <Box
                    {...hoverAndPressProps}
                    // In case `hoverAndPressProps` had a `ref`, unset it.
                    ref={null}
                    height="full"
                    width="1"
                />
            )}
            <Box
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
