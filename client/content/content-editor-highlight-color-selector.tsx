import {RefCallback, useCallback, useRef, useState} from "react";
import {useHover, usePress} from "react-aria";
import {Box} from "~/client/design/box";
import {FocusRing} from "~/client/design/focus-ring";
import {Tooltip} from "~/client/design/tooltip";
import {HighlightColor, colorByHighlightColor} from "~/shared/content/highlight-color";

/**
 * Selects a color to highlight text with.
 *
 * This component implements the toolbar role:
 * https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Roles/toolbar_role
 */
export function ContentEditorHighlightColorSelector({
    isFocusable,
    onSelectHighlightColor,
}: {
    isFocusable: boolean;
    onSelectHighlightColor: (highlightColor: HighlightColor | null) => void;
}) {
    const buttonRefs = useRef<Array<HTMLDivElement | null>>([]);
    const [lastFocusedIndex, setLastFocusedIndex] = useState(0);

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
                    case "ArrowLeft":
                        event.preventDefault();
                        buttonRefs.current[lastFocusedIndex - 1]?.focus();
                        break;
                    case "ArrowRight":
                        event.preventDefault();
                        buttonRefs.current[lastFocusedIndex + 1]?.focus();
                        break;
                    case "Home":
                        event.preventDefault();
                        buttonRefs.current[0]?.focus();
                        break;
                    case "End":
                        event.preventDefault();
                        buttonRefs.current[buttonRefs.current.length - 1]?.focus();
                        break;
                }
            }}
        >
            <ContentEditorHighlightColorSelectorButton
                description="Red"
                highlightColor={HighlightColor.Red}
                onSelectHighlightColor={onSelectHighlightColor}
                isFocusable={isFocusable}
                buttonRef={useCallback(ref => (buttonRefs.current[0] = ref), [])}
                wasLastFocused={lastFocusedIndex === 0}
                onFocus={() => setLastFocusedIndex(0)}
            />
            <ContentEditorHighlightColorSelectorButton
                description="Orange"
                highlightColor={HighlightColor.Orange}
                onSelectHighlightColor={onSelectHighlightColor}
                isFocusable={isFocusable}
                buttonRef={useCallback(ref => (buttonRefs.current[1] = ref), [])}
                wasLastFocused={lastFocusedIndex === 1}
                onFocus={() => setLastFocusedIndex(1)}
            />
            <ContentEditorHighlightColorSelectorButton
                description="Green"
                highlightColor={HighlightColor.Green}
                onSelectHighlightColor={onSelectHighlightColor}
                isFocusable={isFocusable}
                buttonRef={useCallback(ref => (buttonRefs.current[2] = ref), [])}
                wasLastFocused={lastFocusedIndex === 2}
                onFocus={() => setLastFocusedIndex(2)}
            />
            <ContentEditorHighlightColorSelectorButton
                description="Blue"
                highlightColor={HighlightColor.Blue}
                onSelectHighlightColor={onSelectHighlightColor}
                isFocusable={isFocusable}
                buttonRef={useCallback(ref => (buttonRefs.current[3] = ref), [])}
                wasLastFocused={lastFocusedIndex === 3}
                onFocus={() => setLastFocusedIndex(3)}
            />
            <ContentEditorHighlightColorSelectorButton
                dividerRight
                description="Purple"
                highlightColor={HighlightColor.Purple}
                onSelectHighlightColor={onSelectHighlightColor}
                isFocusable={isFocusable}
                buttonRef={useCallback(ref => (buttonRefs.current[4] = ref), [])}
                wasLastFocused={lastFocusedIndex === 4}
                onFocus={() => setLastFocusedIndex(4)}
            />
            <ContentEditorHighlightColorSelectorButton
                dividerLeft
                description="Clear"
                highlightColor={null}
                onSelectHighlightColor={onSelectHighlightColor}
                isFocusable={isFocusable}
                buttonRef={useCallback(ref => (buttonRefs.current[5] = ref), [])}
                wasLastFocused={lastFocusedIndex === 5}
                onFocus={() => setLastFocusedIndex(5)}
            />
        </Box>
    );
}

function ContentEditorHighlightColorSelectorButton({
    description,
    highlightColor,
    onSelectHighlightColor,
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
                                isPressed
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
                                borderRadius="sm"
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
