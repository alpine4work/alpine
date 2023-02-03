import classNames from "classnames";
import {Link as LinkIcon, X} from "phosphor-react";
import {Mark} from "prosemirror-model";
import {EditorView} from "prosemirror-view";
import {RefObject, useRef, useState} from "react";
import {useButton, useHover} from "react-aria";
import {Box} from "~/client/design/box";
import {FocusRing} from "~/client/design/focus_ring";
import {Tooltip} from "~/client/design/tooltip";
import {spacing} from "~/shared/design/spacing";
import {assert} from "~/shared/helpers/control/assert";
import {
    darkColorSchemeInputPlaceholderColorConstClassName,
    sprinkles,
} from "~/shared/styles/styles";

export function ContentEditorLinkInput({
    viewRef,
    range,
    mark,
    isDisabled = false,
    onClose,
}: {
    viewRef: RefObject<EditorView | null>;
    range: {from: number; to: number};
    mark: Mark | null;
    isDisabled?: boolean;
    onClose: () => void;
}) {
    const inputRef = useRef<HTMLInputElement>(null);
    const [url, setUrl] = useState<string>(mark?.attrs.url ?? "");

    const save = () => {
        if (url === "") {
            clear();
            return;
        }

        assert(viewRef.current);
        const {state} = viewRef.current;
        const dispatch = viewRef.current.dispatch.bind(viewRef.current);

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
        const dispatch = viewRef.current.dispatch.bind(viewRef.current);

        dispatch(state.tr.removeMark(range.from, range.to, mark));

        onClose();
    };

    return (
        <Box
            display="flex"
            alignItems="center"
            paddingRight="1.5"
            height="8"
            // Give more space in the input for larger URLs. So you can see more of the URL
            // without having to scroll. 64 spacing doesn't show much of long URLs.
            //
            // Maybe the width should grow with the URL length for a bit? Until a
            // max width?
            width={url.length > 40 ? "96" : "64"}
            color="grey-0-const"
            backgroundColor="grey-80-const"
            border={{light: "grey-80-const", dark: "grey-70-const"}}
            borderRadius="sm"
            boxShadow="elevation-20"
            position="relative"
            onKeyDown={event => {
                if (event.key === "Escape") {
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
                    color: "grey-20-const",
                    left: "2",
                    top: "2",
                })}
            />
            <input
                ref={inputRef}
                type="text"
                className={classNames(
                    darkColorSchemeInputPlaceholderColorConstClassName,
                    sprinkles({
                        flex: "1",
                        height: "full",
                        paddingLeft: "8",
                        paddingRight: "1",
                        fontSize: "xs",
                        color: "grey-0-const",
                        backgroundColor: "transparent",
                    }),
                )}
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
            <ContentEditorLinkInputClearButton isDisabled={isDisabled} onPress={() => clear()} />
            <ContentEditorLinkInputSaveButton isDisabled={isDisabled} onPress={() => save()} />
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
                            color: isPressed ? "grey-0-const" : "grey-20-const",
                            backgroundColor: isPressed
                                ? "grey-60-const"
                                : isHovered
                                ? "grey-70-const"
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

    const {buttonProps, isPressed} = useButton({isDisabled, onPress}, buttonRef);
    const {hoverProps, isHovered} = useHover({});

    return (
        <Box {...hoverProps} paddingY="1.5">
            <Box paddingLeft="1" borderLeft="grey-70-const" marginLeft="1">
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
                            color: isPressed ? "grey-0-const" : "grey-20-const",
                            backgroundColor: isPressed
                                ? "grey-60-const"
                                : isHovered
                                ? "grey-70-const"
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
