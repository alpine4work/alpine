import {IconContext, Trash} from "phosphor-react";
import {useMemo} from "react";
import {split as splitUnicodeDefaultWordBoundary} from "unicode-default-word-boundary";
import {AccountAvatar} from "~/client/web/accounts/account_avatar.js";
import {AccountAvatarPile} from "~/client/web/accounts/account_avatar_pile.js";
import {Box} from "~/client/web/design/box.js";
import {TaskDisplayStatusCircle} from "~/client/web/design/task_display_status_circle.js";
import {renderTextWithEmojiFontFamily} from "~/client/web/helpers/render_text_with_emoji_font_family.js";
import {useSpacingScale} from "~/client/web/remix/spacing_scale_context.js";
import {getSearchEntityIcon} from "~/client/web/search/core/get_search_entity_icon.js";
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
import {getAuthorFromSearchEntityIfExists} from "~/shared/search/get_author_from_search_entity_if_exists.js";
import {getSearchEntityNoun} from "~/shared/search/get_search_entity_noun.js";
import {deletedSearchEntityTitle} from "~/shared/search/missing_and_private_search_entity_titles.js";
import {isSearchDynamicEntityType} from "~/shared/search/search_entity_id.js";
import {
    SearchChatEntityMediaModel,
    SearchEntityModelDataWithAccount,
} from "~/shared/search/search_entity_model.js";
import {AccountModel} from "~/shared/spaces/account_model.js";

export function SearchEntityViewTitle({
    entityData,
    lineClamp = 2,
}: {
    entityData: SearchEntityModelDataWithAccount;
    lineClamp?: number;
}) {
    const spacingScale = useSpacingScale();

    // TODO: Consider using some more sophisticated truncation strategy for long words.
    // We could pull this into a <Truncate> component and use some JS to measure text
    // width and insert break points as needed.
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
                entityData={entityData}
                isDeleted={entityData.title === null}
            />
            {entityData.title !== null
                ? renderTextWithEmojiFontFamily(entityData.title)
                : isSearchDynamicEntityType(entityData.type)
                  ? // If `title` is null then we assume the entity was deleted. Otherwise, all
                    // mentionable entities should have a non-null title.
                    `${deletedSearchEntityTitle} ${getSearchEntityNoun(entityData.type)}`
                  : null}
        </Box>
    );
}

export function SearchEntityViewTitlePrefix({
    entityData,
    isDeleted,
}: {
    entityData: SearchEntityModelDataWithAccount;
    isDeleted: boolean;
}) {
    const spacingScale = useSpacingScale();
    const icon = useMemo(() => getSearchEntityIcon(entityData), [entityData]);

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
            ) : (
                <SearchEntityViewMedia entityData={entityData} />
            )}
        </>
    );
}

function SearchEntityViewMedia({entityData}: {entityData: SearchEntityModelDataWithAccount}) {
    const spacingScale = useSpacingScale();

    function renderAccountAvatar(account: AccountModel) {
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
                <AccountAvatar account={account} size="5" />
            </Box>
        );
    }

    switch (entityData.type) {
        case "Channel":
        case "Database":
        case "Document":
        case "Site":
        case "Static": {
            return null;
        }
        case "Account": {
            return renderAccountAvatar(entityData.account);
        }
        case "Chat": {
            return <SearchChatEntityViewMedia media={entityData.chat.media} />;
        }
        case "Task": {
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
                        displayStatus={entityData.task.displayStatus.value}
                        size={searchEntityViewMediaSize}
                    />
                </Box>
            );
        }
        case "TaskCollection": {
            if (entityData.collection.color.value === null) return null;

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
                        backgroundColor={getTaskCollectionColor(entityData.collection.color.value)}
                    />
                </Box>
            );
        }
        case "ChatMessage":
        case "TaskComment":
        case "PostComment":
        case "DocumentComment":
        case "Post": {
            const author = getAuthorFromSearchEntityIfExists(entityData);
            assert(author);

            return renderAccountAvatar(author);
        }
        default: {
            throw exhaustive(entityData);
        }
    }
}

function SearchChatEntityViewMedia({media}: {media: SearchChatEntityMediaModel}) {
    const spacingScale = useSpacingScale();

    switch (media.type) {
        case "Account": {
            // Render a grey circle for chats that don't have an `AccountPile` media. We want
            // to communicate it's a multi-person chat so we don't want to render one account.
            // This case should happen rarely. Just `RoomChat`s that only a single person has
            // messaged so far.
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
                    <AccountAvatarPile
                        size="5"
                        previewAccounts={[null, media.account]}
                        accountCount={1}
                        getAllAccounts={() => [media.account]}
                    />
                </Box>
            );
        }
        case "AccountPile": {
            assert(media.previewAccounts.length >= 2);

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
                    <AccountAvatarPile
                        size="5"
                        previewAccounts={media.previewAccounts.slice(0, 2)}
                        accountCount={media.previewAccounts.length}
                        getAllAccounts={() => media.previewAccounts}
                    />
                </Box>
            );
        }
        default: {
            throw exhaustive(media);
        }
    }
}
