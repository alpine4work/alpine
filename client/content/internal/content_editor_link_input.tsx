import {Link as LinkIcon, X} from "phosphor-react";
import {Mark} from "prosemirror-model";
import {EditorView} from "prosemirror-view";
import {RefObject, useEffect, useRef, useState} from "react";
import {useButton, useHover} from "react-aria";
import {Box} from "~/client/design/box.js";
import {FocusRing} from "~/client/design/focus_ring.js";
import {Tooltip} from "~/client/design/tooltip.js";
import {sprinkles} from "~/client/styles/styles.js";
import {greyElevated2ClassName} from "~/shared/design/core/constant_class_names.js";
import {spacing} from "~/shared/design/core/spacing.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";

export function ContentEditorLinkInput({
    viewRef,
    range,
    mark,
    isDisabled = false,
    isReadOnly = false,
    autoFocus,
    onClose,
}: {
    viewRef: RefObject<EditorView | null>;
    range: {from: number; to: number};
    mark: Mark | null;
    isDisabled?: boolean;
    isReadOnly?: boolean;
    autoFocus?: boolean;
    onClose: () => void;
}) {
    const inputRef = useRef<HTMLInputElement>(null);
    const [url, setUrl] = useState<string>(mark?.attrs.url ?? "");

    const hasInitiallyMountedRef = useRef(false);
    useEffect(() => {
        if (hasInitiallyMountedRef.current) return;
        hasInitiallyMountedRef.current = true;
        if (autoFocus) {
            inputRef.current?.focus({preventScroll: true});
        }
    }, [autoFocus]);

    const save = () => {
        if (url === "") {
            clear();
            return;
        }

        assert(viewRef.current);
        const {state} = viewRef.current;
        const dispatch = viewRef.current.dispatch;

        // If the URL the user typed does not have a protocol then add `https://`.
        const finalUrl = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(url) ? url : `https://${url}`;

        // NOTE(calebmer): We don't trim spaces the range here in case the user is
        // updating an existing URL.
        dispatch(
            state.tr.addMark(range.from, range.to, state.schema.mark("link", {url: finalUrl})),
        );

        onClose();
    };

    const clear = () => {
        assert(viewRef.current);
        const {state} = viewRef.current;
        const dispatch = viewRef.current.dispatch;
        const linkMarkType = assertExists(state.doc.type.schema.marks.link);

        dispatch(state.tr.removeMark(range.from, range.to, linkMarkType));

        onClose();
    };

    return (
        <Box
            display="flex"
            alignItems="center"
            paddingRight="1.5"
            height="8"
            className={greyElevated2ClassName}
            color="grey-100"
            backgroundColor="grey-0"
            borderRadius="1.5"
            boxShadow="elevation-20"
            position="relative"
            onKeyDown={event => {
                if (event.key === "Escape") {
                    event.preventDefault();
                    event.stopPropagation();
                    onClose();
                }
            }}
        >
            <LinkIcon
                color="currentColor"
                size={spacing["4"]}
                className={sprinkles({
                    pointerEvents: "none",
                    position: "absolute",
                    color: "grey-70",
                    left: "2",
                    top: "2",
                })}
            />
            <FocusRing offset="border">
                <input
                    ref={inputRef}
                    type="text"
                    className={sprinkles({
                        height: "full",
                        paddingLeft: "8",
                        paddingRight: "1",
                        fontSize: "75",
                        color: "grey-100",
                        backgroundColor: "transparent",
                        borderLeftRadius: "1.5",
                    })}
                    style={{
                        // Give more space in the input for larger URLs. So you can see more of the URL
                        // without having to scroll. 64 spacing doesn't show much of long URLs.
                        //
                        // Maybe the width should grow with the URL length for a bit? Until a
                        // max width?
                        width: url.length > 40 ? "20rem" : "12rem",
                    }}
                    aria-label="URL"
                    placeholder="https://example.com"
                    disabled={isDisabled}
                    readOnly={isReadOnly}
                    value={url}
                    onChange={event => setUrl(event.currentTarget.value)}
                    onKeyDown={event => {
                        if (event.key === "Enter") {
                            event.preventDefault();
                            event.stopPropagation();
                            save();
                        }
                    }}
                />
            </FocusRing>
            {!isReadOnly && (
                <>
                    <ContentEditorLinkInputClearButton
                        isDisabled={isDisabled}
                        onPress={() => clear()}
                    />
                    <ContentEditorLinkInputSaveButton
                        isDisabled={isDisabled}
                        onPress={() => save()}
                    />
                </>
            )}
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
            onKeyDown: event => {
                // `react-spectrum` prevents propagation by default. If
                // `event.preventDefault()` wasn't called, we want the event to propagate. That
                // way `<GlobalKeyDownEvent>` handlers can fire. Most notably our undo cmd-z
                // handler.
                if (!event.defaultPrevented) {
                    event.continuePropagation();
                }
            },
        },
        buttonRef,
    );

    const {hoverProps, isHovered} = useHover({});

    return (
        <Tooltip
            placement="top"
            fallbackPlacements={[]}
            isVisibleWhenFocusWithin={true}
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
                            borderRadius: "1",
                            color: isPressed ? "grey-100" : "grey-70",
                            backgroundColor: isPressed
                                ? "grey-10"
                                : isHovered
                                ? "grey-5"
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

function ContentEditorLinkInputSaveButton({
    isDisabled,
    onPress,
}: {
    isDisabled: boolean;
    onPress: () => void;
}) {
    const buttonRef = useRef<HTMLButtonElement>(null);

    const {buttonProps, isPressed} = useButton(
        {
            isDisabled,
            onPress,
            onKeyDown: event => {
                // `react-spectrum` prevents propagation by default. If
                // `event.preventDefault()` wasn't called, we want the event to propagate. That
                // way `<GlobalKeyDownEvent>` handlers can fire. Most notably our undo cmd-z
                // handler.
                if (!event.defaultPrevented) {
                    event.continuePropagation();
                }
            },
        },
        buttonRef,
    );
    const {hoverProps, isHovered} = useHover({});

    return (
        <Box {...hoverProps} paddingY="1.5">
            <Box paddingLeft="1" borderLeft="grey-5" marginLeft="1">
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
                            borderRadius: "1",
                            color: isPressed ? "grey-100" : "grey-70",
                            backgroundColor: isPressed
                                ? "grey-10"
                                : isHovered
                                ? "grey-5"
                                : undefined,
                        })}
                    >
                        Save
                    </button>
                </FocusRing>
            </Box>
        </Box>
    );
}
