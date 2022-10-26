import {Mark} from "prosemirror-model";
import {EditorView} from "prosemirror-view";
import {
    Ref,
    RefCallback,
    RefObject,
    forwardRef,
    useCallback,
    useImperativeHandle,
    useRef,
    useState,
} from "react";
import {useHover, usePress} from "react-aria";
import {trimSpacesFromRange} from "~/client/content/internal/content-editor-prosemirror-helpers";
import {Box} from "~/client/design/box";
import {FocusRing} from "~/client/design/focus-ring";
import {Tooltip} from "~/client/design/tooltip";
import {HighlightColor, colorByHighlightColor} from "~/shared/content/highlight-color";
import {assert} from "~/shared/helpers/control/assert";

export type ContentEditorHighlightSelectorRef = {
    focus(options?: FocusOptions): void;
};

/**
 * Selects a color to highlight text with.
 *
 * This component implements the toolbar role:
 * https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Roles/toolbar_role
 */
export const ContentEditorHighlightSelector = forwardRef(function ContentEditorHighlightSelector(
    {
        viewRef,
        mark,
        isFocusable,
        onClose,
    }: {
        viewRef: RefObject<EditorView | null>;
        mark: Mark | null;
        isFocusable: boolean;
        onClose: () => void;
    },
    ref: Ref<ContentEditorHighlightSelectorRef>,
) {
    const buttonRefs = useRef<Array<HTMLDivElement | null>>([]);
    const [lastFocusedIndex, setLastFocusedIndex] = useState(0);

    useImperativeHandle(
        ref,
        () => ({
            focus: options => {
                const buttonElement = buttonRefs.current[lastFocusedIndex];
                assert(buttonElement);
                buttonElement.focus(options);
            },
        }),
        [lastFocusedIndex],
    );

    const selectHighlightColor = (highlightColor: HighlightColor | null) => {
        assert(viewRef.current);
        const {state} = viewRef.current;
        const dispatch = viewRef.current.dispatch.bind(viewRef.current);

        if (highlightColor && (!mark || mark.attrs.color !== highlightColor)) {
            const range = trimSpacesFromRange(state.doc, state.selection);
            dispatch(
                state.tr.addMark(
                    range.from,
                    range.to,
                    state.schema.mark("highlight", {
                        color: highlightColor,
                    }),
                ),
            );
        } else {
            dispatch(
                state.tr.removeMark(
                    state.selection.from,
                    state.selection.to,
                    state.schema.marks.highlight,
                ),
            );
        }

        onClose();
    };

    return (
        <Box
            display="flex"
            paddingX="1"
            borderRadius="base"
            backgroundColor={{light: "grey-0", dark: "grey-5"}}
            boxShadow="elevation-20"
            role="toolbar"
            aria-label="Highlight color selector"
            aria-orientation="horizontal"
            onKeyDown={event => {
                switch (event.key) {
                    case "ArrowLeft": {
                        event.preventDefault();
                        const buttonElement =
                            buttonRefs.current[
                                lastFocusedIndex !== 0
                                    ? lastFocusedIndex - 1
                                    : buttonRefs.current.length - 1
                            ];
                        assert(buttonElement);
                        buttonElement.focus();
                        break;
                    }
                    case "ArrowRight": {
                        const buttonElement =
                            buttonRefs.current[
                                lastFocusedIndex !== buttonRefs.current.length - 1
                                    ? lastFocusedIndex + 1
                                    : 0
                            ];
                        assert(buttonElement);
                        buttonElement.focus();
                        break;
                    }
                    case "Home": {
                        const buttonElement = buttonRefs.current[0];
                        assert(buttonElement);
                        buttonElement.focus();
                        break;
                    }
                    case "End": {
                        const buttonElement = buttonRefs.current[buttonRefs.current.length - 1];
                        assert(buttonElement);
                        buttonElement.focus();
                    }
                }
            }}
        >
            <ContentEditorHighlightSelectorButton
                description="Red"
                highlightColor={HighlightColor.Red}
                onSelectHighlightColor={selectHighlightColor}
                mark={mark}
                isFocusable={isFocusable}
                buttonRef={useCallback(ref => (buttonRefs.current[0] = ref), [])}
                wasLastFocused={lastFocusedIndex === 0}
                onFocus={() => setLastFocusedIndex(0)}
            />
            <ContentEditorHighlightSelectorButton
                description="Orange"
                highlightColor={HighlightColor.Orange}
                onSelectHighlightColor={selectHighlightColor}
                mark={mark}
                isFocusable={isFocusable}
                buttonRef={useCallback(ref => (buttonRefs.current[1] = ref), [])}
                wasLastFocused={lastFocusedIndex === 1}
                onFocus={() => setLastFocusedIndex(1)}
            />
            <ContentEditorHighlightSelectorButton
                description="Green"
                highlightColor={HighlightColor.Green}
                onSelectHighlightColor={selectHighlightColor}
                mark={mark}
                isFocusable={isFocusable}
                buttonRef={useCallback(ref => (buttonRefs.current[2] = ref), [])}
                wasLastFocused={lastFocusedIndex === 2}
                onFocus={() => setLastFocusedIndex(2)}
            />
            <ContentEditorHighlightSelectorButton
                description="Blue"
                highlightColor={HighlightColor.Blue}
                onSelectHighlightColor={selectHighlightColor}
                mark={mark}
                isFocusable={isFocusable}
                buttonRef={useCallback(ref => (buttonRefs.current[3] = ref), [])}
                wasLastFocused={lastFocusedIndex === 3}
                onFocus={() => setLastFocusedIndex(3)}
            />
            <ContentEditorHighlightSelectorButton
                dividerRight
                description="Purple"
                highlightColor={HighlightColor.Purple}
                onSelectHighlightColor={selectHighlightColor}
                mark={mark}
                isFocusable={isFocusable}
                buttonRef={useCallback(ref => (buttonRefs.current[4] = ref), [])}
                wasLastFocused={lastFocusedIndex === 4}
                onFocus={() => setLastFocusedIndex(4)}
            />
            <ContentEditorHighlightSelectorButton
                dividerLeft
                description="Clear"
                highlightColor={null}
                onSelectHighlightColor={selectHighlightColor}
                mark={mark}
                isFocusable={isFocusable}
                buttonRef={useCallback(ref => (buttonRefs.current[5] = ref), [])}
                wasLastFocused={lastFocusedIndex === 5}
                onFocus={() => setLastFocusedIndex(5)}
            />
        </Box>
    );
});

