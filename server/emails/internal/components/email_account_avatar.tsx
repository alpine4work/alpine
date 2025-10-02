import {Img, Text} from "@react-email/components";
import {getAccountInitials} from "~/shared/accounts/get_account_initials.js";
import {avatarContentType} from "~/shared/avatar/avatar_constants.js";
import {
    Spacing,
    convertRemLengthToPx,
    parseRemLength,
    spacing,
} from "~/shared/design/core/spacing.js";
import {UnknownError} from "~/shared/error/error.js";
import {encodeBase64} from "~/shared/helpers/binary/base64.js";
import {AccountModelData} from "~/shared/spaces/account_model.js";
import {
    AvatarData,
    AvatarImageData,
    AvatarInitialsData,
    getAvatarData,
} from "~/shared/spaces/get_avatar_data.js";

export function EmailAccountAvatar({
    accountData,
    size = "8",
}: {
    accountData: AccountModelData;
    size?: Spacing;
}) {
    const avatarData = getAvatarData(accountData);
    const avatarSize = spacing[size];
    const containerStyle = {
        width: convertRemLengthToPx(avatarSize, "large"),
        height: convertRemLengthToPx(avatarSize, "large"),
        borderRadius: "50%",
        backgroundColor: avatarData.backgroundColor,
        overflow: "hidden",
        textAlign: "center",
    } as const;

    return (
        <div style={containerStyle}>
            <EmailAccountAvatarInner
                avatarData={avatarData}
                size={size}
                accountData={accountData}
            />
        </div>
    );
}
function EmailAccountAvatarInner({
    avatarData,
    size,
    accountData,
}: {
    avatarData: AvatarData;
    size: Spacing;
    accountData: AccountModelData;
}) {
    const height = convertRemLengthToPx(spacing[size], "large");
    const width = convertRemLengthToPx(spacing[size], "large");

    const {firstInitial, lastInitial} = getAccountInitials(accountData);
    const fontSize = spacing[size];
    const fontSizeRem = parseRemLength(fontSize);
    const scaledFontSizeRem = fontSizeRem / 2.5;
    const scaledFontSizePx = convertRemLengthToPx(`${scaledFontSizeRem}rem`, "large");

    const initialString = `${firstInitial}${lastInitial ?? ""}`;

    switch (avatarData.type) {
        case "Image":
            // This places a fallback EmailAccountAvatarWithInitials underneath the image in the
            // case the image can't be resolved.There will still be a broken image icon if the email
            // client stylesheet adds one, but the fallback makes it look less broken.
            return (
                <>
                    <div style={{maxHeight: "0"}}>
                        <EmailAccountAvatarWithInitials
                            avatarData={avatarData}
                            content={initialString}
                            fontSize={scaledFontSizePx}
                            height={height}
                            width={width}
                        />
                    </div>
                    <div style={{maxHeight: "0", opacity: 0.999}}>
                        <EmailAccountAvatarWithImage
                            height={height}
                            width={width}
                            avatarData={avatarData}
                        />
                    </div>
                </>
            );
        case "Initials":
            return (
                <EmailAccountAvatarWithInitials
                    avatarData={avatarData}
                    content={initialString}
                    fontSize={scaledFontSizePx}
                    height={height}
                    width={width}
                />
            );
        default:
            throw new UnknownError(`Unknown avatar data type: ${(avatarData as any).type}`);
    }
}

function EmailAccountAvatarWithImage({
    width,
    height,
    avatarData,
}: {
    width: number;
    height: number;
    avatarData: AvatarImageData;
}) {
    const imageUrl = `data:${avatarContentType};base64,${encodeBase64(avatarData.content)}`;
    return (
        <div
            style={{
                height: `${height}px`,
                width: `${width}px`,
                backgroundImage: `url(${imageUrl})`,
                backgroundSize: "cover",
                backgroundPosition: "center",
                backgroundRepeat: "no-repeat",
                borderRadius: "50%",
            }}
        >
            <Img
                src={imageUrl}
                style={{
                    height: `${height}px`,
                    width: `${width}px`,
                    objectFit: "cover",
                    borderRadius: "50%",
                    display: "none",
                }}
                aria-hidden="true"
                alt=""
            />
        </div>
    );
}
function EmailAccountAvatarWithInitials({
    avatarData,
    height,
    width,
    fontSize,
    content,
}: {
    avatarData: AvatarInitialsData | AvatarImageData;
    height: number;
    width: number;
    fontSize: number;
    content: string;
}) {
    return (
        <div
            style={{
                height: `${height}px`,
                width: `${width}px`,
            }}
        >
            <Text
                style={{
                    marginTop: "0",
                    marginBottom: "0",
                    fontStyle: "normal",
                    fontSize: `${fontSize}px`,
                    color: avatarData.textColor,
                    lineHeight: `${height}px`,
                }}
            >
                {content}
            </Text>
        </div>
    );
}
