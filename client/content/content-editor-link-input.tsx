import {Link, X} from "phosphor-react";
import {EditorState} from "prosemirror-state";
import {EditorView} from "prosemirror-view";
import {RefObject, useEffect, useRef, useState} from "react";
import {FocusScope, useButton, useHover} from "react-aria";
import {ContentEditorCursorTracker} from "~/client/content/content-editor-cursor-tracker";
import {Box} from "~/client/design/box";
import {FocusRing} from "~/client/design/focus-ring";
import {useOutsidePress} from "~/client/design/helpers/use-outside-press";
import {OverlayRef} from "~/client/design/overlay";
import {OverlayAnimated} from "~/client/design/overlay-animated";
import {overlayFadeAnimationDurationMs} from "~/client/design/overlay-animated.css";
import {sprinkles} from "~/client/design/sprinkles.css";
import {Tooltip} from "~/client/design/tooltip";
import {useConstant} from "~/client/helpers/lifecycle/use-constant";
import {ContentSchema} from "~/shared/content/content-schema";
import {spacing} from "~/shared/design/spacing";
import {assert} from "~/shared/helpers/control/assert";

// TODO(calebmer): Render the selection in the content editor in light grey if
// focus is in the link input. So the user doesn't lose context.

export function ContentEditorLinkInput({
    viewRef,
    isDisabled = false,
    onClose,
}: {
    viewRef: RefObject<EditorView | null>;
    isDisabled?: boolean;
    onClose: () => void;
}) {
    const inputRef = useRef<HTMLInputElement>(null);

    // TODO(calebmer): Pre-populate state with the URL if it exists in our selection.
    const [url, setUrl] = useState("");

    const save = () => {
        assert(viewRef.current);
        const {state, dispatch} = viewRef.current;

        // If the URL the user typed does not have a protocol then add `https://`.
        const finalUrl = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(url) ? url : `https://${url}`;

        // TODO(calebmer): Exclude spaces from the selection when adding a link style?
        // Should we do this for highlights too?
        dispatch(
            state.tr.addMark(
                state.selection.from,
                state.selection.to,
                ContentSchema.mark("link", {url: finalUrl}),
            ),
        );

        onClose();
    };

    const clear = () => {
        // TODO(calebmer): If we are pre-populating state with the URL then it makes
        // sense to clear when the user clicks the X button.

        onClose();
    };

    return (
        <Box
            display="flex"
            alignItems="center"
            paddingRight="1"
            height="8"
            width="64"
            borderRadius="base"
            backgroundColor={{light: "grey-0", dark: "grey-5"}}
            boxShadow="elevation-20"
            position="relative"
            onKeyDown={event => {
                if (event.key === "Escape") {
                    onClose();
                }
            }}
        >
            <Link
                color="currentColor"
                size={spacing["4"]}
                className={sprinkles({
                    pointerEvents: "none",
                    position: "absolute",
                    color: "grey-80",
                    left: "2",
                    top: "2",
                })}
            />
            <input
                ref={inputRef}
                type="text"
                className={sprinkles({
                    flex: 1,
                    height: "full",
                    paddingLeft: "8",
                    font: "sm",
                    color: "grey-100",
                    backgroundColor: "transparent",
                })}
                placeholder="https://example.com"
                disabled={isDisabled}
                value={url}
                onChange={event => setUrl(event.currentTarget.value)}
                onKeyDown={event => {
                    if (event.key === "Enter") {
                        event.preventDefault();
                        save();
                    }
                }}
            />
            <ContentEditorLinkInputClearButton isDisabled={isDisabled} onPress={clear} />
            <ContentEditorLinkInputDoneButton isDisabled={isDisabled} onPress={save} />
        </Box>
    );
}

