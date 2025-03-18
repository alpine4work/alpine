import {assignInlineVars} from "@vanilla-extract/dynamic";
import escapeHtml from "escape-html";
import {IconContext} from "phosphor-react";
import {Fragment, ReactNode, useMemo} from "react";
import {AccountAvatar} from "~/client/accounts/account_avatar.js";
import {AccountAvatarPile} from "~/client/accounts/account_avatar_pile.js";
import {AccountShortName} from "~/client/accounts/account_short_name.js";
import {Box} from "~/client/design/box.js";
import {OverlayTriggerButton} from "~/client/design/overlay_trigger_button.js";
import {TaskDisplayStatusCircle} from "~/client/design/task_display_status_circle.js";
import {renderTextWithEmojiFontFamily} from "~/client/helpers/render_text_with_emoji_font_family.js";
import {ChannelBrandIcon} from "~/client/icons/brand/channel_brand_icon.js";
import {ChatBrandIcon} from "~/client/icons/brand/chat_brand_icon.js";
import {DocumentBrandIcon} from "~/client/icons/brand/document_brand_icon.js";
import {DocumentCommentBrandIcon} from "~/client/icons/brand/document_comment_brand_icon.js";
import {PostBrandIcon} from "~/client/icons/brand/post_brand_icon.js";
import {PostCommentBrandIcon} from "~/client/icons/brand/post_comment_brand_icon.js";
import {TaskBrandIcon} from "~/client/icons/brand/task_brand_icon.js";
import {TaskCollectionBrandIcon} from "~/client/icons/brand/task_collection_brand_icon.js";
import {TaskCommentBrandIcon} from "~/client/icons/brand/task_comment_brand_icon.js";
import {TaskQueryBrandIcon} from "~/client/icons/brand/task_query_brand_icon.js";
import {useSpacingScale} from "~/client/remix/spacing_scale_context.js";
import {getTaskCollectionColor} from "~/client/styles/get_task_collection_color.js";
import {
    minSearchResultViewBodyTextSnippetHeight,
    minSearchResultViewHeightPx,
    searchResultViewBodyTextSnippetFontSize,
    searchResultViewMediaSize,
    searchResultViewPaddingY,
    searchResultViewTitleFontSize,
    searchResultViewTitleMarginBottom,
} from "~/client/styles/search_shared_styles.js";
import {
    Sprinkles,
    backgroundColorVar,
    colorSchemeVars,
    contentStyles,
    greyElevated2ClassName,
    searchStyles,
    sprinkles,
} from "~/client/styles/styles.js";
import {Spacing, convertRemLengthToPx, spacing} from "~/shared/design/core/spacing.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {countIterable} from "~/shared/helpers/iterable/count_iterable.js";
import {iterateEmojis} from "~/shared/helpers/string/iterate_emojis.js";
import {OpensearchSearchHitExplanation} from "~/shared/opensearch/opensearch_search_hit_explanation.js";
import {SearchEntityIdObject, parseSearchEntityId} from "~/shared/search/search_entity_id.js";
import {SearchResult, SearchResultId, SearchResultMedia} from "~/shared/search/search_result.js";

