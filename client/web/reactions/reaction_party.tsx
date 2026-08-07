import {useId, useMemo} from "react";
import {usePress} from "react-aria";
import {useContentBlockWidth} from "~/client/web/content/content_block_width.js";
import {ContextMenuActions} from "~/client/web/design/context_menu.js";
import {FocusRing} from "~/client/web/design/focus_ring.js";
import {ReactionIcon} from "~/client/web/reactions/icons/reaction_icon.js";
import {reactionIconSvgs} from "~/client/web/reactions/icons/reaction_icon_svgs.js";
import {
    ReactionEntry,
    layoutReactionParty,
} from "~/client/web/reactions/internal/layout_reaction_party.js";
import {ReactionTooltip} from "~/client/web/reactions/internal/reaction_tooltip.js";
import {reactionButtonContextMenuActionKey} from "~/client/web/reactions/reaction_button.js";
import {useSpacingScale} from "~/client/web/remix/spacing_scale_context.js";
import {postContentViewFooterHeight} from "~/client/web/styles/forum_shared_styles.js";
import {colors} from "~/shared/design/core/colors.js";
import {
    Spacing,
    parseRemLength,
    spacing,
    subtractRemLengths,
} from "~/shared/design/core/spacing.js";
import {remPxBySpacingScale} from "~/shared/design/core/spacing_scale.open_source.js";
import {assert} from "~/shared/helpers/control/assert.open_source.js";
import {Lazy} from "~/shared/helpers/control/lazy.open_source.js";
import {StableRandom} from "~/shared/helpers/number/stable_random.open_source.js";
import {toFixedWithoutTrailingZeros} from "~/shared/helpers/number/to_fixed_without_trailing_zeros.open_source.js";
import {getValueByReaction, mapReactionMap} from "~/shared/reactions/reaction.js";
import {ReactionSet} from "~/shared/reactions/reaction_set.js";

const iconSize = 256;
const iconSizeSpacing = "8";
const iconSizeRem = parseRemLength(iconSizeSpacing);
const iconMinTranslateYSteps = -1;
const iconMaxTranslateYSteps = 1;
const iconTranslateYStep = 8;

const firstRowGap = -48;
const firstRowGapRem = firstRowGap * (iconSizeRem / iconSize);

const secondRowScale = 0.95;
const secondRowTranslateX = -24;
const secondRowTranslateY = -96;

const partyViewBoxY = secondRowTranslateY;

const partyHeight = iconSize - secondRowTranslateY;
const partyHeightRem = partyHeight * (iconSizeRem / iconSize);

function round3(n: number): string {
    return toFixedWithoutTrailingZeros(n, 3);
}

const reactionIconUnwrappedSvgs = mapReactionMap(
    reactionIconSvgs,
    svg =>
        new Lazy(() => {
            // Asserts make sure our `replace()` actually does something.
            const unwrappedSvg1 = svg.replace(/^<svg [^>]*>\n+/, "");
            assert(unwrappedSvg1.length < svg.length);
            const unwrappedSvg2 = unwrappedSvg1.replace(/\n+<\/svg>$/, "");
            assert(unwrappedSvg2.length < unwrappedSvg1.length);
            return unwrappedSvg2;
        }),
);

