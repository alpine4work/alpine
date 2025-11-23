import {ReactNode, createContext, useContext, useMemo} from "react";
import {useClientInfo} from "~/client/web/remix/client_info_context.js";
import {usePlatform} from "~/client/web/remix/platform_context.js";
import {useSpacingScale} from "~/client/web/remix/spacing_scale_context.js";
import {contentStyles} from "~/client/web/styles/styles.js";
import {
    ParsableRemLength,
    convertRemLengthToPx,
    screenPaddingX,
} from "~/shared/design/core/spacing.js";

const ContentBlockWidthContext = createContext<{
    readonly availableWidth: number;
    readonly assumedPaddingLeft: number;
    readonly assumedPaddingRight: number;
} | null>(null);

/**
 * Returns the pixel width of a block of content in either `<ContentEditor>` or
 * `<ContentView>`. Normally, a block's width is determined by CSS
 * (specifically something like `width: 100%; max-width: var(--max-block-width);`
 * see `blockStyles` in `content.css.ts`). However, sometimes we need to know
 * the block width at render time to properly layout certain views. Namely
 * tables and file rows. This function computes the block width with
 * information available at render time (it also runs on the server).
 *
 * This function depends on parents rendering
 * `<ContentBlockWidthContextProvider>` when they restrict width available to
 * content. For example, `<MessageView>` must render
 * `<ContentBlockWidthContextProvider>` to take away avatar space from content
 * and `<PostListView>` must render `<ContentBlockWidthContextProvider>` to
 * take away space from the channel aside.
 *
 * This function isn't perfect. Without any modification, we assume the window
 * width is `clientInfo.screenWidth`. So if you have a large screen width but a
 * window width that's narrower than the max block width, there will be a
 * discrepancy between the pixel value you get here and what CSS renders.
 * Leading to tables or file rows being lain out assuming a larger block width
 * than what we actually have available.
 *
 * It's unclear how to fix this issue. We don't know the window width at server
 * render time. The window width can change between different web browser tabs
 * (unlike the screen width which is why the screen width is in `ClientInfo`
 * but not the window width). We think the current calculation, even with its
 * inaccuracies, is good enough for now and can make the calculation more
 * specific as we find problematic bugs that arise from an occasionally
 * inaccurate block width calculation.
 */
// We don't care about Fast Refresh in this file since it won't be
// edited often.
// eslint-disable-next-line react-refresh/only-export-components
export function useContentBlockWidth(options?: {
    withoutMaxWidth?: boolean;
    transformScale?: number;
}) {
    const platform = usePlatform();
    const spacingScale = useSpacingScale();
    const clientInfo = useClientInfo();

    const parent = useContext(ContentBlockWidthContext);

    return useMemo(() => {
        const screenPaddingXPx = convertRemLengthToPx(screenPaddingX[platform], spacingScale);

        const availableWidth = parent?.availableWidth ?? clientInfo.screenWidth;
        const assumedPaddingLeft = parent?.assumedPaddingLeft ?? screenPaddingXPx;
        const assumedPaddingRight = parent?.assumedPaddingRight ?? screenPaddingXPx;

        let width = Math.max(0, availableWidth - assumedPaddingLeft - assumedPaddingRight);

        if (options?.transformScale !== undefined && options?.transformScale !== 1) {
            width /= options.transformScale;
        }

        if (!options?.withoutMaxWidth) {
            width = Math.min(
                width,
                convertRemLengthToPx(contentStyles.blockMaxWidth[platform], spacingScale),
            );
        }

        return width;
    }, [
        clientInfo.screenWidth,
        options?.transformScale,
        options?.withoutMaxWidth,
        parent?.assumedPaddingLeft,
        parent?.assumedPaddingRight,
        parent?.availableWidth,
        platform,
        spacingScale,
    ]);
}

/**
 * Get the width available for content without subtracting assumed padding or
 * applying the max block width.
 */
