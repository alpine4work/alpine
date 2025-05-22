import {useRef} from "react";
import {usePress} from "react-aria";
import {Box} from "~/client/design/box.js";
import {FocusRing} from "~/client/design/focus_ring.js";
import {SpaceAvatar} from "~/client/spaces/space_avatar.js";
import {spaceAvatarBorderRadius} from "~/client/styles/space_settings_shared_styles.js";
import {buttonStyles} from "~/client/styles/styles.js";
import {SpaceModel} from "~/shared/spaces/space_model.js";

export function SpaceAvatarUploader({space}: {space: SpaceModel}) {
    const fileInputRef = useRef<HTMLInputElement>(null);

    //TODO: implement the backend for image uploading avatars.
    const triggerFileInput = () => {
        fileInputRef.current?.click();
    };

    const {isPressed, pressProps} = usePress({
        onPress: () => triggerFileInput(),
    });

    return (
        <FocusRing>
            <Box tabIndex={0} borderRadius={spaceAvatarBorderRadius}>
                <input
                    type="file"
                    accept="image/*"
                    ref={fileInputRef}
                    style={{display: "none"}}
                    disabled={false}
                    aria-hidden="true"
                    aria-label="Upload avatar"
                    autoComplete="off"
                />
                <Box position="relative" height="12" width="12" {...pressProps} cursor="pointer">
                    <SpaceAvatar space={space} size="12" />

                    {isPressed && (
                        <Box
                            position="absolute"
                            top="0"
                            left="0"
                            right="0"
                            bottom="0"
                            backgroundColor="grey-100-const"
                            pointerEvents="none"
                            borderRadius={spaceAvatarBorderRadius}
                            style={{opacity: buttonStyles.buttonPressedOverlayOpacity}}
                        />
                    )}
                </Box>
            </Box>
        </FocusRing>
    );
}
