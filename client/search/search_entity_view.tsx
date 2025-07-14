import {assignInlineVars} from "@vanilla-extract/dynamic";
import escapeHtml from "escape-html";
import {Link as LinkIcon} from "phosphor-react";
import {Fragment, useMemo} from "react";
import {AccountShortName} from "~/client/accounts/account_short_name.js";
import {Box} from "~/client/design/box.js";
import {ContextMenuActions} from "~/client/design/context_menu.js";
import {MenuAction} from "~/client/design/menu.js";
import {OverlayTriggerButton} from "~/client/design/overlay_trigger_button.js";
import {Spacer} from "~/client/design/spacer.js";
import {renderTextWithEmojiFontFamily} from "~/client/helpers/render_text_with_emoji_font_family.js";
import {writeTextToClipboard} from "~/client/helpers/write_text_to_clipboard.js";
import {useSpacingScale} from "~/client/remix/spacing_scale_context.js";
import {useSearchEntityModel} from "~/client/search/core/search_entity_registry_context.js";
import {getSearchEntityTypeDisplay} from "~/client/search/core/search_entity_type_display.js";
import {
    SearchEntityViewTitle,
    SearchEntityViewTitlePrefix,
} from "~/client/search/core/search_entity_view_title.js";
import {
    searchEntityViewBodyTextSnippetFontSize,
    searchEntityViewBodyTextSnippetMinHeight,
    searchEntityViewDefaultMarginX,
    searchEntityViewDefaultPaddingX,
    searchEntityViewMinHeightPx,
    searchEntityViewPaddingY,
    searchEntityViewTitleMarginBottom,
} from "~/client/styles/search_shared_styles.js";
import {
    Sprinkles,
    backgroundColorVar,
    colorSchemeVars,
    greyElevated2ClassName,
    searchStyles,
    sprinkles,
} from "~/client/styles/styles.js";
import {Spacing, convertRemLengthToPx, spacing} from "~/shared/design/core/spacing.js";
import {countIterable} from "~/shared/helpers/iterable/count_iterable.js";
import {iterateEmojis} from "~/shared/helpers/string/iterate_emojis.js";
import {MaybePromise} from "~/shared/helpers/types/maybe_promise.js";
import {OpensearchSearchHitExplanation} from "~/shared/opensearch/opensearch_search_hit_explanation.js";
import {
    SearchAffinityEntityResultModel,
    SearchEntityResultModel,
} from "~/shared/search/search_entity_result_model.js";

