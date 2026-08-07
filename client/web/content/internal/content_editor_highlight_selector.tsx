import {Modality, getInteractionModality, setInteractionModality} from "@react-aria/interactions";
import {Mark} from "prosemirror-model";
import {EditorView} from "prosemirror-view";
import {
    Ref,
    RefCallback,
    RefObject,
    forwardRef,
    useCallback,
    useEffect,
    useImperativeHandle,
    useRef,
    useState,
} from "react";
import {mergeProps, useHover, usePress} from "react-aria";
import {Box} from "~/client/web/design/box.js";
import {FocusRing} from "~/client/web/design/focus_ring.js";
import {Tooltip} from "~/client/web/design/tooltip.js";
import {useIsFocusRingVisible} from "~/client/web/design/use_is_focus_ring_visible.js";
import {useStateWithDependenciesWithoutDispatch} from "~/client/web/helpers/lifecycle/use_state_with_dependencies.js";
import {useMergedRefs} from "~/client/web/helpers/refs/use_merged_refs.js";
import {greyElevated2ClassName} from "~/shared/design/core/constant_class_names.js";
import {HighlightColor, colorByHighlightColor} from "~/shared/design/core/highlight_color.js";
import {assert} from "~/shared/helpers/control/assert.open_source.js";
import {trimSpacesFromProsemirrorRange} from "~/shared/prosemirror/trim_spaces_from_prosemirror_range.js";

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
                // Change the interaction modality to keyboard so we see focus rings. Otherwise the
                // user won't know what color they are selecting.
                originalInteractionModalityRef.current ??= getInteractionModality();
                setInteractionModality("keyboard");

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
        const dispatch = viewRef.current.dispatch;

        if (highlightColor && (!mark || mark.attrs.color !== highlightColor)) {
            const range = trimSpacesFromProsemirrorRange(state.doc, state.selection);
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

    const [isFocusWithin, setIsFocusWithin] = useState(false);

    const originalInteractionModalityRef = useRef<Modality | null>(null);

    // When we lose our selection (usually because we unmounted) return the interaction
    // modality to whatever it was before we started keyboard navigating.
    //
    // When this component loses its selection (or unmounts) restore interaction
    // modality to whatever it was before we set it to `keyboard`. While editing, the
    // user may hit Cmd+Shift+H then arrow keys to highlight some text. Only keep them
    // in `keyboard` interaction modality if that's the state they were previously in.
    // Since keyboard navigation within this component is a pretty common pattern even
    // for a user that predominantly uses `pointer` navigation. Showing focus rings for
    // new elements the user focuses (e.g. the link input when the user hits Cmd+K)
    // will likely confuse them since they didn't intend to enter keyboard navigation
    // mode.
    useEffect(() => {
        return () => {
            if (isFocusWithin && originalInteractionModalityRef.current !== null) {
                setInteractionModality(originalInteractionModalityRef.current);
                originalInteractionModalityRef.current = null;
            }
        };
    }, [isFocusWithin]);

    return (
        <Box
            display="flex"
            paddingX="1"
            className={greyElevated2ClassName}
            color="grey-100"
            backgroundColor="grey-0"
            borderRadius="1.5"
            boxShadow="elevation-20"
            role="toolbar"
            aria-label="Highlight color selector"
            aria-orientation="horizontal"
            onFocus={event => setIsFocusWithin(event.currentTarget.contains(event.target))}
            onBlur={event => setIsFocusWithin(event.currentTarget.contains(event.relatedTarget))}
            onKeyDown={event => {
                switch (event.key) {
                    case "ArrowLeft": {
                        event.preventDefault();
                        event.stopPropagation();

                        originalInteractionModalityRef.current ??= getInteractionModality();
                        setInteractionModality("keyboard");

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
                        event.preventDefault();
                        event.stopPropagation();

                        originalInteractionModalityRef.current ??= getInteractionModality();
                        setInteractionModality("keyboard");

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
                        event.preventDefault();
                        event.stopPropagation();

                        originalInteractionModalityRef.current ??= getInteractionModality();
                        setInteractionModality("keyboard");

                        const buttonElement = buttonRefs.current[0];
                        assert(buttonElement);
                        buttonElement.focus();
                        break;
                    }
                    case "End": {
                        event.preventDefault();
                        event.stopPropagation();

                        originalInteractionModalityRef.current ??= getInteractionModality();
                        setInteractionModality("keyboard");

                        const buttonElement = buttonRefs.current[buttonRefs.current.length - 1];
                        assert(buttonElement);
                        buttonElement.focus();
                        break;
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
                buttonRef={useCallback(ref => {
                    buttonRefs.current[0] = ref;
                }, [])}
                wasLastFocused={lastFocusedIndex === 0}
                onFocus={() => setLastFocusedIndex(0)}
            />
            <ContentEditorHighlightSelectorButton
                description="Orange"
                highlightColor={HighlightColor.Orange}
                onSelectHighlightColor={selectHighlightColor}
                mark={mark}
                isFocusable={isFocusable}
                buttonRef={useCallback(ref => {
                    buttonRefs.current[1] = ref;
                }, [])}
                wasLastFocused={lastFocusedIndex === 1}
                onFocus={() => setLastFocusedIndex(1)}
            />
            <ContentEditorHighlightSelectorButton
                description="Green"
                highlightColor={HighlightColor.Green}
                onSelectHighlightColor={selectHighlightColor}
                mark={mark}
                isFocusable={isFocusable}
                buttonRef={useCallback(ref => {
                    buttonRefs.current[2] = ref;
                }, [])}
                wasLastFocused={lastFocusedIndex === 2}
                onFocus={() => setLastFocusedIndex(2)}
            />
            <ContentEditorHighlightSelectorButton
                description="Blue"
                highlightColor={HighlightColor.Blue}
                onSelectHighlightColor={selectHighlightColor}
                mark={mark}
                isFocusable={isFocusable}
                buttonRef={useCallback(ref => {
                    buttonRefs.current[3] = ref;
                }, [])}
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
                buttonRef={useCallback(ref => {
                    buttonRefs.current[4] = ref;
                }, [])}
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
                buttonRef={useCallback(ref => {
                    buttonRefs.current[5] = ref;
                }, [])}
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

    const [isVisible, targetRef] = useIsFocusRingVisible();

    // Change this state only when `isPressed` changes. If it becomes active while
    // pressed we don't want to change the color.
    const isPressedAndActive = useStateWithDependenciesWithoutDispatch(
        ([isPressed]) => isPressed && isActive,
        [isPressed],
    );

    return (
        <Tooltip placement="top" fallbackPlacements={[]} content={description}>
            <Box
                {...mergeProps(hoverProps, pressProps)}
                ref={useMergedRefs<HTMLDivElement>(targetRef, buttonRef)}
                tabIndex={isFocusable ? (wasLastFocused ? 0 : -1) : undefined}
                // y-padding is on the button so the tooltip is appropriately offset from the
                // toolbar.
                paddingY="1"
                onFocus={onFocus}
            >
                <Box
                    // We implement dividers in this funky way so that as the mouse scrubs left and
                    // right over our toolbar the tooltips immediately disappear/reappear because there
                    // is no gap in between the hovered elements.
                    paddingRight={dividerRight ? "1" : "0"}
                    borderRight={dividerRight ? "grey-5" : undefined}
                    paddingLeft={dividerLeft ? "1" : "0"}
                >
                    <FocusRing isVisible={isVisible} offset="border">
                        <Box
                            padding="1"
                            borderRadius="1"
                            backgroundColor={
                                isPressedAndActive
                                    ? "grey-20"
                                    : isPressed || isActive
                                      ? "grey-10"
                                      : isHovered
                                        ? "grey-5"
                                        : undefined
                            }
                        >
                            <Box
                                display="flex"
                                justifyContent="center"
                                alignItems="center"
                                width="4"
                                height="4"
                                borderRadius="0.5"
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
