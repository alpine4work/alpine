import {ChatCircle, EnvelopeSimple, File, IconContext, ListChecks, User} from "phosphor-react";
import {Fragment, ReactNode, useMemo} from "react";
import {AccountAvatar} from "~/client/accounts/account_avatar.js";
import {AccountShortName} from "~/client/accounts/account_short_name.js";
import {Box} from "~/client/design/box.js";
import {renderTextWithEmojiFontFamily} from "~/client/helpers/render_text_with_emoji_font_family.js";
import {RemLength, addRemLengths, parseRemLengthNumber, spacing} from "~/shared/design/spacing.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {SearchEntityIdObject, parseSearchEntityId} from "~/shared/search/search_entity_id.js";
import {SearchResult, SearchResultMedia} from "~/shared/search/search_result.js";
import {backgroundColorVar, colorSchemeVars, fontSizes, sprinkles} from "~/shared/styles/styles.js";

/**
 * Minimum height of the body text snippet in a search result. We show at least
 * two lines when there's no title and zero lines when there is a title.
 *
 * The minimum height of our `<SearchResultView>` determines the size of our
 * search request. More items in our search request means higher search
 * latency. At least 2 lines means we need to load less data to fill the
 * virtualization window.
 */
const minSearchBodyTextSnippetLineCount = 2;
const minSearchBodyTextSnippetLineCountWithTitle = 0;

const paddingY = "3";
const searchTypeDisplayNameFontSize = "50";
const searchBodyTextSnippetFontSize = "75";
const searchTitleFontSize = "100";
const searchTypeDisplayMarginBottom = "1.5";
const searchTitleMarginBottom = "1";

const minSearchBodyTextSnippetHeight: RemLength = `${
    parseRemLengthNumber(fontSizes[searchBodyTextSnippetFontSize].lineHeight) *
    minSearchBodyTextSnippetLineCount
}rem`;

const minSearchBodyTextSnippetHeightWithTitle: RemLength = `${
    parseRemLengthNumber(fontSizes[searchBodyTextSnippetFontSize].lineHeight) *
    minSearchBodyTextSnippetLineCountWithTitle
}rem`;

const minSearchResultViewHeightWithoutPaddingY = addRemLengths(
    fontSizes[searchTypeDisplayNameFontSize].lineHeight,
    spacing[searchTypeDisplayMarginBottom],
    minSearchBodyTextSnippetHeight,
);

export const minSearchResultViewHeight = addRemLengths(
    spacing[paddingY],
    minSearchResultViewHeightWithoutPaddingY,
    spacing[paddingY],
);

