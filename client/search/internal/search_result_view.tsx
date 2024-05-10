import escapeHtml from "escape-html";
import {
    ChatsCircle,
    EnvelopeOpen,
    FileText,
    Funnel,
    Hash,
    IconContext,
    ListChecks,
    Table,
} from "phosphor-react";
import {Fragment, ReactNode, useMemo} from "react";
import {AccountAvatar} from "~/client/accounts/account_avatar.js";
import {AccountShortName} from "~/client/accounts/account_short_name.js";
import {Box} from "~/client/design/box.js";
import {OverlayTriggerButton} from "~/client/design/overlay_trigger_button.js";
import {renderTextWithEmojiFontFamily} from "~/client/helpers/render_text_with_emoji_font_family.js";
import {RemLength, addRemLengths, parseRemLengthNumber, spacing} from "~/shared/design/spacing.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {countIterable} from "~/shared/helpers/iterable/count_iterable.js";
import {iterateEmojis} from "~/shared/helpers/string/iterate_emojis.js";
import {OpensearchSearchHitExplanation} from "~/shared/opensearch/opensearch_search_hit_explanation.js";
import {SearchEntityIdObject, parseSearchEntityId} from "~/shared/search/search_entity_id.js";
import {SearchResult, SearchResultId, SearchResultMedia} from "~/shared/search/search_result.js";
import {
    backgroundColorVar,
    colorSchemeVars,
    fontSizes,
    greyElevated2ClassName,
    sprinkles,
} from "~/shared/styles/styles.js";
import {getTaskCollectionColor} from "~/shared/styles/get_task_collection_color.js";

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

const paddingY = "4";
const searchTypeDisplayNameFontSize = "50";
const searchBodyTextSnippetFontSize = "75";
const searchTitleFontSize = "100";
const searchTypeDisplayMarginBottom = "1";
const searchTitleMarginBottom = "1";

const minSearchBodyTextSnippetHeight: RemLength = `${
    parseRemLengthNumber(fontSizes[searchBodyTextSnippetFontSize].lineHeight) *
    minSearchBodyTextSnippetLineCount
}rem`;

const minSearchBodyTextSnippetHeightWithTitle: RemLength = `${
    parseRemLengthNumber(fontSizes[searchBodyTextSnippetFontSize].lineHeight) *
    minSearchBodyTextSnippetLineCountWithTitle
}rem`;