// We don't care about Fast Refresh in this file since it won't be
// edited often.
// eslint-disable-next-line react-refresh/only-export-components
export function useContentBlockAvailableWidth() {
    const clientInfo = useClientInfo();
    const parent = useContext(ContentBlockWidthContext);
    return parent?.availableWidth ?? clientInfo.screenWidth;
}

/**
 * Change the width available for content layout calculations. Our goal is for
 * `useContentBlockWidth()` to return the same width as CSS statically on the
 * server. Uses similar logic to CSS to accomplish this. With properties like
 * `width`, `maxWidth`, `paddingLeft`, and `paddingRight`.
 *
 * We assume there will be at least `screenPaddingX` of padding between the
 * content and screen width. So when you set `width` there's some assumed
 * padding you can optionally declare.
 */
export function ContentBlockWidthContextProvider({
    isDisabled = false,
    width: widthProp,
    maxWidth: maxWidthProp,
    paddingX: paddingXProp,
    paddingLeft: paddingLeftProp,
    paddingRight: paddingRightProp,
    keepAssumedPadding = false,
    withoutAssumedPadding = false,
    children,
}: {
    isDisabled?: boolean;
    width?: ParsableRemLength | number;
    maxWidth?: ParsableRemLength | number;
    paddingX?: ParsableRemLength | number;
    paddingLeft?: ParsableRemLength | number;
    paddingRight?: ParsableRemLength | number;
    keepAssumedPadding?: boolean;
    withoutAssumedPadding?: boolean;
    children: ReactNode;
}) {
    const platform = usePlatform();
    const spacingScale = useSpacingScale();
    const clientInfo = useClientInfo();

    const parent = useContext(ContentBlockWidthContext);

    const child = useMemo(() => {
        if (isDisabled) return parent;

        const screenPaddingXPx = convertRemLengthToPx(screenPaddingX[platform], spacingScale);

        let width = widthProp ?? parent?.availableWidth ?? clientInfo.screenWidth;
        let paddingLeft = paddingLeftProp ?? paddingXProp ?? 0;
        let paddingRight = paddingRightProp ?? paddingXProp ?? 0;
        let assumedPaddingLeft = parent?.assumedPaddingLeft ?? screenPaddingXPx;
        let assumedPaddingRight = parent?.assumedPaddingRight ?? screenPaddingXPx;

        if (typeof width === "string") {
            width = convertRemLengthToPx(width, spacingScale);
        }
        if (typeof paddingLeft === "string") {
            paddingLeft = convertRemLengthToPx(paddingLeft, spacingScale);
        }
        if (typeof paddingRight === "string") {
            paddingRight = convertRemLengthToPx(paddingRight, spacingScale);
        }

        if (maxWidthProp !== undefined) {
            let maxWidth = maxWidthProp;

            if (typeof maxWidth === "string") {
                maxWidth = convertRemLengthToPx(maxWidth, spacingScale);
            }

            width = Math.min(width, maxWidth);
        }

        if (!keepAssumedPadding) {
            assumedPaddingLeft = Math.max(0, assumedPaddingLeft - paddingLeft);
            assumedPaddingRight = Math.max(0, assumedPaddingRight - paddingRight);
        }

        if (withoutAssumedPadding) {
            assumedPaddingLeft = 0;
            assumedPaddingRight = 0;
        }

        width = Math.max(0, width - paddingLeft - paddingRight);

        return {availableWidth: width, assumedPaddingLeft, assumedPaddingRight};
    }, [
        clientInfo.screenWidth,
        isDisabled,
        keepAssumedPadding,
        maxWidthProp,
        paddingLeftProp,
        paddingRightProp,
        paddingXProp,
        parent,
        platform,
        spacingScale,
        widthProp,
        withoutAssumedPadding,
    ]);

    return (
        <ContentBlockWidthContext.Provider value={child}>
            {children}
        </ContentBlockWidthContext.Provider>
    );
}
