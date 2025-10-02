import {SpinnerGap} from "phosphor-react";
import {useRef, useState} from "react";
import {usePress} from "react-aria";
import {Box} from "~/client/design/box.js";
import {FocusRing} from "~/client/design/focus_ring.js";
import {useReporter} from "~/client/design/reporter.js";
import {useDelayLoadingIndicator} from "~/client/design/use_delay_loading_indicator.js";
import {buttonStyles, spinAnimationClassName} from "~/client/styles/styles.js";
import {maxAvatarUploadContentLength} from "~/shared/avatar/avatar_constants.js";
import {BorderRadius} from "~/shared/design/core/border_radius.js";
import {ErrorBase, InvalidArgumentError} from "~/shared/error/error.js";
import {errorDisplayMessage} from "~/shared/error/error_display_message.js";

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
        fileInputRef.current?.click();
    };

    const {isPressed, pressProps} = usePress({
        onPress: () => triggerFileInput(),
    });

    const displayError = (error: ErrorBase) => {
        reporter.displayError("Unable to upload avatar", error);
    };

    return (
        <FocusRing>
            <Box tabIndex={0} borderRadius={borderRadius}>
                <input
                    type="file"
                    accept="image/*"
                    ref={fileInputRef}
                    style={{display: "none"}}
                    disabled={isUploading}
                    aria-hidden="true"
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
                <Box position="relative" height="12" width="12" {...pressProps} cursor="pointer">
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
                            backgroundColor="grey-100-const"
                            borderRadius={borderRadius}
                            style={{opacity: 0.8}}
                            display="flex"
                            alignItems="center"
                            justifyContent="center"
                        >
                            <SpinnerGap className={spinAnimationClassName} size={12} />
                        </Box>
                    )}
                </Box>
            </Box>
        </FocusRing>
    );
}
