import {Img, Text} from "@react-email/components";
import {getAccountInitials} from "~/shared/accounts/get_account_initials.js";
import {avatarContentType} from "~/shared/avatar/avatar_constants.js";
import {colors} from "~/shared/design/core/colors.js";
import {
    Spacing,
    convertRemLengthToPx,
    parseRemLength,
    spacing,
} from "~/shared/design/core/spacing.js";
import {encodeBase64} from "~/shared/helpers/binary/base64.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {AccountModelData} from "~/shared/spaces/account_model.js";
import {
    AccountAvatarDesign,
    AccountDefaultAvatarDesign,
    AccountImageAvatarDesign,
    getAccountAvatarDesign,
    getAccountFallbackDefaultAvatarDesign,
} from "~/shared/spaces/get_account_avatar_design.js";

export function EmailAccountAvatar({
    accountData,
    size = "8",
}: {
    accountData: AccountModelData;
    size?: Spacing;
}) {
    const avatarDesign = getAccountAvatarDesign(accountData);
    const avatarSize = spacing[size];

    const containerStyle = {
        width: convertRemLengthToPx(avatarSize, "large"),
        height: convertRemLengthToPx(avatarSize, "large"),
        borderRadius: "50%",
        overflow: "hidden",
        textAlign: "center",
    } as const;

    return (
        <div style={containerStyle}>
            <EmailAccountAvatarInner
                avatarDesign={avatarDesign}
                size={size}
                accountData={accountData}
            />
        </div>
    );
}
function EmailAccountAvatarInner({
    avatarDesign,
    size,
    accountData,
}: {
    avatarDesign: AccountAvatarDesign;
    size: Spacing;
    accountData: AccountModelData;
}) {
    const height = convertRemLengthToPx(spacing[size], "large");
    const width = convertRemLengthToPx(spacing[size], "large");

    const {firstInitial, lastInitial} = getAccountInitials(accountData);
    const fontSize = spacing[size];
    const fontSizeRem = parseRemLength(fontSize);
    const scaledFontSizeRem = fontSizeRem / 2.75;
    const scaledFontSizePx = convertRemLengthToPx(`${scaledFontSizeRem}rem`, "large");

    const initials = `${firstInitial}${lastInitial ?? ""}`;

    switch (avatarDesign.type) {
        case "Image": {
            // This places a fallback EmailAccountAvatarWithInitials underneath the image in the
            // case the image can't be resolved.There will still be a broken image icon if the email
            // client stylesheet adds one, but the fallback makes it look less broken.
            return (
                <>
                    <div style={{maxHeight: "0"}}>
                        <EmailAccountAvatarWithInitials
                            avatarDesign={getAccountFallbackDefaultAvatarDesign(accountData)}
                            initials={initials}
                            fontSize={scaledFontSizePx}
                            height={height}
                            width={width}
                        />
                    </div>
                    <div style={{maxHeight: "0", opacity: 0.999}}>
                        <EmailAccountAvatarWithImage
                            height={height}
                            width={width}
                            avatarDesign={avatarDesign}
                        />
                    </div>
                </>
            );
        }
        case "Default": {
            return (
                <EmailAccountAvatarWithInitials
                    avatarDesign={avatarDesign}
                    initials={initials}
                    fontSize={scaledFontSizePx}
                    height={height}
                    width={width}
                />
            );
        }
        default:
            throw exhaustive(avatarDesign);
    }
}

function EmailAccountAvatarWithImage({
    width,
    height,
    avatarDesign,
}: {
    width: number;
    height: number;
    avatarDesign: AccountImageAvatarDesign;
}) {
    const imageUrl = `data:${avatarContentType};base64,${encodeBase64(avatarDesign.content)}`;
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
    avatarDesign,
    height,
    width,
    fontSize,
    initials,
}: {
    avatarDesign: AccountDefaultAvatarDesign;
    height: number;
    width: number;
    fontSize: number;
    initials: string;
}) {
    return (
        <div
            style={{
                height: `${height}px`,
                width: `${width}px`,
                backgroundColor: colors[`${avatarDesign.backgroundColor}-20`],
            }}
        >
            <Text
                style={{
                    marginTop: "0",
                    marginBottom: "0",
                    fontStyle: "normal",
                    fontSize: `${fontSize}px`,
                    color: `${colors[`${avatarDesign.backgroundColor}-80`]} !important`,
                    lineHeight: `${height}px`,
                }}
            >
                {initials}
            </Text>
        </div>
    );
}