function useReactionParty({
    reactions,
    randomSeed,
    offsetTopIfManyReactions = "0",
}: {
    reactions: ReactionSet;
    randomSeed: string;
    offsetTopIfManyReactions?: Spacing;
}) {
    const spacingScale = useSpacingScale();

    const idBase = useId();

    const blockWidth = useContentBlockWidth();

    const {reactionEntries, widthStyle, node} = useMemo(() => {
        const remPx = remPxBySpacingScale[spacingScale];

        const firstRowMaxReactionEntryCount = Math.floor(
            (blockWidth + firstRowGapRem * remPx) / (iconSizeRem * remPx + firstRowGapRem * remPx),
        );

        const maxReactionEntryCount =
            firstRowMaxReactionEntryCount + firstRowMaxReactionEntryCount - 1;

        const {reactionEntries, firstRowReactionEntries, secondRowReactionEntries} =
            layoutReactionParty(maxReactionEntryCount, reactions);

        const partyWidth = Math.max(
            iconSize * firstRowReactionEntries.length +
                firstRowGap * (firstRowReactionEntries.length - 1),
            iconSize / 2 +
                iconSize * secondRowReactionEntries.length +
                firstRowGap * (secondRowReactionEntries.length - 1),
        );

        const partyWidthRem = partyWidth * (iconSizeRem / iconSize);

        const viewBox = `0 ${round3(partyViewBoxY)} ${round3(partyWidth)} ${round3(partyHeight)}`;

        // Don't render anything if there are no reactions.
        if (reactionEntries.length === 0) {
            return {reactionEntries, node: null};
        }

        // Special rendering for a single reaction that puts the reaction in the middle of
        // the post footer instead of on a second line.
        if (reactionEntries.length === 1) {
            return {
                reactionEntries,
                widthStyle: `${round3(partyWidthRem)}rem`,
                node: (
                    <div style={{position: "relative", top: `-${spacing["0.5"]}`}}>
                        <ReactionIcon
                            reaction={firstRowReactionEntries[0]!.reaction}
                            size={iconSizeSpacing}
                        />
                    </div>
                ),
            };
        }

        const stableRandom = new StableRandom(`ReactionParty:${randomSeed}`);

        return {
            reactionEntries,
            widthStyle: `${round3(partyWidthRem)}rem`,
            node: (
                <svg
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox={viewBox}
                    style={{
                        position: "absolute",
                        left: "0",
                        top: `calc(50% - ${subtractRemLengths(
                            spacing["1"],
                            offsetTopIfManyReactions,
                        )})`,
                        transform: "translateY(-50%)",
                        width: `${round3(partyWidthRem)}rem`,
                        height: `${round3(partyHeightRem)}rem`,
                    }}
                    dangerouslySetInnerHTML={{
                        __html: renderReactionPartySvg({
                            idBase,
                            stableRandom,
                            firstRowReactionEntries,
                            secondRowReactionEntries,
                        }),
                    }}
                />
            ),
        };
    }, [blockWidth, idBase, offsetTopIfManyReactions, randomSeed, reactions, spacingScale]);

    return {
        reactionEntries,
        widthStyle,
        node,
    };
}

export function ReactionParty({
    reactions,
    randomSeed,
    onPress,
    offsetTopIfManyReactions = "0",
}: {
    reactions: ReactionSet;
    randomSeed: string;
    onPress: () => void;
    offsetTopIfManyReactions?: Spacing;
}) {
    const {reactionEntries, widthStyle, node} = useReactionParty({
        reactions,
        randomSeed,
        offsetTopIfManyReactions,
    });

    const {isPressed, pressProps} = usePress({onPress});

    if (!node) return null;

    return (
        <ReactionTooltip reactions={reactionEntries}>
            <ContextMenuActions
                actions={[
                    [
                        {
                            key: reactionButtonContextMenuActionKey,
                            label: "See reactions",
                            pressErrorTitle: "Couldn\u2019t open reactions",
                            onPress,
                        },
                    ],
                ]}
            >
                <FocusRing insetTop={reactionEntries.length > 1 ? "-1.5" : undefined}>
                    <div
                        {...pressProps}
                        tabIndex={0}
                        style={{
                            position: "relative",
                            zIndex: "0",
                            height: spacing[postContentViewFooterHeight],
                            opacity: isPressed ? 0.6 : undefined,
                            width: widthStyle,
                        }}
                    >
                        {node}
                    </div>
                </FocusRing>
            </ContextMenuActions>
        </ReactionTooltip>
    );
}

