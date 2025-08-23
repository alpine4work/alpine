import {useMemo} from "react";
import {avatarContentType} from "~/shared/avatar/avatar_constants.js";
import {encodeBase64} from "~/shared/helpers/binary/base64.js";

export function AvatarImage({content}: {content: Uint8Array}) {
    const imageUrl = useMemo(
        () => `data:${avatarContentType};base64,${encodeBase64(content)}`,
        [content],
    );

    return (
        <img
            src={imageUrl}
            style={{
                width: "100%",
                height: "100%",
                objectFit: "cover",
            }}
            aria-hidden="true"
            // Do not render an alt tag as avatars are not important for screen readers
            alt=""
        />
    );
}