export function SearchResultView({
    result,
    isSelected = false,
    isPressed = false,
    withMarginTop,
    withMarginBottom,
    onPressStart,
    onDoubleClick,
    marginX = "1",
    paddingX = "2.5",
}: {
    result: SearchResult;
    isSelected?: boolean;
    isPressed?: boolean;
    withMarginTop: boolean;
    withMarginBottom: boolean;
    onPressStart?: () => void;
    onDoubleClick?: () => void;
    marginX?: Spacing;
    paddingX?: Sprinkles["paddingX"];
}) {
    const spacingScale = useSpacingScale();

    const typeDisplay = useMemo(() => getSearchResultTypeDisplay(result.id), [result.id]);

    const typeDisplayAndMediaFragment = (
        <>
            <Box
                position="relative"
                display="inline-flex"
                justifyContent="center"
                alignItems="center"
                marginRight="1.5"
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
                        size: spacing[searchResultViewMediaSize],
                    }}
                >
                    {typeDisplay.icon}
                </IconContext.Provider>
            </Box>
            {result.media && <SearchResultMediaView media={result.media} />}
        </>
    );

    return (
        <Box
            paddingX={marginX}
            style={{
                // Tiny detail: The search modal's input renders its border on top of the first
                // search result view. So for it to look like the first search result has the
                // same Y margin as it does X margin we need to add an extra pixel of margin.
                paddingTop: withMarginTop ? convertRemLengthToPx("1", spacingScale) + 1 : undefined,
                paddingBottom: withMarginBottom ? spacing["1"] : undefined,
                minHeight: minSearchResultViewHeightPx[spacingScale],
            }}
            onPointerDown={event => {
                // Presses in a modal outside our element tree shouldn't select the search
                // result. This happens when clicking to close an overlay opened by
                // `<SearchResultViewExplainDebugWidget>`.
                if (event.target instanceof Element && event.currentTarget.contains(event.target)) {
                    onPressStart?.();
                }
            }}
            onDoubleClick={event => {
                // Presses in a modal outside our element tree shouldn't select the search
                // result. This happens when clicking to close an overlay opened by
                // `<SearchResultViewExplainDebugWidget>`.
                if (event.target instanceof Element && event.currentTarget.contains(event.target)) {
                    onDoubleClick?.();
                }
            }}
        >
            <Box
                paddingX={paddingX}
                position="relative"
                zIndex="0"
                style={
                    isSelected || isPressed
                        ? assignInlineVars({
                              [backgroundColorVar]: isPressed
                                  ? colorSchemeVars["grey-10"]
                                  : colorSchemeVars["grey-5"],
                          })
                        : undefined
                }
            >
                {(isSelected || isPressed) && (
                    <Box
                        position="absolute"
                        inset="0"
                        zIndex="-10"
                        borderRadius={marginX !== "0" ? "1.5" : undefined}
                        backgroundColor={isPressed ? "grey-10" : "grey-5"}
                        style={{
                            // Make sure background covers border of the entry below.
                            bottom: -1,
                        }}
                    />
                )}
                <Box
                    position="relative"
                    paddingY={searchResultViewPaddingY}
                    style={{
                        minHeight: minSearchResultViewHeightPx[spacingScale],
                    }}
                >
                    {result.title !== null && (
                        <Box
                            overflow="hidden"
                            fontSize={searchResultViewTitleFontSize}
                            paddingBottom={
                                result.bodyTextSnippet.length > 0
                                    ? searchResultViewTitleMarginBottom
                                    : undefined
                            }
                            style={{
                                minHeight: contentStyles.paragraphLineHeightPx[spacingScale],
                                lineHeight: `${contentStyles.paragraphLineHeightPx[spacingScale]}px`,
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
                            {typeDisplayAndMediaFragment}
                            {renderTextWithEmojiFontFamily(result.title)}
                        </Box>
                    )}
                    <Box
                        overflow="hidden"
                        color="grey-60"
                        fontSize={searchResultViewBodyTextSnippetFontSize}
                        className={
                            result.title === null
                                ? searchStyles.bodyTextSnippetWithoutTitleClassName
                                : undefined
                        }
                        style={{
                            // Truncate after 3 lines of text. Unofficial syntax that works in all browsers
                            // except IE.
                            // https://stackoverflow.com/questions/3922739/limit-text-length-to-n-lines-using-css
                            display: "-webkit-box",
                            WebkitLineClamp: result.title !== null ? 3 : 4,
                            lineClamp: result.title !== null ? 3 : 4,
                            WebkitBoxOrient: "vertical",
                            textOverflow: "ellipsis",
                            // Render contextual alternate glyphs. Particularly important that we render
                            // the right "@" for mentions.
                            fontFeatureSettings: '"calt" on',
                            minHeight:
                                result.title === null
                                    ? minSearchResultViewBodyTextSnippetHeight
                                    : undefined,
                        }}
                    >
                        {result.title === null && typeDisplayAndMediaFragment}
                        {typeDisplay.isAccountMediaAuthor && result.media?.type === "Account" ? (
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
                                            color: "grey-90",
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
                {result.explanation && (
                    <SearchResultViewExplainDebugWidget explanation={result.explanation} />
                )}
            </Box>
        </Box>
    );
}

/**
 * Configures how we display results of various types in `<SearchResultView>`.
 *
 * - `name`: The name we present this search entity with.
 * - `isAccountMediaAuthor`: If the `SearchResult` object has a `media` object
 *   with type `Account` then consider this account as the author of the search
 *   entity. Visually we end up putting the author name next to the search
 *   result body snippet to communicate authorship.
 */
type SearchResultTypeDisplay = {
    icon: ReactNode;
    isAccountMediaAuthor?: boolean;
};

// NOTE(calebmer): The icons used here for create actions are the same icons
// used in `<SpaceLayoutSideBarCreateButton/>`. If you change an icon here you
// should also change it there.
function getSearchResultTypeDisplay(resultId: SearchResultId): SearchResultTypeDisplay {
    switch (resultId) {
        case "CreateChatMessage": {
            return {icon: <ChatBrandIcon />};
        }
        case "CreatePost": {
            return {icon: <PostBrandIcon />};
        }
        case "CreateDocument": {
            return {icon: <DocumentBrandIcon />};
        }
        case "CreateTask": {
            return {icon: <TaskBrandIcon />};
        }
        case "CreateChannel": {
            return {icon: <ChannelBrandIcon />};
        }
        case "CreateTaskCollection": {
            return {icon: <TaskCollectionBrandIcon />};
        }
        case "CreateTaskView": {
            return {icon: <TaskQueryBrandIcon />};
        }
        case "TaskPersonal": {
            // We label the "My tasks" view as a task "collection" since it is a collection
            // of tasks.
            return getSearchResultTypeDisplayForEntity("TaskCollection");
        }
        case "TaskQueryFilteredToCreatorIsCurrentAccount":
        case "TaskQueryFilteredToAssigneeIsCurrentAccount":
        case "TaskQueryFilteredToAssigneeIsCurrentAccountAndAssigneeStatusIsActive":
        case "TaskQueryFilteredToAssignerIsCurrentAccount": {
            return {icon: <TaskQueryBrandIcon />};
        }
        default: {
            const entityIdObject = parseSearchEntityId(resultId);
            return getSearchResultTypeDisplayForEntity(entityIdObject.type);
        }
    }
}

function getSearchResultTypeDisplayForEntity(
    type: SearchEntityIdObject["type"],
): SearchResultTypeDisplay {
    switch (type) {
        case "Account": {
            return {icon: <ChatBrandIcon />};
        }
        case "Document": {
            return {icon: <DocumentBrandIcon />};
        }
        case "DocumentComment": {
            return {
                icon: <DocumentCommentBrandIcon />,
                isAccountMediaAuthor: true,
            };
        }
        case "Channel": {
            return {icon: <ChannelBrandIcon />};
        }
        case "Post": {
            return {
                icon: <PostBrandIcon />,
                isAccountMediaAuthor: true,
            };
        }
        case "PostComment": {
            return {
                icon: <PostCommentBrandIcon />,
                isAccountMediaAuthor: true,
            };
        }
        case "Chat": {
            return {icon: <ChatBrandIcon />};
        }
        case "ChatMessage": {
            return {
                icon: <ChatBrandIcon />,
                isAccountMediaAuthor: true,
            };
        }
        case "Task": {
            return {icon: <TaskBrandIcon />};
        }
        case "TaskCollection": {
            return {icon: <TaskCollectionBrandIcon />};
        }
        case "TaskComment": {
            return {icon: <TaskCommentBrandIcon />, isAccountMediaAuthor: true};
        }
        default:
            throw exhaustive(type);
    }
}

function SearchResultMediaView({media}: {media: SearchResultMedia}) {
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
                    marginLeft="1"
                    marginRight="2"
                    style={{
                        height: contentStyles.paragraphLineHeightPx[spacingScale],
                        verticalAlign: "top",
                    }}
                >
                    <TaskDisplayStatusCircle
                        displayStatus={media.displayStatus}
                        size={searchResultViewMediaSize}
                    />
                </Box>
            );
        }
        default:
            throw exhaustive(media);
    }
}

