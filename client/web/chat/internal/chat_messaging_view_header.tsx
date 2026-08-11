import {Ref, useRef} from "react";
import {
    getElementSafeAreaInsetBottomPx,
    getElementWindowSafeAreaInsetBottomPx,
} from "~/client/web/design/safe_area_inset.js";
import {useLayoutEffectWithoutServerSideWarning} from "~/client/web/helpers/lifecycle/use_layout_effect_without_server_side_warning.js";
import {useMergedRefs} from "~/client/web/helpers/refs/use_merged_refs.js";
import {NativeMobileBridge} from "~/client/web/remix/native_mobile_bridge.js";
import {useSpacingScale} from "~/client/web/remix/spacing_scale_context.js";
import {messageViewMarginY} from "~/client/web/styles/messaging_shared_styles.js";
import {addRemLengths, parseRemLength} from "~/shared/design/core/spacing.js";
import {remPxBySpacingScale} from "~/shared/design/core/spacing_scale.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.open_source.js";

// When our view is full of messages this will be the top margin of the view.
//
// It's ok to export this since it's a constant string.
// eslint-disable-next-line react-refresh/only-export-components
export const chatMessagingViewHeaderMinHeight = addRemLengths(
    messageViewMarginY,
    messageViewMarginY,
);

const chatMessagingViewHeaderMinHeightRem = parseRemLength(chatMessagingViewHeaderMinHeight);

export function ChatMessagingViewHeader({
    itemRef: externalRef,
    shouldRenderWithRelativePositioning,
    offset,
    viewHeight,
    originalContentHeight,
    originalHeight,
}: {
    itemRef: Ref<HTMLDivElement>;
    shouldRenderWithRelativePositioning: boolean;
    offset: number;
    viewHeight: number;
    originalContentHeight: number;
    originalHeight: number;
}) {
    const internalRef = useRef<HTMLDivElement>(null);
    const spacingScale = useSpacingScale();

    const minHeight = chatMessagingViewHeaderMinHeightRem * remPxBySpacingScale[spacingScale];

    useLayoutEffectWithoutServerSideWarning(() => {
        if (shouldRenderWithRelativePositioning) return;

        const element = assertExists(internalRef.current);

        // Exclude safe area contributed by the keyboard opening/closing from the chat
        // messaging view header height. This makes sure scroll animations from
        // `useScrollToAvoidBottomBarsAndMobileKeyboard()` are nice and smooth.
        //
        // We need to update the header height in a layout effect
        const keyboardSafeAreaBottom =
            getElementSafeAreaInsetBottomPx(element) -
            getElementWindowSafeAreaInsetBottomPx(element) -
            (NativeMobileBridge?.tabBar.height ?? 0);

        const height = Math.max(
            minHeight,
            viewHeight - (originalContentHeight - keyboardSafeAreaBottom - originalHeight),
        );

        // Directly update the height style without scheduling another React render. React
        // should never override this style since from React's perspective the height is
        // always `chatMessagingViewHeaderMinHeight`.
        //
        // It's important we directly update the DOM instead of scheduling another render
        // so that other hooks like `useScrollToNewMessages()` that run in the same render
        // will read the correct height.
        if (height !== element.clientHeight) {
            element.style.height = `${height}px`;
        }
    }, [
        minHeight,
        originalContentHeight,
        originalHeight,
        shouldRenderWithRelativePositioning,
        viewHeight,
    ]);

    return (
        <div
            ref={useMergedRefs(internalRef, externalRef)}
            style={{
                // NOTE(calebmer): On initial render we don't know the view height so this header
                // won't push other messages down. So you end up with a flash when server-rendering
                // a chat with few messages where messages jump down. A flash we choose to accept
                // since correct implementations are annoying.
                ...(shouldRenderWithRelativePositioning
                    ? {position: "relative", height: chatMessagingViewHeaderMinHeight}
                    : {
                          position: "absolute",
                          top: offset,
                          left: 0,
                          right: 0,
                          height: chatMessagingViewHeaderMinHeight,
                      }),
            }}
        />
    );
}
