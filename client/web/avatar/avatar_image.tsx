import {useMemo} from "react";
import {getAvatarContentType} from "~/shared/avatar/get_avatar_content_type.js";
import {borderRadius as borderRadiusVar} from "~/shared/design/core/border_radius.js";
import {encodeBase64} from "~/shared/helpers/binary/base64.js";

export function AvatarImage({
    content,
    borderRadius,
}: {
    content: Uint8Array;
    borderRadius?: 1 | 1.5 | 2 | 3 | "full";
}) {
    const imageUrl = useMemo(
        () => `data:${getAvatarContentType(content)};base64,${encodeBase64(content)}`,
        [content],
    );

    return (
        <img
            src={imageUrl}
            style={{
                width: "100%",
                height: "100%",
                objectFit: "cover",
                overflow: "hidden",
                borderRadius: borderRadius ? borderRadiusVar[borderRadius] : undefined,
            }}
            aria-hidden="true"
            // Do not render an alt tag as avatars are not important for screen readers
            alt=""
        />
    );
}
