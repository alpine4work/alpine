import {Locator} from "playwright";

/**
 * Scroll a Playwright locator pointing to a scrollable area to the bottom of that
 * area.
 *
 * Set `withExpectedScrollHeightChange` to true if you have a
 * `<VirtualizedScrollView>` you expect to grow once you reach the bottom of the
 * screen. The approach we take here for dealing with `<VirtualizedScrollView>`
 * that will change their size is fairly manual and hacky but it works.
 */
export async function scrollLocatorToBottom(
    locator: Locator,
    {withExpectedScrollHeightChange}: {withExpectedScrollHeightChange?: boolean} = {},
) {
    const initialScrollHeight = await locator.evaluate(element => {
        const {scrollHeight} = element;
        element.scrollTop = scrollHeight - element.clientHeight;
        return scrollHeight;
    });

    if (!withExpectedScrollHeightChange) return;

    await locator
        .page()
        .waitForFunction(
            ([element, initialScrollHeight]) => element!.scrollHeight !== initialScrollHeight,
            [await locator.elementHandle(), initialScrollHeight] as const,
        );

    await locator.evaluate(element => {
        const {scrollHeight} = element;
        element.scrollTop = scrollHeight - element.clientHeight;
        return scrollHeight;
    });
}