export function SearchResultView({
    result,
    isSelected,
    isFirstEntry,
    isLastEntry,
    onPressStart,
}: {
    result: SearchResult;
    isSelected: boolean;
    isFirstEntry: boolean;
    isLastEntry: boolean;
    onPressStart: () => void;
}) {
    const typeDisplay = useMemo(() => {
        if (result.entityId === "TaskNotepad") {
            // We label the task notepad as a task "collection" since it is a collection of
            // tasks. We need some label and ideally it's not "Task notepad" since that's
            // the same as the title.
            return getSearchEntityTypeDisplay("TaskCollection");
        }

        const entityIdObject = parseSearchEntityId(result.entityId);
        return getSearchEntityTypeDisplay(entityIdObject.type);
    }, [result.entityId]);

    return (
        <Box
            paddingX="1"
            paddingTop={isFirstEntry ? "1" : undefined}
            paddingBottom={isLastEntry ? "1" : undefined}
            style={{minHeight: minSearchResultViewHeight}}
            onPointerDown={() => {
                onPressStart?.();
            }}
        >
            <Box
                paddingX="3"
                borderRadius="md"
                backgroundColor={isSelected ? "grey-5" : undefined}
                style={{
                    // Add an extra pixel of padding so the background color covers the
                    // border rendered with `boxShadow`.
                    paddingBottom: 1,
                    marginBottom: -1,
                }}
            >
                <Box
                    paddingY={paddingY}
                    style={{
                        // Draw border with a `box-shadow` instead of `border` so it doesn't contribute
                        // 1px to layout. Layout needs to be precise since this is rendered in a
                        // virtualized list.
                        boxShadow: !isLastEntry
                            ? `0 1px 0 0 ${colorSchemeVars["grey-5"]}`
                            : undefined,
                    }}
                >
                    <Box display="flex" gap="3" alignItems="center">
                        {result.media && (
                            <SearchResultMediaView media={result.media} isSelected={isSelected} />
                        )}
                        <Box
                            flexGrow="1"
                            style={{minHeight: minSearchResultViewHeightWithoutPaddingY}}
                        >
                            <Box
                                fontSize={searchTypeDisplayNameFontSize}
                                color="grey-40"
                                paddingBottom={searchTypeDisplayMarginBottom}
                                display="flex"
                                alignItems="center"
                                gap="1"
                            >
                                <IconContext.Provider
                                    value={{
                                        size: spacing["3"],
                                        color: "currentColor",
                                    }}
                                >
                                    {typeDisplay.icon}
                                </IconContext.Provider>
                                <Box>{typeDisplay.name}</Box>
                            </Box>
                            {result.title !== null && (
                                <Box
                                    overflow="hidden"
                                    fontSize={searchTitleFontSize}
                                    fontStyle="semi-bold"
                                    paddingBottom={searchTitleMarginBottom}
                                    style={{
                                        minHeight: fontSizes[searchTitleFontSize].lineHeight,
                                        // Truncate after 3 lines of text. Unofficial syntax that works in all browsers
                                        // except IE.
                                        // https://stackoverflow.com/questions/3922739/limit-text-length-to-n-lines-using-css
                                        display: "-webkit-box",
                                        WebkitLineClamp: 2,
                                        lineClamp: 2,
                                        WebkitBoxOrient: "vertical",
                                        textOverflow: "ellipsis",
                                        // Render contextual alternate glyphs. Particularly important that we render
                                        // the right "@" for mentions.
                                        fontFeatureSettings: '"calt" on',
                                    }}
                                >
                                    {renderTextWithEmojiFontFamily(result.title)}
                                </Box>
                            )}
                            <Box
                                overflow="hidden"
                                color="grey-60"
                                fontSize={searchBodyTextSnippetFontSize}
                                style={{
                                    // Truncate after 3 lines of text. Unofficial syntax that works in all browsers
                                    // except IE.
                                    // https://stackoverflow.com/questions/3922739/limit-text-length-to-n-lines-using-css
                                    display: "-webkit-box",
                                    WebkitLineClamp: 3,
                                    lineClamp: 3,
                                    WebkitBoxOrient: "vertical",
                                    textOverflow: "ellipsis",
                                    // Render contextual alternate glyphs. Particularly important that we render
                                    // the right "@" for mentions.
                                    fontFeatureSettings: '"calt" on',
                                    minHeight:
                                        result.title !== null
                                            ? minSearchBodyTextSnippetHeightWithTitle
                                            : minSearchBodyTextSnippetHeight,
                                }}
                            >
                                {typeDisplay.isAccountMediaAuthor &&
                                result.media?.type === "Account" ? (
                                    <>
                                        <AccountShortName
                                            account={result.media.account}
                                            isTooltipDisabled={true}
                                        />
                                        {": "}
                                    </>
                                ) : null}
                                {result.bodyTextSnippet.map(({isHighlighted, text}, index) => {
                                    if (!isHighlighted) {
                                        return (
                                            <Fragment key={index}>
                                                {renderTextWithEmojiFontFamily(text)}
                                            </Fragment>
                                        );
                                    } else {
                                        return (
                                            <span
                                                key={index}
                                                className={sprinkles({
                                                    color: "grey-text",
                                                    fontStyle: "semi-bold",
                                                })}
                                            >
                                                {renderTextWithEmojiFontFamily(text)}
                                            </span>
                                        );
                                    }
                                })}
                            </Box>
                        </Box>
                    </Box>
                </Box>
            </Box>
        </Box>
    );
}