export function ReactionPartyBase({
    reactions,
    randomSeed,
    offsetTopIfManyReactions = "0",
}: {
    reactions: ReactionSet;
    randomSeed: string;
    offsetTopIfManyReactions?: Spacing;
}) {
    const {widthStyle, node} = useReactionParty({
        reactions,
        randomSeed,
        offsetTopIfManyReactions,
    });

    if (!node) return null;

    return (
        <div
            style={{
                position: "relative",
                zIndex: "0",
                height: spacing[postContentViewFooterHeight],
                width: widthStyle,
            }}
        >
            {node}
        </div>
    );
}

function renderReactionPartySvg({
    idBase,
    stableRandom,
    firstRowReactionEntries,
    secondRowReactionEntries,
}: {
    idBase: string;
    stableRandom: StableRandom;
    firstRowReactionEntries: ReadonlyArray<ReactionEntry>;
    secondRowReactionEntries: ReadonlyArray<ReactionEntry>;
}) {
    let firstRowSvg = "";
    let secondRowSvg = "";

    let previousIconTranslateY: number | undefined;
    let iconTranslateYRandomIndex = 0;

    for (let index = 0; index < firstRowReactionEntries.length; index++) {
        const {reaction} = firstRowReactionEntries[index]!;
        const iconSvg = getValueByReaction(reactionIconUnwrappedSvgs, reaction).get();

        let iconTranslateY: number | undefined;

        do {
            iconTranslateY =
                stableRandom.randomInteger(
                    "firstRowIconTranslateY",
                    iconTranslateYRandomIndex++,
                    iconMinTranslateYSteps,
                    iconMaxTranslateYSteps + 1,
                ) * iconTranslateYStep;
        } while (iconTranslateY === previousIconTranslateY);

        previousIconTranslateY = iconTranslateY;

        const translateX = round3(index * iconSize + index * firstRowGap);
        const translateY = round3(iconTranslateY);

        firstRowSvg += `<g transform="translate(${translateX}, ${translateY})">\n${iconSvg}\n</g>\n`;
    }

    // Make sure to reset `iconTranslateYRandomIndex`. Second row offsets should be
    // calculated independently from the first row. Otherwise if we add a reaction to
    // the first row then it'll change the offsets for all reactions in the second row
    // that come before it.
    iconTranslateYRandomIndex = 0;
    previousIconTranslateY = undefined;

    for (let index = 0; index < secondRowReactionEntries.length; index++) {
        const {reaction} = secondRowReactionEntries[index]!;
        const iconSvg = getValueByReaction(reactionIconUnwrappedSvgs, reaction).get();

        let iconTranslateY: number | undefined;

        do {
            iconTranslateY =
                stableRandom.randomInteger(
                    "secondRowIconTranslateY",
                    iconTranslateYRandomIndex++,
                    iconMinTranslateYSteps,
                    iconMaxTranslateYSteps + 1,
                ) * iconTranslateYStep;
        } while (iconTranslateY === previousIconTranslateY);

        previousIconTranslateY = iconTranslateY;

        const translateX = round3(
            secondRowTranslateX +
                index * iconSize +
                index * firstRowGap +
                iconSize / 2 +
                (iconSize * (1 - secondRowScale)) / 2,
        );

        const translateY = round3(
            iconTranslateY + secondRowTranslateY + (iconSize * (1 - secondRowScale)) / 2,
        );

        secondRowSvg += `<g transform="translate(${translateX}, ${translateY}) scale(${secondRowScale})">\n${iconSvg}\n</g>\n`;
    }

    let svg = "";

    svg += `\
<filter id="${idBase}-filter">
<feMorphology operator="dilate" radius="12" result="morphology" />
<feFlood flood-color="${colors["grey-100"]}" flood-opacity="0.31" result="flood" />
<feComposite in="flood" in2="morphology" operator="in" />
</filter>
`;

    svg += `<mask id="${idBase}-mask" mask-type="alpha">\n${secondRowSvg}</mask>\n`;

    svg += secondRowSvg;

    svg += `<g mask="url(#${idBase}-mask)" filter="url(#${idBase}-filter)">\n${firstRowSvg}</g>\n`;

    svg += firstRowSvg;

    return svg;
}