function SearchResultViewExplainDebugWidget({
    explanation,
}: {
    explanation: OpensearchSearchHitExplanation;
}) {
    // When we add to a search result score using factors other than OpenSearch
    // BM25 we include an emoji to communicate this is a "smart" score addition. We
    // use a sparkle for semantic search and a heart for search results the user
    // has an affinity for. To make it easier to spot scores affected by AI magic
    // (semantic search or affinity search) we want to put the same emoji in the
    // explain button.
    const emojis = useMemo(() => {
        const stack = [explanation];
        const maxValueByEmoji = new Map<string, number>();

        while (stack.length > 0) {
            const currentExplanation = stack.pop()!;

            for (const {emoji} of iterateEmojis(currentExplanation.description)) {
                const maxValue = maxValueByEmoji.get(emoji) ?? 0;
                maxValueByEmoji.set(emoji, Math.max(maxValue, currentExplanation.value));
            }

            for (const childExplanation of currentExplanation.details) {
                stack.push(childExplanation);
            }
        }

        return Array.from(maxValueByEmoji)
            .sort(([, a], [, b]) => b - a)
            .map(([emoji]) => emoji)
            .join("");
    }, [explanation]);

    return (
        <OverlayTriggerButton
            aria-haspopup="dialog"
            placement="right"
            overlay={
                <Box
                    data-scrollbar="false"
                    className={greyElevated2ClassName}
                    position="relative"
                    backgroundColor="grey-0"
                    borderRadius="1.5"
                    boxShadow="elevation-20"
                    width="128"
                    minHeight="64"
                    maxHeight="160"
                    padding="2"
                    overflow="auto"
                    userSelect="text"
                >
                    <SearchResultViewExplainDebugWidgetOverlay explanation={explanation} />
                </Box>
            }
        >
            <button
                tabIndex={-1}
                className={sprinkles({
                    position: "absolute",
                    top: "2",
                    right: "2",
                    zIndex: "20",
                    fontSize: "50",
                    fontStyle: "code",
                    backgroundColor: "green-10",
                    color: "green-90",
                    paddingX: "1",
                    paddingY: "0.5",
                    borderRadius: "1",
                    // Communicate to the developer they can interact with this.
                    cursor: "pointer",
                })}
                onPointerDown={event => {
                    // Don't also select the item when clicking explain.
                    event.stopPropagation();
                }}
            >
                {emojis.length > 0 ? `${emojis} ` : ""}Explain
            </button>
        </OverlayTriggerButton>
    );
}

