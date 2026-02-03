import {IconContext, Trash} from "phosphor-react";
import {ReactNode, useMemo} from "react";
import {split as splitUnicodeDefaultWordBoundary} from "unicode-default-word-boundary";
import {AccountAvatar} from "~/client/web/accounts/account_avatar.js";
import {AccountAvatarPile} from "~/client/web/accounts/account_avatar_pile.js";
import {Box} from "~/client/web/design/box.js";
import {TaskDisplayStatusCircle} from "~/client/web/design/task_display_status_circle.js";
import {renderTextWithEmojiFontFamily} from "~/client/web/helpers/render_text_with_emoji_font_family.js";
import {useSpacingScale} from "~/client/web/remix/spacing_scale_context.js";
import {SearchEntityTypeDisplay} from "~/client/web/search/core/search_entity_type_display.js";
import {getTaskCollectionColor} from "~/client/web/styles/get_task_collection_color.js";
import {
    searchEntityViewMediaSize,
    searchEntityViewTitleFontSize,
    searchEntityViewTitleLineHeightPx,
    searchEntityViewTitleTypeDisplayGap,
} from "~/client/web/styles/search_shared_styles.js";
import {colorSchemeVars, contentStyles} from "~/client/web/styles/styles.js";
import {spacing} from "~/shared/design/core/spacing.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {countGraphemes} from "~/shared/helpers/string/iterate_graphemes.js";
import {maxReasonableEnglishWordGraphemeCount} from "~/shared/helpers/string/max_reasonable_english_word_grapheme_count.js";
import {getSearchEntityNoun} from "~/shared/search/get_search_entity_noun.js";
import {deletedSearchEntityTitle} from "~/shared/search/missing_and_private_search_entity_titles.js";
import {isSearchDynamicEntityType} from "~/shared/search/search_entity_id.js";
import {SearchEntityMediaModel} from "~/shared/search/search_entity_media_model.js";

export function SearchEntityViewTitle({
    typeDisplay,
    entityData,
    lineClamp = 2,
}: {
    typeDisplay: SearchEntityTypeDisplay;
    entityData: {
        title: string | null;
        media: SearchEntityMediaModel | null;
    };
    lineClamp?: number;
}) {
    const spacingScale = useSpacingScale();

    // TODO: Consider using some more sophisticated truncation strategy for long words.
    // We could pull this into a <Truncate> component and use some JS to measure text width
    // and insert break points as needed.
    const shouldBreakWords = useMemo(() => {
        const words = splitUnicodeDefaultWordBoundary(entityData.title || "");
        const firstWordLength = countGraphemes(words[0] || "");
        return entityData.title?.length
            ? firstWordLength > maxReasonableEnglishWordGraphemeCount
            : false;
    }, [entityData.title]);

    return (
        <Box
            overflow="hidden"
            fontSize={searchEntityViewTitleFontSize}
            style={{
                minHeight: searchEntityViewTitleLineHeightPx[spacingScale],
                lineHeight: `${searchEntityViewTitleLineHeightPx[spacingScale]}px`,
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
                // eslint-disable-next-line cyberworlds/string-quotes
                fontFeatureSettings: '"calt" on',
                wordBreak: shouldBreakWords ? "break-all" : "normal",
            }}
        >
            <SearchEntityViewTitlePrefix
                icon={typeDisplay.icon}
                media={entityData.media}
                isDeleted={entityData.title === null}
            />
            {entityData.title !== null
                ? renderTextWithEmojiFontFamily(entityData.title)
                : isSearchDynamicEntityType(typeDisplay.type)
                  ? // If `title` is null then we assume the entity was deleted. Otherwise, all
                    // mentionable entities should have a non-null title.
                    `${deletedSearchEntityTitle} ${getSearchEntityNoun(typeDisplay.type)}`
                  : null}
        </Box>
    );
}

export function SearchEntityViewTitlePrefix({
    icon,
    media,
    isDeleted,
}: {
    icon: ReactNode;
    media: SearchEntityMediaModel | null;
    isDeleted: boolean;
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
                    height: searchEntityViewTitleLineHeightPx[spacingScale],
                    verticalAlign: "top",
                }}
            >
                <IconContext.Provider
                    value={{
                        color: colorSchemeVars[contentStyles.brandIconDefaultColor],
                        size: spacing[searchEntityViewMediaSize],
                    }}
                >
                    {icon}
                </IconContext.Provider>
            </Box>
            {isDeleted ? (
                <Box
                    position="relative"
                    display="inline-flex"
                    justifyContent="center"
                    alignItems="center"
                    marginRight="1"
                    style={{
                        height: searchEntityViewTitleLineHeightPx[spacingScale],
                        verticalAlign: "top",
                    }}
                >
                    <Trash size={spacing["4"]} />
                </Box>
            ) : media !== null ? (
                <SearchEntityViewMedia media={media} />
            ) : null}
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
                        height: searchEntityViewTitleLineHeightPx[spacingScale],
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
                        height: searchEntityViewTitleLineHeightPx[spacingScale],
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
            if (media.color === null) return null;

            return (
                <Box
                    display="inline-flex"
                    alignItems="center"
                    marginLeft="1"
                    marginRight="1.5"
                    style={{
                        height: searchEntityViewTitleLineHeightPx[spacingScale],
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
                        height: searchEntityViewTitleLineHeightPx[spacingScale],
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
