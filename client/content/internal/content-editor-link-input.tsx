import {Link, X} from "phosphor-react";
import {Mark} from "prosemirror-model";
import {EditorView} from "prosemirror-view";
import {RefObject, useRef, useState} from "react";
import {useButton, useHover} from "react-aria";
import {Box} from "~/client/design/box";
import {FocusRing} from "~/client/design/focus-ring";
import {sprinkles} from "~/client/design/sprinkles.css";
import {Tooltip} from "~/client/design/tooltip";
import {spacing} from "~/shared/design/spacing";
import {assert} from "~/shared/helpers/control/assert";

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
                    paddingRight: "1",
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
                        Save
                    </button>
                </FocusRing>
            </Box>
        </Box>
    );
}
