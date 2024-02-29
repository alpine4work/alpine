import {
    At,
    IconContext,
    Link as LinkIcon,
    ListBullets,
    ListNumbers,
    TextBolder,
    TextItalic,
} from "phosphor-react";
import {ReactNode} from "react";
import {mergeProps, useHover, usePress} from "react-aria";
import {Box} from "~/client/design/box.js";
import {nativeMobileBottomBarKeyboardToolbarHeight} from "~/client/design/native_mobile_bottom_bar.js";
import {useStateWithDependencies} from "~/client/helpers/lifecycle/use_state_with_dependencies.js";
import {spacing} from "~/shared/design/spacing.js";

// NOCOMMIT: Is this working on web?

export function MessageInputMobileKeyboardToolbar() {
    return (
        <Box
            height={nativeMobileBottomBarKeyboardToolbarHeight}
            paddingX="0.5"
            display="flex"
            onPointerDownCapture={event => {
                // Tapping on the toolbar shouldn't unfocus the content editor since that will
                // hide the keyboard.
                event.preventDefault();
            }}
        >
            <MessageInputMobileKeyboardToolbarButton
                dividerRight
                label="Mention"
                isActive={false}
                onPress={() => {
                    // NOCOMMIT: Implement
                }}
            >
                <At />
            </MessageInputMobileKeyboardToolbarButton>
            <MessageInputMobileKeyboardToolbarButton
                dividerLeft
                label="Bold"
                isActive={false}
                onPress={() => {
                    // NOCOMMIT: Implement
                }}
            >
                <TextBolder />
            </MessageInputMobileKeyboardToolbarButton>
            <MessageInputMobileKeyboardToolbarButton
                label="Italic"
                isActive={false}
                onPress={() => {
                    // NOCOMMIT: Implement
                }}
            >
                <TextItalic />
            </MessageInputMobileKeyboardToolbarButton>
            <MessageInputMobileKeyboardToolbarButton
                dividerRight
                label="Link"
                isActive={false}
                onPress={() => {
                    // NOCOMMIT: Implement
                }}
            >
                <LinkIcon />
            </MessageInputMobileKeyboardToolbarButton>
            <MessageInputMobileKeyboardToolbarButton
                dividerLeft
                label="Bullet list"
                isActive={false}
                onPress={() => {
                    // NOCOMMIT: Implement
                }}
            >
                <ListBullets />
            </MessageInputMobileKeyboardToolbarButton>
            <MessageInputMobileKeyboardToolbarButton
                dividerLeft
                label="Number list"
                isActive={false}
                onPress={() => {
                    // NOCOMMIT: Implement
                }}
            >
                <ListNumbers />
            </MessageInputMobileKeyboardToolbarButton>
        </Box>
    );
}

function MessageInputMobileKeyboardToolbarButton({
    label,
    children,
    dividerLeft,
    dividerRight,
    isActive,
    isDisabled,
    onPress,
}: {
    label: string;
    children?: ReactNode;
    dividerLeft?: boolean;
    dividerRight?: boolean;
    isActive: boolean;
    isDisabled?: boolean;
    onPress: () => void;
}) {
    const {isHovered, hoverProps} = useHover({});
    const {isPressed, pressProps} = usePress({
        isDisabled,
        onPress,
    });

    const pressAndHoverProps = mergeProps(hoverProps, pressProps);

    // Change this state only when `isPressed` changes. If it becomes active while
    // pressed we don't want to change the color.
    const [isPressedAndActive] = useStateWithDependencies(
        (isPressed: boolean) => isPressed && isActive,
        [isPressed],
    );

    return (
        <>
            {dividerLeft && (
                <Box
                    // We want all space on the toolbar to be touchable so the user doesn't touch
                    // and nothing happens (which can feel like a bug).
                    {...pressAndHoverProps}
                    // In case `pressAndHoverProps` had a `ref`, unset it.
                    ref={null}
                    height="full"
                    width="0.5"
                />
            )}
            <Box
                // None of this is focusable since it's used on mobile where there's no
                // keyboard navigation.
                {...pressAndHoverProps}
                aria-label={label}
                flexGrow="1"
                height="full"
                paddingY="1"
                paddingX="0.5"
                display="flex"
                justifyContent="center"
                alignItems="center"
            >
                <Box
                    width="full"
                    height="full"
                    color={isDisabled ? "grey-30" : isPressed || isActive ? "grey-text" : "grey-70"}
                    backgroundColor={
                        isPressedAndActive
                            ? "grey-20"
                            : isPressed || isActive
                            ? "grey-10"
                            : isHovered
                            ? "grey-5"
                            : undefined
                    }
                    borderRadius="md"
                    display="flex"
                    justifyContent="center"
                    alignItems="center"
                >
                    <IconContext.Provider
                        value={{
                            color: "currentColor",
                            size: spacing["5"],
                        }}
                    >
                        {children}
                    </IconContext.Provider>
                </Box>
            </Box>
            {dividerRight && (
                <Box
                    {...pressAndHoverProps}
                    // In case `pressAndHoverProps` had a `ref`, unset it.
                    ref={null}
                    height="full"
                    width="0.5"
                    paddingY="2"
                >
                    <Box height="full" borderRight="grey-10" />
                </Box>
            )}
        </>
    );
}
