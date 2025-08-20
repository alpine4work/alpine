import {SpinnerGap} from "phosphor-react";
import {useRef, useState} from "react";
import {usePress} from "react-aria";
import {Box} from "~/client/design/box.js";
import {ErrorBodyRenderer} from "~/client/design/error_body_renderer.js";
import {ErrorIcon} from "~/client/design/error_icon.js";
import {FocusRing} from "~/client/design/focus_ring.js";
import {ModalWithButtons} from "~/client/design/modal_with_buttons.js";
import {BorderRadius, buttonStyles, spinAnimationClassName} from "~/client/styles/styles.js";
import {maxAvatarUploadContentLength} from "~/shared/avatar/avatar_constants.js";
import {ErrorBase, InvalidArgumentError} from "~/shared/error/error.js";
import {errorDisplayMessage} from "~/shared/error/error_display_message.js";

export function AvatarUploader({
    borderRadius,
    children,
    onUploadAvatar,
}: {
    borderRadius?: BorderRadius;
    children: React.ReactNode;
    // TODO(#add-space-avatar-support)
    onUploadAvatar?: (file: File) => Promise<void>;
}) {
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [isUploading, setIsUploading] = useState(false);
    const [error, setError] = useState<ErrorBase | null>(null);

    const triggerFileInput = () => {
        fileInputRef.current?.click();
    };

    const {isPressed, pressProps} = usePress({
        onPress: () => triggerFileInput(),
    });

    return (
        <>
            {error && (
                <AvatarUploadErrorModal
                    isOpen={!!error}
                    error={error}
                    onClose={() => {
                        setError(null);
                    }}
                />
            )}
            <FocusRing>
                <Box tabIndex={0} borderRadius={borderRadius}>
                    <input
                        type="file"
                        accept="image/*"
                        ref={fileInputRef}
                        style={{display: "none"}}
                        disabled={false}
                        aria-hidden="true"
                        aria-label="Upload avatar"
                        autoComplete="off"
                        onChange={event => {
                            const file = event.target.files?.[0];
                            if (file && onUploadAvatar) {
                                if (file.size > maxAvatarUploadContentLength) {
                                    setError(
                                        new InvalidArgumentError(
                                            "File size must be less than 4MB",
                                            {
                                                displayMessage: errorDisplayMessage`File size must be less than 4MB`,
                                            },
                                        ),
                                    );
                                    return;
                                }

                                setIsUploading(true);
                                onUploadAvatar(file)
                                    .catch(error => {
                                        setError(error);
                                    })
                                    .finally(() => setIsUploading(false));
                            }
                        }}
                    />
                    <Box
                        position="relative"
                        height="12"
                        width="12"
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

                        {isUploading && (
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
        </>
    );
}

function AvatarUploadErrorModal({
    isOpen,
    error,
    onClose,
}: {
    isOpen: boolean;
    error: unknown;
    onClose: () => void;
}) {
    const modalId = "error-modal";

    return isOpen ? (
        <ModalWithButtons
            aria-labelledby={`${modalId}-title`}
            primaryButtonLabel="OK"
            onPrimaryButtonPress={onClose}
            shouldHideCancelButton={true}
            onClose={onClose}
        >
            <Box padding="5">
                <ErrorBodyRenderer
                    icon={<ErrorIcon />}
                    title="Unable to upload avatar"
                    error={error}
                />
            </Box>
        </ModalWithButtons>
    ) : null;
}
