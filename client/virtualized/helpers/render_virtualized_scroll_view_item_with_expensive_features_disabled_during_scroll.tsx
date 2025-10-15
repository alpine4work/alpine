import {ReactElement, Ref, useMemo, useState} from "react";
import {VirtualizedScrollViewStateRenderItemProps} from "~/client/virtualized/virtualized_scroll_view_state.js";

type VirtualizedScrollViewItemWithExpensiveFeaturesDisabledDuringScrollRenderProps = {
    render: (disableExpensiveFeaturesDuringScroll: boolean) => ReactElement;
    containerStyle?: React.CSSProperties;
};

/**
 * Helper for rendering items in a `<VirtualizedScrollView>` that have some
 * expensive features disabled while scrolling to improve scroll performance.
 * Should be used with `withManualLayout`.
 */
export function renderVirtualizedScrollViewItemWithExpensiveFeaturesDisabledDuringScroll({
    render,
    containerStyle,
}: VirtualizedScrollViewItemWithExpensiveFeaturesDisabledDuringScrollRenderProps): (
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
            containerStyle={containerStyle}
        />
    );
}

// eslint-disable-next-line react-refresh/only-export-components
function VirtualizedScrollViewItemWithExpensiveFeaturesDisabledDuringScroll({
    props: {ref, offset, minHeight, zIndex, shouldRenderWithRelativePositioning, isScrolling},
    render,
    containerStyle,
}: VirtualizedScrollViewItemWithExpensiveFeaturesDisabledDuringScrollRenderProps & {
    props: VirtualizedScrollViewStateRenderItemProps & {
        ref: Ref<HTMLDivElement>;
        shouldRenderWithRelativePositioning: boolean;
        isScrolling: boolean;
    };
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
                zIndex,
                ...(shouldRenderWithRelativePositioning
                    ? {position: "relative"}
                    : {
                          position: "absolute",
                          top: offset,
                          left: 0,
                          right: 0,
                      }),
                ...containerStyle,
            }}
        >
            {element}
        </div>
    );
}
