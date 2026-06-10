import {getInteractionModality, setInteractionModality} from "@react-aria/interactions";
import {SpinnerGap} from "phosphor-react";
import {useRef, useState} from "react";
import {usePress} from "react-aria";
import {Box} from "~/client/web/design/box.js";
import {FocusRing} from "~/client/web/design/focus_ring.js";
import {useReporter} from "~/client/web/design/reporter.js";
import {useDelayLoadingIndicator} from "~/client/web/design/use_delay_loading_indicator.js";
import {buttonStyles, spinAnimationClassName} from "~/client/web/styles/styles.js";
import {maxAvatarUploadContentLength} from "~/shared/avatar/avatar_constants.js";
import {BorderRadius} from "~/shared/design/core/border_radius.js";
import {spacing} from "~/shared/design/core/spacing.js";
import {ErrorBase, InvalidArgumentError} from "~/shared/error/error.js";
import {errorDisplayMessage} from "~/shared/error/error_display_message.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";

// TODO(calebmer): Avatars look bad in settings! If the avatar size is greater than
// 8 we should try using the larger image available in Cloudflare R2 instead. Maybe
// we start with the blurred scaled up image and transition once we have the larger
// image.
export const avatarUploaderSize = "12";

export function AvatarUploader({
    borderRadius,
    children,
    onUploadAvatar,
}: {
    borderRadius?: BorderRadius;
    children: React.ReactNode;
    onUploadAvatar: (file: File) => Promise<void>;
}) {
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [isUploading, setIsUploading] = useState(false);

    const reporter = useReporter();
    const shouldShowLoadingIndicator = useDelayLoadingIndicator(isUploading);

    const triggerFileInput = () => {
        const fileInputElement = assertExists(fileInputRef.current);

        const interactionModality = getInteractionModality();

        // If the user presses "cancel" to close the file input, Chrome moves focus to the
        // last focused element. So make sure to focus the file input before `click()`ing
        // so Chrome considers the file input as the last focused element.
        fileInputElement.focus();

        fileInputElement.click();

        // Calling `click()` will change `interactionModality` to `virtual` which will
        // render a focus ring. Make sure we reset to the same interaction modality that
        // was used before the `click()` call.
        setInteractionModality(interactionModality);
    };

    const {isPressed, pressProps} = usePress({
        onPress: () => triggerFileInput(),
    });

    const displayError = (error: ErrorBase) => {
        reporter.displayError("Unable to upload avatar", error);
    };

    return (
        <FocusRing isVisibleWhenFocusWithin>
            <Box position="relative" borderRadius={borderRadius}>
                <input
                    type="file"
                    accept="image/*"
                    ref={fileInputRef}
                    style={{
                        // Hide the input so it's not visible but it still exists in the DOM. This is the
                        // element that will receive focus for the avatar uploader.
                        position: "fixed",
                        width: 0,
                        height: 0,
                        margin: 0,
                        padding: 0,
                        border: 0,
                        opacity: 0,
                        top: 0,
                    }}
                    disabled={isUploading}
                    aria-label="Upload avatar"
                    autoComplete="off"
                    onChange={event => {
                        if (isUploading) return;

                        const file = event.target.files?.[0];
                        if (file && onUploadAvatar) {
                            if (file.size > maxAvatarUploadContentLength) {
                                displayError(
                                    new InvalidArgumentError("File size must be less than 4MB", {
                                        displayMessage: errorDisplayMessage`File size must be less than 4MB`,
                                    }),
                                );
                                return;
                            }

                            setIsUploading(true);
                            onUploadAvatar(file)
                                .catch(error => {
                                    displayError(error);
                                })
                                .finally(() => setIsUploading(false));
                        }
                    }}
                />
                <Box
                    position="relative"
                    height={avatarUploaderSize}
                    width={avatarUploaderSize}
                    {...pressProps}
                    cursor="pointer"
                >
                    {children}

                    {isPressed && (
                        <Box
                            position="absolute"
                            top="0"
                            left="0"
                            right="0"
                            bottom="0"
                            backgroundColor="grey-100-const"
                            pointerEvents="none"
                            borderRadius={borderRadius}
                            style={{opacity: buttonStyles.buttonPressedOverlayOpacity}}
                        />
                    )}

                    {shouldShowLoadingIndicator && (
                        <Box
                            position="absolute"
                            top="0"
                            left="0"
                            right="0"
                            bottom="0"
                            color="grey-0-const"
                            backgroundColor="grey-100-const"
                            borderRadius={borderRadius}
                            style={{opacity: 0.8}}
                            display="flex"
                            alignItems="center"
                            justifyContent="center"
                        >
                            <SpinnerGap className={spinAnimationClassName} size={spacing[4]} />
                        </Box>
                    )}
                </Box>
            </Box>
        </FocusRing>
    );
}
