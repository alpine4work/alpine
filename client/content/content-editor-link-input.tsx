import {Link, X} from "phosphor-react";
import {EditorView} from "prosemirror-view";
import {RefObject, useRef, useState} from "react";
import {useButton, useHover} from "react-aria";
import {Box} from "~/client/design/box";
import {FocusRing} from "~/client/design/focus-ring";
import {sprinkles} from "~/client/design/sprinkles.css";
import {Tooltip} from "~/client/design/tooltip";
import {ContentSchema} from "~/shared/content/content-schema";
import {spacing} from "~/shared/design/spacing";
import {assert} from "~/shared/helpers/control/assert";

export function ContentEditorLinkInput({
    initialUrl = "",
    isDisabled = false,
    onSave: _onSave,
    onClear,
    onClose,
}: {
    initialUrl?: string;
    isDisabled?: boolean;
    onSave: (url: string) => void;
    onClear: () => void;
    onClose: () => void;
}) {
    const inputRef = useRef<HTMLInputElement>(null);

    // TODO(calebmer): Pre-populate state with the URL if it exists in our selection.
    const [url, setUrl] = useState(initialUrl);

    const onSave = () => {
        // If the URL the user typed does not have a protocol then add `https://`.
        const finalUrl = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(url) ? url : `https://${url}`;

        _onSave(finalUrl);
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
                        onSave();
                    }
                }}
            />
            <ContentEditorLinkInputClearButton isDisabled={isDisabled} onPress={() => onClear()} />
            <ContentEditorLinkInputSaveButton isDisabled={isDisabled} onPress={() => onSave()} />
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

export function ContentEditorSelectionLinkInput({
    viewRef,
    isDisabled,
    onClose,
}: {
    viewRef: RefObject<EditorView | null>;
    isDisabled?: boolean;
    onClose: () => void;
}) {
    const save = (url: string) => {
        assert(viewRef.current);
        const {state, dispatch} = viewRef.current;

        // TODO(calebmer): Exclude spaces from the selection when adding a link style?
        // Should we do this for highlights too?
        dispatch(
            state.tr.addMark(
                state.selection.from,
                state.selection.to,
                ContentSchema.mark("link", {url}),
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
        <ContentEditorLinkInput
            isDisabled={isDisabled}
            onSave={save}
            onClear={clear}
            onClose={onClose}
        />
    );
}