const minSearchResultViewHeightWithoutPaddingY: RemLength = `${Math.min(
    parseRemLengthNumber(
        addRemLengths(
            fontSizes[searchTypeDisplayNameFontSize].lineHeight,
            spacing[searchTypeDisplayMarginBottom],
            fontSizes[searchTitleFontSize].lineHeight,
            minSearchBodyTextSnippetHeightWithTitle,
        ),
    ),
    parseRemLengthNumber(
        addRemLengths(
            fontSizes[searchTypeDisplayNameFontSize].lineHeight,
            spacing[searchTypeDisplayMarginBottom],
            minSearchBodyTextSnippetHeight,
        ),
    ),
)}rem`;

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
    onDoubleClick,
}: {
    result: SearchResult;
    isSelected: boolean;
    isFirstEntry: boolean;
    isLastEntry: boolean;
    onPressStart: () => void;
    onDoubleClick: () => void;
}) {
    const typeDisplay = useMemo(() => getSearchResultTypeDisplay(result.id), [result.id]);

    return (
        <Box
            paddingX="1"
            paddingTop={isFirstEntry ? "1" : undefined}
            paddingBottom={isLastEntry ? "1" : undefined}
            style={{minHeight: minSearchResultViewHeight}}
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
                    onDoubleClick();
                }
            }}
        >
            <Box
                paddingX="4"
                position="relative"
                zIndex="0"
                borderRadius="md"
                backgroundColor={isSelected ? "grey-5" : undefined}
            >
                {isSelected && (
                    <Box
                        position="absolute"
                        inset="0"
                        zIndex="-10"
                        borderRadius="md"
                        backgroundColor="grey-5"
                        style={{
                            // Make sure background covers border of the entry below.
                            bottom: -1,
                        }}
                    />
                )}
                <Box
                    paddingY={paddingY}
                    style={{
                        // Draw border with a `box-shadow` instead of `border` so it doesn't contribute
                        // 1px to layout. Layout needs to be precise since this is rendered in a
                        // virtualized list.
                        boxShadow: `0 1px 0 0 ${colorSchemeVars["grey-5"]}`,
                    }}
                >
                    <Box display="flex" gap="3" alignItems="center">
                        {result.media ? (
                            <SearchResultMediaView media={result.media} />
                        ) : typeDisplay.iconMedia ? (
                            <Box
                                flexShrink="0"
                                position="relative"
                                width={searchResultMediaViewSize}
                                height={searchResultMediaViewSize}
                                display="flex"
                                alignItems="center"
                                justifyContent="center"
                            >
                                <Box
                                    width="9"
                                    height="9"
                                    borderRadius="full"
                                    border={isSelected ? "grey-10" : "grey-5"}
                                    color="grey-70"
                                    display="flex"
                                    justifyContent="center"
                                    alignItems="center"
                                >
                                    <IconContext.Provider
                                        value={{
                                            size: spacing["5"],
                                            color: "currentColor",
                                        }}
                                    >
                                        {typeDisplay.iconMedia}
                                    </IconContext.Provider>
                                </Box>
                            </Box>
                        ) : null}
                        <Box
                            flexGrow="1"
                            overflow="hidden"
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
                                <Box>{typeDisplay.name}</Box>
                            </Box>
                            {result.title !== null && (
                                <Box
                                    overflow="hidden"
                                    fontSize={searchTitleFontSize}
                                    fontStyle="semi-bold"
                                    paddingBottom={
                                        result.bodyTextSnippet.length > 0
                                            ? searchTitleMarginBottom
                                            : undefined
                                    }
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
                                    {result.media?.type === "TaskCollectionColor" ? (
                                        <Box
                                            display="inline-flex"
                                            alignItems="center"
                                            style={{height: "1lh", verticalAlign: "top"}}
                                        >
                                            <Box
                                                width="2"
                                                height="2"
                                                marginRight="1.5"
                                                borderRadius="full"
                                                backgroundColor={getTaskCollectionColor(
                                                    result.media.color,
                                                )}
                                            />
                                        </Box>
                                    ) : null}
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
                                                    color: "grey-100",
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
    name: string;
    isAccountMediaAuthor?: boolean;
    iconMedia?: ReactNode;
};

// NOTE(calebmer): The icons used here for create actions are the same icons
// used in `<SpaceLayoutSideBarCreateButton/>`. If you change an icon here you
// should also change it there.
function getSearchResultTypeDisplay(resultId: SearchResultId): SearchResultTypeDisplay {
    switch (resultId) {
        case "CreateChat":
        case "CreateChatMessage": {
            return {
                name: "Action",
                iconMedia: <ChatsCircle />,
            };
        }
        case "CreatePost": {
            return {
                name: "Action",
                iconMedia: <EnvelopeOpen />,
            };
        }
        case "CreateDocument": {
            return {
                name: "Action",
                iconMedia: <FileText />,
            };
        }
        case "CreateTask": {
            return {
                name: "Action",
                iconMedia: <ListChecks />,
            };
        }
        case "CreateChannel": {
            return {
                name: "Action",
                iconMedia: <Hash />,
            };
        }
        case "CreateTaskCollection": {
            return {
                name: "Action",
                iconMedia: <Table />,
            };
        }
        case "CreateTaskView": {
            return {
                name: "Action",
                iconMedia: <Funnel />,
            };
        }
        case "TaskNotepad": {
            // We label the task notepad as a task "collection" since it is a collection of
            // tasks. We need some label and ideally it's not "Task notepad" since that's
            // the same as the title.
            return getSearchResultTypeDisplayForEntity("TaskCollection");
        }
        case "TaskQueryFilteredToCreatorIsCurrentAccount":
        case "TaskQueryFilteredToAssigneeIsCurrentAccount":
        case "TaskQueryFilteredToAssigneeIsCurrentAccountAndAssigneeStatusIsActive":
        case "TaskQueryFilteredToAssignerIsCurrentAccount": {
            return {name: "Task view"};
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
            return {name: "Person"};
        }
        case "Document": {
            return {name: "Document"};
        }
        case "DocumentComment": {
            return {
                name: "Document comment",
                isAccountMediaAuthor: true,
            };
        }
        case "Channel": {
            return {name: "Channel"};
        }
        case "Post": {
            return {
                name: "Post",
                isAccountMediaAuthor: true,
            };
        }
        case "PostComment": {
            return {
                name: "Post comment",
                isAccountMediaAuthor: true,
            };
        }
        case "Chat": {
            return {name: "Chat"};
        }
        case "ChatMessage": {
            return {
                name: "Chat message",
                isAccountMediaAuthor: true,
            };
        }
        case "Task": {
            return {name: "Task"};
        }
        case "TaskCollection": {
            return {name: "Task collection"};
        }
        default:
            throw exhaustive(type);
    }
}

const searchResultMediaViewSize = "9";

function SearchResultMediaView({media}: {media: SearchResultMedia}) {
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
        case "TaskCollectionColor": {
            // We render task collection color media next to the collection name. Not in
            // the standard media space.
            return null;
        }
        default:
            throw exhaustive(media);
    }

    return (
        <Box
            flexShrink="0"
            position="relative"
            width={searchResultMediaViewSize}
            height={searchResultMediaViewSize}
            display="flex"
            alignItems="center"
            justifyContent="center"
        >
            {node}
        </Box>
    );
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
                    borderRadius="md"
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
                    borderRadius: "base",
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