function ContentEditorLinkInputClearButton({
    isDisabled,
    onPress,
}: {
    isDisabled: boolean;
    onPress: () => void;
}) {
    const buttonRef = useRef<HTMLButtonElement>(null);

    const description = "Clear";

    const {buttonProps, isPressed} = useButton(
        {
            isDisabled,
            "aria-label": description,
            onPress,
        },
        buttonRef,
    );

    const {hoverProps, isHovered} = useHover({});

    return (
        <Tooltip
            placement="top"
            canFlip={false}
            visibleWhenFocusWithin={true}
            content={description}
        >
            <Box {...hoverProps} paddingY="1.5">
                <FocusRing offset="0">
                    <button
                        {...buttonProps}
                        ref={buttonRef}
                        className={sprinkles({
                            display: "flex",
                            justifyContent: "center",
                            alignItems: "center",
                            width: "5",
                            height: "5",
                            borderRadius: "base",
                            color: isPressed ? "grey-100" : "grey-80",
                            backgroundColor: isPressed
                                ? {light: "grey-10", dark: "grey-20"}
                                : isHovered
                                ? {light: "grey-5", dark: "grey-10"}
                                : undefined,
                        })}
                    >
                        <X size={spacing["3"]} />
                    </button>
                </FocusRing>
            </Box>
        </Tooltip>
    );
}

function ContentEditorLinkInputDoneButton({
    isDisabled,
    onPress,
}: {
    isDisabled: boolean;
    onPress: () => void;
}) {
    const buttonRef = useRef<HTMLButtonElement>(null);

    const {buttonProps, isPressed} = useButton({isDisabled, onPress}, buttonRef);
    const {hoverProps, isHovered} = useHover({});

    return (
        <Box {...hoverProps} paddingY="1.5">
            <Box paddingLeft="1" borderLeft={{light: "grey-10", dark: "grey-20"}} marginLeft="1">
                <FocusRing offset="0">
                    <button
                        {...buttonProps}
                        ref={buttonRef}
                        className={sprinkles({
                            display: "flex",
                            justifyContent: "center",
                            alignItems: "center",
                            paddingX: "1.5",
                            height: "5",
                            borderRadius: "base",
                            color: isPressed ? "grey-100" : "grey-80",
                            backgroundColor: isPressed
                                ? {light: "grey-10", dark: "grey-20"}
                                : isHovered
                                ? {light: "grey-5", dark: "grey-10"}
                                : undefined,
                        })}
                    >
                        Done
                    </button>
                </FocusRing>
            </Box>
        </Box>
    );
}

export function ContentEditorLinkToolbar({
    state,
    viewRef,
    onClose: _onClose,
}: {
    state: EditorState;
    viewRef: RefObject<EditorView | null>;
    onClose: () => void;
}) {
    const overlayRef = useRef<OverlayRef>(null);

    const pos = useConstant(state.selection.from);

    const [isClosing, setIsClosing] = useState(false);

    const onClose = () => {
        assert(viewRef.current);
        viewRef.current.focus();
        setIsClosing(true);
    };

    useEffect(() => {
        if (isClosing) {
            const timeoutId = setTimeout(() => {
                _onClose();
            }, overlayFadeAnimationDurationMs);
            return () => {
                clearTimeout(timeoutId);
            };
        }
    }, [isClosing, _onClose]);

    useEffect(() => {
        if (state.selection.from !== pos) {
            onClose();
        }
    });

    return (
        <OverlayAnimated
            ref={overlayRef}
            // We don't animate in because the overlay appears in direct response to a user
            // input (keyboard shortcut). But we do animate out because closing is less
            // intentional.
            //
            // Also it looks a little better to not animate when replacing a possibly
            // existing toolbar.
            visible={!isClosing}
            disableAnimation={!isClosing}
            placement="top-start"
            offset="3"
            offsetAlong="-5"
            canFlip={false}
            overlay={
                <Box ref={useOutsidePress(onClose)}>
                    {isClosing ? (
                        <ContentEditorLinkInput
                            viewRef={viewRef}
                            isDisabled={true}
                            onClose={onClose}
                        />
                    ) : (
                        <FocusScope contain restoreFocus autoFocus>
                            <ContentEditorLinkInput viewRef={viewRef} onClose={onClose} />
                        </FocusScope>
                    )}
                </Box>
            }
        >
            <ContentEditorCursorTracker
                state={state}
                viewRef={viewRef}
                pos={pos}
                onUpdatePosition={() => overlayRef.current?.forceUpdateOverlayPosition()}
            />
        </OverlayAnimated>
    );
}
