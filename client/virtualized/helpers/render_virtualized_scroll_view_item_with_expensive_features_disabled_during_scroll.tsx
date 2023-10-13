import {ReactElement, Ref} from "react";
import {VirtualizedScrollViewStateRenderItemProps} from "~/client/virtualized/virtualized_scroll_view_state.js";

/**
 * Helper for rendering items in a `<VirtualizedScrollView>` that have some
 * expensive features disabled while scrolling to improve scroll performance.
 * Should be used with `withManualLayout`.
 */
export function renderVirtualizedScrollViewItemWithExpensiveFeaturesDisabledDuringScroll(
    render: (disableExpensiveFeaturesDuringScroll: boolean) => ReactElement,
): (
    props: VirtualizedScrollViewStateRenderItemProps & {
        ref: Ref<HTMLDivElement>;
        shouldRenderWithRelativePositioning: boolean;
        isScrolling: boolean;
    },
) => ReactElement {
    // It's important to reuse nodes across renders because so React won't try to
    // re-render the component.
    let elementWithExpensiveFeaturesDisabled: ReactElement | null = null;
    let elementWithoutExpensiveFeaturesDisabled: ReactElement | null = null;

    // eslint-disable-next-line react/display-name
    return ({
        ref,
        offset,
        minHeight,
        shouldRenderWithRelativePositioning,
        isScrolling,
        wasPreviouslyInRenderedRange,
    }) => {
        let element;

        // If we previously rendered this item without expensive features disabled and
        // now we're reintroducing it to the rendered range while scrolling, we want to
        // render WITH expensive features disabled until we stop scrolling.
        if (!wasPreviouslyInRenderedRange && isScrolling)
            elementWithoutExpensiveFeaturesDisabled = null;

        // If we already rendered the node without expensive features disabled, don't
        // render a new version since that will cause a frame drop right at the start
        // of the scroll as React re-renders every message.
        if (elementWithoutExpensiveFeaturesDisabled !== null) {
            element = elementWithoutExpensiveFeaturesDisabled;
        } else if (isScrolling) {
            elementWithExpensiveFeaturesDisabled ??= render(true);
            element = elementWithExpensiveFeaturesDisabled;
        } else {
            elementWithoutExpensiveFeaturesDisabled ??= render(false);
            element = elementWithoutExpensiveFeaturesDisabled;
        }

        return (
            <div
                ref={ref}
                style={{
                    minHeight,
                    ...(shouldRenderWithRelativePositioning
                        ? {position: "relative"}
                        : {
                              position: "absolute",
                              top: offset,
                              left: 0,
                              right: 0,
                          }),
                }}
            >
                {element}
            </div>
        );
    };
}
