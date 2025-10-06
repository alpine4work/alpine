/* eslint-disable string-quotes */

import {useId, useMemo} from "react";
import {usePress} from "react-aria";
import {useAccountRegistry} from "~/client/accounts/account_registry_context.js";
import {useContentBlockWidth} from "~/client/content/content_block_width.js";
import {Box} from "~/client/design/box.js";
import {FocusRing} from "~/client/design/focus_ring.js";
import {Tooltip} from "~/client/design/tooltip.js";
import {useStore} from "~/client/helpers/use_store.js";
import {reactionIconSvgs} from "~/client/reactions/icons/reaction_icon_svgs.js";
import {
    ReactionEntry,
    layoutReactionParty,
} from "~/client/reactions/internal/layout_reaction_party.js";
import {ReactionIcon} from "~/client/reactions/internal/reaction_icon.js";
import {useClientInfo} from "~/client/remix/client_info_context.js";
import {useSpacingScale} from "~/client/remix/spacing_scale_context.js";
import {useLazyLoadRpc} from "~/client/rpc/use_lazy_load_rpc.js";
import {useSpaceContextAndRequireSpaceAccess} from "~/client/spaces/space_context.js";
import {postContentViewFooterHeight} from "~/client/styles/forum_shared_styles.js";
import {getAccountShortNameWithoutFullNameTooltip} from "~/shared/accounts/get_account_short_name_without_full_name_tooltip.js";
import {colors} from "~/shared/design/core/colors.js";
import {parseRemLength, spacing} from "~/shared/design/core/spacing.js";
import {remPxBySpacingScale} from "~/shared/design/core/spacing_scale.js";
import {joinPrettyConjunctionList} from "~/shared/design/join_pretty_conjunction_list.js";
import {emptyArray} from "~/shared/helpers/array/empty_array.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {Lazy} from "~/shared/helpers/control/lazy.js";
import {filterMapIterable} from "~/shared/helpers/iterable/filter_map_iterable.js";
import {sliceIterable} from "~/shared/helpers/iterable/slice_iterable.js";
import {printPrettyNumber} from "~/shared/helpers/number/print_pretty_number.js";
import {StableRandom} from "~/shared/helpers/number/stable_random.js";
import {getReactionInMap, mapReactionMap} from "~/shared/reactions/reaction.js";
import {ReactionSet} from "~/shared/reactions/reaction_set.js";
import {expensivelyGetAllSpaceAccounts} from "~/shared/rpc/spaces_rpc_definitions.js";
import {AccountModel} from "~/shared/spaces/account_model.js";
import {computeStore} from "~/shared/store/compute_store.js";

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
    const s = n.toFixed(3);

    if (/\.000$/.test(s)) {
        return s.slice(0, -4);
    } else if (/\.[1-9]00$/.test(s)) {
        return s.slice(0, -2);
    } else if (/\.[1-9][1-9]0$/.test(s)) {
        return s.slice(0, -1);
    } else {
        return s;
    }
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