function SearchResultViewExplainDebugWidgetOverlay({
    explanation,
}: {
    explanation: OpensearchSearchHitExplanation;
}) {
    return (
        <pre
            style={{width: "max-content"}}
            dangerouslySetInnerHTML={{
                __html: useMemo(
                    () => printOpensearchSearchHitExplanationHtml(explanation),
                    [explanation],
                ),
            }}
        />
    );
}

function printOpensearchSearchHitExplanationHtml(rootExplanation: OpensearchSearchHitExplanation) {
    const structureClassName = sprinkles({color: "grey-30"});
    const valueClassName = sprinkles({fontStyle: "code-semi-bold"});
    const descriptionClassName = sprinkles({color: "grey-60"});

    const fractionPlaceCount = 3;
    const fractionPlaceFactor = 10 ** fractionPlaceCount;

    const printValue = (value: number): string => {
        const valueString = String(Math.round(value * fractionPlaceFactor) / fractionPlaceFactor);

        const [decimal, fraction] = valueString.split(".", 2);

        return `${decimal!}.${(fraction ?? "").padEnd(fractionPlaceCount, "0")}`;
    };

    const print = (
        directPrefix: string,
        prefix: string,
        explanation: OpensearchSearchHitExplanation,
        valueString: string,
    ): string => {
        let string = `${directPrefix}<span class="${valueClassName}">${escapeHtml(
            valueString,
        )}</span> <span class="${descriptionClassName}">${escapeHtml(
            explanation.description,
        )}</span>\n`;

        const valueStrings = explanation.details.map(subExplanation =>
            printValue(subExplanation.value),
        );

        const maxValueStringLength = valueStrings.reduce(
            (maxValueStringLength, valueString) =>
                Math.max(maxValueStringLength, valueString.length),
            0,
        );

        const indentLength = 3;

        const childStrings = explanation.details.map((childExplanation, i) => {
            const valueString = valueStrings[i]!;

            const childIndentLength = indentLength + +(maxValueStringLength - valueString.length);

            const childDirectPrefix = `${prefix}<span class="${structureClassName}">${
                i === explanation.details.length - 1 ? "└" : "├"
            }${"─".repeat(childIndentLength - 2)}</span> `;

            const childPrefix = `${prefix}${
                i === explanation.details.length - 1
                    ? " "
                    : `<span class="${structureClassName}">│</span>`
            }${" ".repeat(childIndentLength - 1)}`;

            return print(childDirectPrefix, childPrefix, childExplanation, valueString);
        });

        const maxChildLineCount = childStrings.reduce(
            (maxChildLineCount, childString) =>
                Math.max(maxChildLineCount, countIterable(childString.matchAll(/\n/g))),
            0,
        );

        // Add padding between lines if we have large subtrees.
        for (const [i, childString] of childStrings.entries()) {
            if (i !== 0 && maxChildLineCount > 3) {
                string += `${prefix}<span class="${structureClassName}">│</span>\n`;
            }

            string += childString;
        }

        return string;
    };

    return print("", "", rootExplanation, printValue(rootExplanation.value));
}
