import {X} from "phosphor-react";
import {useEffect, useId, useRef} from "react";
import {FocusScope} from "react-aria";
import {createPortal} from "react-dom";
import {Box} from "~/client/design/box";
import {Button} from "~/client/design/button";
import {IconButton} from "~/client/design/icon_button";
import {OverlayScopeContextProvider, useOverlayRootPortalElement} from "~/client/design/overlay";
import {assertExists} from "~/shared/helpers/control/assert_exists";
import {contentSchemaStyles, sprinkles} from "~/shared/styles/styles";

/**
 * Present information to the user, blocking their experience, and ask them to
 * make a choice. The user may not interact with content under the modal
 * through mouse, keyboard, or touch.
 *
 * - A dialog is a component with a title, a message, and some action buttons.
 *   It can be rendered as in a popover or modal form factor.
 * - A modal is a view which takes over the entire screen. It renders an
 *   underlay so the user can't interact with content underneath and it
 *   captures focus. It forces the user to interact with the modal.
 *
 * Refer to [Adobe Spectrum][1] content guidelines for writing the message in
 * the modal dialog.
 *
 * [1]: https://spectrum.adobe.com/page/alert-dialog/#Content-standards
 */
export function ModalDialog({
    title,
    description,
    primaryButtonLabel,
    primaryButtonPressErrorTitle,
    onPrimaryButtonPress,
    isPrimaryButtonDestructive,
    onClose,
}: {
    title: string;
    description: string;
    primaryButtonLabel: string;
    primaryButtonPressErrorTitle?: string;
    onPrimaryButtonPress: () => void | Promise<void>;
    isPrimaryButtonDestructive?: boolean;
    onClose: () => void;
}) {
    const portalElement = useOverlayRootPortalElement();
    const titleId = useId();
    const descriptionId = useId();
    const primaryButtonRef = useRef<HTMLButtonElement>(null);

    // Immediately focus the primary button.
    useEffect(() => {
        if (!portalElement) return;

        const primaryButtonElement = assertExists(primaryButtonRef.current);
        primaryButtonElement.focus();
    }, [portalElement]);

    if (!portalElement) return null;

    return createPortal(
        <Box position="fixed" inset="0" display="flex" justifyContent="center" alignItems="center">
            <OverlayScopeContextProvider>
                <Box
                    position="absolute"
                    inset="0"
                    zIndex="-10"
                    backgroundColor="grey-dark"
                    style={{opacity: 0.6}}
                    // If the underlay is clicked, we close the modal. This element is not
                    // focusable or keyboard accessible. You can hit the "Escape" key as a shortcut
                    // to close the modal.
                    onClick={onClose}
                />
                <FocusScope restoreFocus contain>
                    <section
                        role="alertdialog"
                        aria-modal="true"
                        aria-labelledby={titleId}
                        aria-describedby={descriptionId}
                        onKeyDown={event => {
                            if (event.key === "Escape") {
                                event.stopPropagation();
                                event.preventDefault();
                                onClose();
                            }
                        }}
                        className={sprinkles({
                            position: "relative",
                            zIndex: "0",
                            maxWidth: "128",
                            width: "full",
                            padding: "7",
                            paddingBottom: "5",
                            margin: "3",
                            backgroundColor: "grey-0",
                            boxShadow: "elevation-40",
                            borderRadius: "md",
                        })}
                    >
                        <h2
                            id={titleId}
                            className={sprinkles({
                                fontStyle: "semi-bold",
                                fontSize: "300",
                                paddingBottom: "2",
                                // Make sure our heading doesn't collide with the close button.
                                paddingRight: "6",
                                borderBottom: "grey-5",
                                userSelect: "text",
                            })}
                        >
                            {title}
                        </h2>
                        <Box
                            id={descriptionId}
                            userSelect="text"
                            paddingTop="4"
                            paddingBottom="6"
                            style={contentSchemaStyles.paragraphFontSize}
                        >
                            {description}
                        </Box>
                        <Box display="flex" justifyContent="flex-end" gap="2">
                            <Button onPress={onClose}>Cancel</Button>
                            <Button
                                ref={primaryButtonRef}
                                variant={isPrimaryButtonDestructive ? "destructive" : "accent"}
                                pressErrorTitle={primaryButtonPressErrorTitle}
                                onPress={() => {
                                    const promise = onPrimaryButtonPress();
                                    if (promise instanceof Promise) {
                                        return promise.then(onClose, error => {
                                            throw error;
                                        });
                                    } else {
                                        onClose();
                                    }
                                }}
                            >
                                {primaryButtonLabel}
                            </Button>
                        </Box>
                        <Box position="absolute" top="2" right="2">
                            <IconButton
                                size="xs"
                                description="Close"
                                onPress={onClose}
                                withoutTooltip={true}
                            >
                                <X />
                            </IconButton>
                        </Box>
                    </section>
                </FocusScope>
            </OverlayScopeContextProvider>
        </Box>,
        portalElement,
    );
}