function ContentEditorHighlightSelectorButton({
    description,
    highlightColor,
    onSelectHighlightColor,
    mark,
    isFocusable,
    buttonRef,
    wasLastFocused,
    onFocus,
    dividerLeft,
    dividerRight,
}: {
    description: string;
    highlightColor: HighlightColor | null;
    onSelectHighlightColor: (highlightColor: HighlightColor | null) => void;
    mark: Mark | null;
    isFocusable: boolean;
    buttonRef: RefCallback<HTMLDivElement>;
    wasLastFocused: boolean;
    onFocus: () => void;
    dividerLeft?: boolean;
    dividerRight?: boolean;
}) {
    const {hoverProps, isHovered} = useHover({});

    const {pressProps, isPressed} = usePress({
        onPress: () => onSelectHighlightColor(highlightColor),
    });

    const isActive = highlightColor !== null && mark?.attrs.color === highlightColor;

    return (
        <Tooltip
            placement="top"
            // Don't allow flipping the tooltip down into selection content. Since we
            // position the color selector on top of selected content.
            canFlip={false}
            // The hover bounding box for our button is larger than the button itself so
            // we want to show the tooltip when a child is focused.
            visibleWhenFocusWithin={true}
            content={description}
        >
            <Box
                {...hoverProps}
                // y-padding is on the button so the tooltip is appropriately
                // offset from the toolbar.
                paddingY="1"
            >
                <Box
                    // We implement dividers in this funky way so that as the mouse scrubs left and
                    // right over our toolbar the tooltips immediately disappear/reappear because
                    // there is no gap in between the hovered elements.
                    paddingRight={dividerRight ? "1" : "0"}
                    borderRight={dividerRight ? {light: "grey-10", dark: "grey-20"} : undefined}
                    paddingLeft={dividerLeft ? "1" : "0"}
                >
                    <FocusRing offset="0">
                        <Box
                            {...pressProps}
                            ref={buttonRef}
                            padding="1"
                            borderRadius="base"
                            backgroundColor={
                                isPressed || isActive
                                    ? {light: "grey-10", dark: "grey-20"}
                                    : isHovered
                                    ? {light: "grey-5", dark: "grey-10"}
                                    : undefined
                            }
                            tabIndex={isFocusable ? (wasLastFocused ? 0 : -1) : undefined}
                            onFocus={onFocus}
                        >
                            <Box
                                display="flex"
                                justifyContent="center"
                                alignItems="center"
                                width="4"
                                height="4"
                                borderRadius="small"
                                color="grey-100"
                                backgroundColor={
                                    highlightColor
                                        ? colorByHighlightColor[highlightColor]
                                        : undefined
                                }
                            >
                                A
                            </Box>
                        </Box>
                    </FocusRing>
                </Box>
            </Box>
        </Tooltip>
    );
}