export function ReactionParty({
    reactions,
    randomSeed,
}: {
    reactions: ReactionSet;
    randomSeed: string;
}) {
    const spacingScale = useSpacingScale();
    const {space, currentAccount} = useSpaceContextAndRequireSpaceAccess();

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

        const partyWidthFirstRowReactionEntryCount =
            firstRowReactionEntries.length +
            (secondRowReactionEntries.length >= firstRowReactionEntries.length ? 1 : 0);

        const partyWidth =
            iconSize * partyWidthFirstRowReactionEntryCount +
            firstRowGap * (partyWidthFirstRowReactionEntryCount - 1);

        const partyWidthRem = partyWidth * (iconSizeRem / iconSize);

        const viewBox = `0 ${round3(partyViewBoxY)} ${round3(partyWidth)} ${round3(partyHeight)}`;

        // Don't render anything if there are no reactions.
        if (reactionEntries.length === 0) {
            return {reactionEntries, node: null};
        }

        // Special rendering for a single reaction that puts the reaction in the middle
        // of the post footer instead of on a second line.
        if (reactionEntries.length === 1) {
            // If the only reaction is our current account's reaction then don't render
            // anything. Our current account's reaction will already be visible on
            // `<ReactionButton>`.
            if (currentAccount.id === reactionEntries[0]!.accountId) {
                return {reactionEntries, node: null};
            }

            return {
                reactionEntries,
                widthStyle: `${round3(partyWidthRem)}rem`,
                node: (
                    <Box position="relative" top="-0.5">
                        <ReactionIcon
                            reaction={firstRowReactionEntries[0]!.reaction}
                            size={iconSizeSpacing}
                        />
                    </Box>
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
                        top: `calc(50% - ${spacing["1"]})`,
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
    }, [blockWidth, currentAccount.id, idBase, randomSeed, reactions, spacingScale]);

    const allAccounts =
        useLazyLoadRpc(
            expensivelyGetAllSpaceAccounts,
            reactionEntries.length > 0 ? {spaceId: space.id} : null,
            {
                // Only fetch our space accounts once. Won't refetch as subsequent
                // `<ReactionParty>` components mount. Also won't refetch if the user hides the
                // window then comes back.
                //
                // We render `<ReactionParty>` a lot so we don't want it making a bunch of RPC
                // calls every time it mounts.
                onlyFetchIfNotAvailable: true,
            },
        ).output?.accounts ?? emptyArray;

    const {isPressed, pressProps} = usePress({});

    if (!node) return null;

    return (
        <Tooltip
            placement="top-start"
            content={
                <ReactionPartyTooltipContent
                    allAccounts={allAccounts}
                    currentAccount={currentAccount}
                    reactions={reactions}
                />
            }
        >
            <FocusRing insetTop={reactionEntries.length > 1 ? "-1.5" : undefined}>
                <Box
                    {...pressProps}
                    tabIndex={0}
                    position="relative"
                    zIndex="0"
                    height={postContentViewFooterHeight}
                    opacity={isPressed ? "60" : undefined}
                    style={{width: widthStyle}}
                >
                    {node}
                </Box>
            </FocusRing>
        </Tooltip>
    );
}

function ReactionPartyTooltipContent({
    allAccounts,
    currentAccount,
    reactions,
}: {
    allAccounts: ReadonlyArray<AccountModel>;
    currentAccount: AccountModel;
    reactions: ReactionSet;
}) {
    const {locale} = useClientInfo();
    const accountRegistry = useAccountRegistry();

    const string = useStore(
        useMemo(() => {
            const reactionsMap = reactions.get();

            return computeStore(get => {
                const maxAccountNameCount = 4;

                const accountNames = Array.from(
                    sliceIterable(
                        // Iterate through `allAccounts` which should be in affinity order so we show
                        // accounts the user has the most affinity for first.
                        filterMapIterable(allAccounts, account =>
                            account.id !== currentAccount.id && reactionsMap.has(account.id)
                                ? getAccountShortNameWithoutFullNameTooltip(
                                      get(accountRegistry.getAccountStore(account)),
                                  )
                                : undefined,
                        ),
                        0,
                        maxAccountNameCount,
                    ),
                );

                if (reactionsMap.has(currentAccount.id)) {
                    accountNames.unshift("you");
                }

                // Use the unknown account name for any accounts we didn't find in
                // `allAccounts`.
                while (
                    accountNames.length < maxAccountNameCount &&
                    reactionsMap.size > accountNames.length
                ) {
                    accountNames.push(AccountModel.getUnknown().initialData.name);
                }

                if (reactionsMap.size > accountNames.length) {
                    accountNames.push(
                        printPrettyNumber(locale, reactionsMap.size - accountNames.length, "other"),
                    );
                }

                return `Liked by ${joinPrettyConjunctionList(accountNames)}`;
            });
        }, [accountRegistry, allAccounts, currentAccount.id, locale, reactions]),
    );

    return <>{string}</>;
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
        const iconSvg = getReactionInMap(reactionIconUnwrappedSvgs, reaction).get();

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
    // calculated independently from the first row. Otherwise if we add a reaction
    // to the first row then it'll change the offsets for all reactions in the
    // second row that come before it.
    iconTranslateYRandomIndex = 0;
    previousIconTranslateY = undefined;

    for (let index = 0; index < secondRowReactionEntries.length; index++) {
        const {reaction} = secondRowReactionEntries[index]!;
        const iconSvg = getReactionInMap(reactionIconUnwrappedSvgs, reaction).get();

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
<feMorphology operator="dilate" radius="8" result="morphology" />
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