/**
 * Configures how we display entities of this type in `<SearchResultView>`.
 *
 * - `name`: The name we present this search entity with.
 * - `icon`: An icon we use to represent the search entity alongside the name.
 * - `isAccountMediaAuthor`: If the `SearchResult` object has a `media` object
 *   with type `Account` then consider this account as the author of the search
 *   entity. Visually we end up putting the author name next to the search
 *   result body snippet to communicate authorship.
 */
function getSearchEntityTypeDisplay(type: SearchEntityIdObject["type"]): {
    name: string;
    icon: ReactNode;
    isAccountMediaAuthor: boolean;
} {
    switch (type) {
        case "Account": {
            return {
                name: "Person",
                icon: <User />,
                isAccountMediaAuthor: false,
            };
        }
        case "Document": {
            return {
                name: "Document",
                icon: <File />,
                isAccountMediaAuthor: false,
            };
        }
        case "DocumentComment": {
            return {
                name: "Document comment",
                icon: <File />,
                isAccountMediaAuthor: true,
            };
        }
        case "Channel": {
            return {
                name: "Channel",
                icon: <EnvelopeSimple />,
                isAccountMediaAuthor: false,
            };
        }
        case "Post": {
            return {
                name: "Post",
                icon: <EnvelopeSimple />,
                isAccountMediaAuthor: false,
            };
        }
        case "PostComment": {
            return {
                name: "Post comment",
                icon: <EnvelopeSimple />,
                isAccountMediaAuthor: true,
            };
        }
        case "Chat": {
            return {
                name: "Chat",
                icon: <ChatCircle />,
                isAccountMediaAuthor: false,
            };
        }
        case "ChatMessage": {
            return {
                name: "Chat message",
                icon: <ChatCircle />,
                isAccountMediaAuthor: true,
            };
        }
        case "Task": {
            return {
                name: "Task",
                icon: <ListChecks />,
                isAccountMediaAuthor: false,
            };
        }
        case "TaskCollection": {
            return {
                name: "Task collection",
                icon: <ListChecks />,
                isAccountMediaAuthor: false,
            };
        }
        default:
            throw exhaustive(type);
    }
}

function SearchResultMediaView({
    media,
    isSelected,
}: {
    media: SearchResultMedia;
    isSelected: boolean;
}) {
    let node: ReactNode;

    switch (media.type) {
        case "Account": {
            node = <AccountAvatar account={media.account} size="9" />;
            break;
        }
        case "AccountPile": {
            assert(media.previewAccounts.length >= 1);

            node = (
                <>
                    {media.previewAccounts.length === 1 ? (
                        <AccountAvatar account={media.previewAccounts[0]!} size="9" />
                    ) : (
                        <Box position="absolute" width="10" height="10" inset="-0.5">
                            <Box position="absolute" top="0" left="0">
                                <AccountAvatar account={media.previewAccounts[0]!} size="7" />
                            </Box>
                            <Box
                                position="absolute"
                                bottom="0"
                                right="0"
                                borderRadius="full"
                                style={{boxShadow: `0 0 0 2px ${backgroundColorVar}`}}
                            >
                                <AccountAvatar account={media.previewAccounts[1]!} size="7" />
                            </Box>
                        </Box>
                    )}
                </>
            );
            break;
        }
        default:
            throw exhaustive(media);
    }

    return (
        <Box
            flexShrink="0"
            position="relative"
            width="9"
            height="9"
            display="flex"
            alignItems="center"
            justifyContent="center"
        >
            {node}
        </Box>
    );
}
