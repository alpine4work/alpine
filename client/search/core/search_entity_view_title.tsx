import {IconContext} from "phosphor-react";
import {ReactNode} from "react";
import {AccountAvatar} from "~/client/accounts/account_avatar.js";
import {AccountAvatarPile} from "~/client/accounts/account_avatar_pile.js";
import {Box} from "~/client/design/box.js";
import {TaskDisplayStatusCircle} from "~/client/design/task_display_status_circle.js";
import {renderTextWithEmojiFontFamily} from "~/client/helpers/render_text_with_emoji_font_family.js";
import {brandIconDefaultColor} from "~/client/icons/brand/brand_icon_default_color.js";
import {useSpacingScale} from "~/client/remix/spacing_scale_context.js";
import {getTaskCollectionColor} from "~/client/styles/get_task_collection_color.js";
import {
    searchEntityViewMediaSize,
    searchEntityViewTitleFontSize,
    searchEntityViewTitleTypeDisplayGap,
} from "~/client/styles/search_shared_styles.js";
import {colorSchemeVars, contentStyles} from "~/client/styles/styles.js";
import {spacing} from "~/shared/design/core/spacing.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {SearchEntityMediaModel} from "~/shared/search/search_entity_media_model.js";

export function SearchEntityViewTitle({
    icon,
    title,
    media,
    lineClamp = 2,
}: {
    icon: ReactNode;
    title: string | null;
    media: SearchEntityMediaModel | null;
    lineClamp?: number;
}) {
    const spacingScale = useSpacingScale();

    return (
        <Box
            overflow="hidden"
            fontSize={searchEntityViewTitleFontSize}
            style={{
                minHeight: contentStyles.paragraphLineHeightPx[spacingScale],
                lineHeight: `${contentStyles.paragraphLineHeightPx[spacingScale]}px`,
                // Truncate after 2 lines of text. Unofficial syntax that works in all browsers
                // except IE.
                // https://stackoverflow.com/questions/3922739/limit-text-length-to-n-lines-using-css
                display: "-webkit-box",
                WebkitLineClamp: lineClamp,
                lineClamp,
                WebkitBoxOrient: "vertical",
                textOverflow: "ellipsis",
                // Render contextual alternate glyphs. Particularly important that we render
                // the right "@" for mentions.
                // eslint-disable-next-line string-quotes
                fontFeatureSettings: '"calt" on',
            }}
        >
            <SearchEntityViewTitlePrefix icon={icon} media={media} />
            {title !== null ? renderTextWithEmojiFontFamily(title) : null}
        </Box>
    );
}

export function SearchEntityViewTitlePrefix({
    icon,
    media,
}: {
    icon: ReactNode;
    media: SearchEntityMediaModel | null;
}) {
    const spacingScale = useSpacingScale();

    return (
        <>
            <Box
                position="relative"
                display="inline-flex"
                justifyContent="center"
                alignItems="center"
                marginRight={searchEntityViewTitleTypeDisplayGap}
                style={{
                    height: contentStyles.paragraphLineHeightPx[spacingScale],
                    verticalAlign: "top",
                }}
            >
                <IconContext.Provider
                    value={{
                        color: colorSchemeVars[brandIconDefaultColor],
                        size: spacing[searchEntityViewMediaSize],
                    }}
                >
                    {icon}
                </IconContext.Provider>
            </Box>
            {media && <SearchEntityViewMedia media={media} />}
        </>
    );
}

function SearchEntityViewMedia({media}: {media: SearchEntityMediaModel}) {
    const spacingScale = useSpacingScale();

    switch (media.type) {
        case "Account": {
            return (
                <Box
                    display="inline-flex"
                    alignItems="center"
                    marginLeft="0.5"
                    marginRight="1.5"
                    style={{
                        height: contentStyles.paragraphLineHeightPx[spacingScale],
                        verticalAlign: "top",
                    }}
                >
                    <AccountAvatar account={media.account} size="5" />
                </Box>
            );
        }
        case "AccountPile": {
            assert(media.previewAccounts.length >= 1);

            return (
                <Box
                    display="inline-flex"
                    alignItems="center"
                    marginLeft="0.5"
                    marginRight="1.5"
                    style={{
                        height: contentStyles.paragraphLineHeightPx[spacingScale],
                        verticalAlign: "top",
                    }}
                >
                    {media.previewAccounts.length === 1 ? (
                        <AccountAvatar account={media.previewAccounts[0]!} size="5" />
                    ) : (
                        <AccountAvatarPile
                            size="5"
                            previewAccounts={media.previewAccounts.slice(0, 2)}
                            accountCount={media.previewAccounts.length}
                            getAllAccounts={() => media.previewAccounts}
                        />
                    )}
                </Box>
            );
        }
        case "TaskCollectionColor": {
            return (
                <Box
                    display="inline-flex"
                    alignItems="center"
                    marginLeft="1"
                    marginRight="1.5"
                    style={{
                        height: contentStyles.paragraphLineHeightPx[spacingScale],
                        verticalAlign: "top",
                    }}
                >
                    <Box
                        width="2"
                        height="2"
                        borderRadius="full"
                        backgroundColor={getTaskCollectionColor(media.color)}
                    />
                </Box>
            );
        }
        case "TaskDisplayStatus": {
            return (
                <Box
                    display="inline-flex"
                    alignItems="center"
                    marginLeft="0.5"
                    marginRight="1.5"
                    style={{
                        height: contentStyles.paragraphLineHeightPx[spacingScale],
                        verticalAlign: "top",
                    }}
                >
                    <TaskDisplayStatusCircle
                        displayStatus={media.displayStatus}
                        size={searchEntityViewMediaSize}
                    />
                </Box>
            );
        }
        default:
            throw exhaustive(media);
    }
}
