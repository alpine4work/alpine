import {Link, X} from "phosphor-react";
import {EditorView} from "prosemirror-view";
import {Ref, RefObject, forwardRef, useImperativeHandle, useRef, useState} from "react";
import {useButton, useHover} from "react-aria";
import {Box} from "~/client/design/box";
import {FocusRing} from "~/client/design/focus-ring";
import {sprinkles} from "~/client/design/sprinkles.css";
import {Tooltip} from "~/client/design/tooltip";
import {ContentSchema} from "~/shared/content/content-schema";
import {spacing} from "~/shared/design/spacing";
import {assert} from "~/shared/helpers/control/assert";

// TODO(calebmer): Render the selection in the content editor in light grey if
// focus is in the link input. So the user doesn't lose context.

export type ContentEditorLinkInputRef = {
    focus(): void;
};

const ContentEditorLinkInputForwardRef = forwardRef(ContentEditorLinkInput);
export {ContentEditorLinkInputForwardRef as ContentEditorLinkInput};

function ContentEditorLinkInput(
    {
        viewRef,
        onClose,
    }: {
        viewRef: RefObject<EditorView | null>;
        onClose: () => void;
    },
    ref: Ref<ContentEditorLinkInputRef>,
) {
    const inputRef = useRef<HTMLInputElement>(null);

    // TODO(calebmer): Pre-populate state with the URL if it exists in our selection.
    const [url, setUrl] = useState("");

    useImperativeHandle(
        ref,
        () => ({
            focus: () => {
                assert(inputRef.current);
                inputRef.current.focus();
            },
        }),
        [],
    );

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
                value={url}
                onChange={event => setUrl(event.currentTarget.value)}
                onKeyDown={event => {
                    switch (event.key) {
                        case "Escape":
                            onClose();
                            break;
                        case "Enter":
                            save();
                            break;
                    }
                }}
            />
            <ContentEditorLinkInputClearButton onPress={clear} />
            <ContentEditorLinkInputDoneButton onPress={save} />
        </Box>
    );
}

function ContentEditorLinkInputClearButton({onPress}: {onPress: () => void}) {
    const buttonRef = useRef<HTMLButtonElement>(null);

    const description = "Clear";

    const {buttonProps, isPressed} = useButton(
        {
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

function ContentEditorLinkInputDoneButton({onPress}: {onPress: () => void}) {
    const buttonRef = useRef<HTMLButtonElement>(null);

    const {buttonProps, isPressed} = useButton({onPress}, buttonRef);
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
