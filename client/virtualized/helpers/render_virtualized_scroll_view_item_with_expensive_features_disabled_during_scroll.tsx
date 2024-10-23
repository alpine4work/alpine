import {ReactElement, Ref, useMemo, useState} from "react";
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
    // eslint-disable-next-line react/display-name
    return props => (
        <VirtualizedScrollViewItemWithExpensiveFeaturesDisabledDuringScroll
            props={props}
            render={render}
        />
    );
}

// eslint-disable-next-line react-refresh/only-export-components
function VirtualizedScrollViewItemWithExpensiveFeaturesDisabledDuringScroll({
    props: {ref, offset, minHeight, shouldRenderWithRelativePositioning, isScrolling},
    render,
}: {
    props: VirtualizedScrollViewStateRenderItemProps & {
        ref: Ref<HTMLDivElement>;
        shouldRenderWithRelativePositioning: boolean;
        isScrolling: boolean;
    };
    render: (disableExpensiveFeaturesDuringScroll: boolean) => ReactElement;
}) {
    const [_disableExpensiveFeaturesDuringScroll, setDisableExpensiveFeaturesDuringScroll] =
        useState(isScrolling);
    let disableExpensiveFeaturesDuringScroll = _disableExpensiveFeaturesDuringScroll;

    if (!isScrolling && disableExpensiveFeaturesDuringScroll) {
        setDisableExpensiveFeaturesDuringScroll(false);
        disableExpensiveFeaturesDuringScroll = false;
    }

    const element = useMemo(
        () => render(disableExpensiveFeaturesDuringScroll),
        [disableExpensiveFeaturesDuringScroll, render],
    );

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
}
