import {useId} from "react";
import {Box} from "~/client/design/box.js";
import {nativeMobileBottomBarKeyboardToolbarHeight} from "~/client/design/native_mobile_bottom_bar.js";
import {useClientInfo} from "~/client/remix/client_info_context.js";

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
            backgroundColor="red-20"
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
        ></Box>
    );
}
