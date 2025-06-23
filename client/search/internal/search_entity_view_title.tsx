import {IconContext} from "phosphor-react";
import {ReactNode} from "react";
import {AccountAvatar} from "~/client/accounts/account_avatar.js";
import {AccountAvatarPile} from "~/client/accounts/account_avatar_pile.js";
import {Box} from "~/client/design/box.js";
import {TaskDisplayStatusCircle} from "~/client/design/task_display_status_circle.js";
import {renderTextWithEmojiFontFamily} from "~/client/helpers/render_text_with_emoji_font_family.js";
import {useSpacingScale} from "~/client/remix/spacing_scale_context.js";
import {getTaskCollectionColor} from "~/client/styles/get_task_collection_color.js";
import {
    searchEntityViewMediaSize,
    searchEntityViewTitleFontSize,
    searchEntityViewTitleTypeDisplayGap,
} from "~/client/styles/search_shared_styles.js";
import {contentStyles, searchStyles} from "~/client/styles/styles.js";
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
                // Brand icons only render in the `grey-80` shade and above. So we can maintain
                // proper contrast between the icon line and color splash. However, here we
                // want to render a lighter line color (e.g. `grey-60`) to not distract from
                // the result title. We calculate the opacity to get us from `grey-80` to a
                // lighter line color (e.g. `grey-60`) and apply it. By applying opacity the
                // color splash also gets lighter to maintain proper contrast between the lines
                // and the color splash.
                className={searchStyles.brandIconOpacityClassName}
            >
                <IconContext.Provider
                    value={{
                        color: searchStyles.brandIconColor,
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