export function SearchEntityView({
    result,
    isSelected = false,
    isPressed = false,
    withMarginTop = false,
    withMarginBottom = false,
    onPressStart,
    onDoubleClick,
    getCopyPath,
    onRemoveFromFavorites,
    onRemoveFromSuggested,
    marginX = searchEntityViewDefaultMarginX,
    paddingX = searchEntityViewDefaultPaddingX,
}: {
    result: SearchEntityResultModel | SearchAffinityEntityResultModel;
    isSelected?: boolean;
    isPressed?: boolean;
    withMarginTop?: boolean;
    withMarginBottom?: boolean;
    onPressStart?: () => void;
    onDoubleClick?: () => void;
    getCopyPath?: () => string;
    onRemoveFromFavorites?: () => MaybePromise<void>;
    onRemoveFromSuggested?: () => MaybePromise<void>;
    marginX?: Spacing;
    paddingX?: Sprinkles["paddingX"];
}) {
    const spacingScale = useSpacingScale();

    const entityData = useSearchEntityModel(result.model);
    const typeDisplay = useMemo(() => getSearchEntityTypeDisplay(result.id), [result.id]);
    const showTitle =
        (entityData.title !== null ||
            // If there's no body snippet and we have a `null` title then showing the title
            // will render "Deleted ${entityNoun}". For example, tasks in the suggested
            // list render in this state once they've been deleted.
            !result.bodyTextSnippet) &&
        typeDisplay.type !== "Post";

    const contextMenuActions: Array<Array<MenuAction>> = [];

    if (getCopyPath) {
        contextMenuActions.push([
            {
                label: "Copy link",
                icon: <LinkIcon />,
                iconPlacement: "end",
                pressErrorTitle: "Couldn’t copy link",
                onPress: async () => {
                    const path = getCopyPath();
                    const url = new URL(path, window.location.href);
                    await writeTextToClipboard(url.toString());
                },
            },
        ]);
    }

    if (onRemoveFromFavorites) {
        contextMenuActions.push([
            {
                label: "Remove from favorites",
                pressErrorTitle: "Couldn’t remove from favorites",
                onPress: onRemoveFromFavorites,
            },
        ]);
    }

    if (onRemoveFromSuggested) {
        contextMenuActions.push([
            {
                label: "Remove from suggested",
                pressErrorTitle: "Couldn’t remove from suggested",
                onPress: onRemoveFromSuggested,
            },
        ]);
    }

    return (
        <ContextMenuActions actions={contextMenuActions}>
            <Box
                paddingX={marginX}
                style={{
                    // Tiny detail: The search modal's input renders its border on top of the first
                    // search entity view. So for it to look like the first search entity has the
                    // same Y margin as it does X margin we need to add an extra pixel of margin.
                    paddingTop: withMarginTop
                        ? convertRemLengthToPx("1", spacingScale) + 1
                        : undefined,
                    paddingBottom: withMarginBottom ? spacing["1"] : undefined,
                    minHeight: searchEntityViewMinHeightPx[spacingScale],
                }}
                onPointerDown={event => {
                    // Presses in a modal outside our element tree shouldn't select the search
                    // entity. This happens when clicking to close an overlay opened by
                    // `<SearchEntityViewExplainDebugWidget>`.
                    if (
                        event.target instanceof Element &&
                        event.currentTarget.contains(event.target)
                    ) {
                        onPressStart?.();
                    }
                }}
                onDoubleClick={event => {
                    // Presses in a modal outside our element tree shouldn't select the search
                    // entity. This happens when clicking to close an overlay opened by
                    // `<SearchEntityViewExplainDebugWidget>`.
                    if (
                        event.target instanceof Element &&
                        event.currentTarget.contains(event.target)
                    ) {
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
                        paddingY={searchEntityViewPaddingY}
                        style={{
                            minHeight: searchEntityViewMinHeightPx[spacingScale],
                        }}
                    >
                        {showTitle && (
                            <>
                                <SearchEntityViewTitle
                                    typeDisplay={typeDisplay}
                                    entityData={entityData}
                                />
                                {result.bodyTextSnippet && result.bodyTextSnippet.length > 0 && (
                                    <Spacer space={searchEntityViewTitleMarginBottom} />
                                )}
                            </>
                        )}
                        <Box
                            overflow="hidden"
                            color="grey-60"
                            fontSize={searchEntityViewBodyTextSnippetFontSize}
                            className={
                                !showTitle
                                    ? searchStyles.bodyTextSnippetWithoutTitleClassName
                                    : undefined
                            }
                            style={{
                                // Truncate after 3 lines of text. Unofficial syntax that works in all browsers
                                // except IE.
                                // https://stackoverflow.com/questions/3922739/limit-text-length-to-n-lines-using-css
                                display: "-webkit-box",
                                WebkitLineClamp: showTitle ? 3 : 4,
                                lineClamp: showTitle ? 3 : 4,
                                WebkitBoxOrient: "vertical",
                                textOverflow: "ellipsis",
                                // Render contextual alternate glyphs. Particularly important that we render
                                // the right "@" for mentions.
                                // eslint-disable-next-line string-quotes
                                fontFeatureSettings: '"calt" on',
                                minHeight: !showTitle
                                    ? searchEntityViewBodyTextSnippetMinHeight
                                    : undefined,
                            }}
                        >
                            {!showTitle && (
                                <SearchEntityViewTitlePrefix
                                    icon={typeDisplay.icon}
                                    entityData={entityData}
                                />
                            )}
                            {typeDisplay.isAccountMediaAuthor &&
                            entityData.media?.type === "Account" ? (
                                <>
                                    <AccountShortName
                                        account={entityData.media.account}
                                        isTooltipDisabled={true}
                                    />
                                    {typeDisplay.type === "Post" ? " " : ": "}
                                </>
                            ) : null}
                            {result.bodyTextSnippet?.map(({isHighlighted, text}, index) => {
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
                        <SearchEntityViewExplainDebugWidget explanation={result.explanation} />
                    )}
                </Box>
            </Box>
        </ContextMenuActions>
    );
}

function SearchEntityViewExplainDebugWidget({
    explanation,
}: {
    explanation: OpensearchSearchHitExplanation;
}) {
    // When we add to a search entity score using factors other than OpenSearch
    // BM25 we include an emoji to communicate this is a "smart" score addition. We
    // use a sparkle for semantic search and a heart for search entities the user
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
                    <SearchEntityViewExplainDebugWidgetOverlay explanation={explanation} />
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

function SearchEntityViewExplainDebugWidgetOverlay({
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
    /* eslint-disable string-quotes */

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

    /* eslint-enable string-quotes */
}
