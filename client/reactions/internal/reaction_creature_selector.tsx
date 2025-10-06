import {CaretLeft, CaretRight, SpinnerGap} from "phosphor-react";
import {RefObject, useMemo, useRef, useState} from "react";
import {usePress} from "react-aria";
import {flushSync} from "react-dom";
import {useAccountModel, useAccountRegistry} from "~/client/accounts/account_registry_context.js";
import {useAppContext} from "~/client/context/app_context.js";
import {Box} from "~/client/design/box.js";
import {IconButton} from "~/client/design/icon_button.js";
import {useReporter} from "~/client/design/reporter.js";
import {useDelayLoadingIndicator} from "~/client/design/use_delay_loading_indicator.js";
import {ReactionIcon} from "~/client/reactions/internal/reaction_icon.js";
import {sortReactionCreaturesAroundOurCreature} from "~/client/reactions/internal/sort_reaction_creatures_around_our_creature.js";
import {getSpacingScaleWithoutListening} from "~/client/remix/spacing_scale_context.js";
import {useSpaceContextAndRequireSpaceAccess} from "~/client/spaces/space_context.js";
import {
    backgroundColorVar,
    colorSchemeVars,
    spinAnimationClassName,
} from "~/client/styles/styles.js";
import {addRemLengths, convertRemLengthToPx, spacing} from "~/shared/design/core/spacing.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {isRangeContained} from "~/shared/helpers/geometry/is_range_contained.js";
import {getLegacyFallbackReactionCreatureForId} from "~/shared/reactions/get_legacy_fallback_reaction_creature_for_id.js";
import {ReactionCreature} from "~/shared/reactions/reaction.js";
import {updateAccountReactionCreature} from "~/shared/rpc/accounts_rpc_definitions.js";

const marginX = "3";

const iconButtonSize = "6";
const iconButtonGap = "1";
const mainCreatureIconSize = "12";

const width = addRemLengths(
    marginX,
    iconButtonSize,
    iconButtonGap,
    mainCreatureIconSize,
    iconButtonGap,
    iconButtonSize,
    marginX,
);

// Make sure the entire component sums up to a width of spacing `32`.
assert(width === spacing["32"]);

export function ReactionCreatureSelector() {
    const context = useAppContext();
    const {currentAccount} = useSpaceContextAndRequireSpaceAccess();
    const reporter = useReporter();
    const accountRegistry = useAccountRegistry();

    const carouselRef = useRef<HTMLDivElement>(null);
    const ourCreatureCarouselItemRef = useRef<HTMLDivElement>(null);

    const currentAccountData = useAccountModel(currentAccount);

    const ourCreature = useMemo(
        () =>
            currentAccountData.reactionCreature ??
            getLegacyFallbackReactionCreatureForId(currentAccount.id),
        [currentAccount.id, currentAccountData.reactionCreature],
    );

    // `useState()` instead of `useMemo()` since we want to calculate this on mount
    // then keep it the same after that.
    const [creatures] = useState(() => sortReactionCreaturesAroundOurCreature(ourCreature));

    const creatureIndex = useMemo(() => {
        return creatures.findIndex(
            creature =>
                creature.type === ourCreature.type && creature.variant === ourCreature.variant,
        );
    }, [creatures, ourCreature]);

    const [pendingCreatureFromCarousel, setPendingCreatureFromCarousel] =
        useState<ReactionCreature | null>(null);
    const shouldShowPendingFromCarousel = useDelayLoadingIndicator(!!pendingCreatureFromCarousel);

    return (
        <Box
            paddingX={marginX}
            // We add some padding bottom to counteract the empty space at the top of the
            // component created by the reaction icon. Useful when centering vertically.
            paddingBottom="1.5"
            style={{width}}
        >
            <Box display="flex" alignItems="center" gap={iconButtonGap} paddingBottom="1.5">
                <IconButton
                    size="md"
                    description="Previous character"
                    pressErrorTitle="Couldn’t update your character"
                    onPress={async () => {
                        const nextCreature =
                            creatureIndex > 0
                                ? creatures[creatureIndex - 1]!
                                : creatures[creatures.length - 1]!;

                        const {account} = await updateAccountReactionCreature(context, {
                            creature: nextCreature,
                        });

                        flushSync(() => {
                            accountRegistry.immediatelyUpdateAccountStoreIfExists(account);
                        });

                        // The `flushSync()` function above forces React to re-render synchronously.
                        // So we should be getting the correct newly selected element here.

                        const carouselElement = assertExists(carouselRef.current);
                        const ourCreatureCarouselItemElement = assertExists(
                            ourCreatureCarouselItemRef.current,
                        );

                        const spacingScale = getSpacingScaleWithoutListening();
                        const marginXPx = convertRemLengthToPx(marginX, spacingScale);

                        if (
                            !isRangeContained(
                                carouselElement.scrollLeft,
                                carouselElement.scrollLeft + carouselElement.clientWidth,
                                ourCreatureCarouselItemElement.offsetLeft - marginXPx,
                                ourCreatureCarouselItemElement.offsetLeft +
                                    ourCreatureCarouselItemElement.offsetWidth +
                                    marginXPx,
                            )
                        ) {
                            carouselElement.scrollLeft =
                                ourCreatureCarouselItemElement.offsetLeft +
                                ourCreatureCarouselItemElement.offsetWidth +
                                marginXPx -
                                carouselElement.clientWidth;
                        }
                    }}
                >
                    <CaretLeft />
                </IconButton>
                <ReactionIcon
                    reaction={{creature: ourCreature, emotion: "Happy"}}
                    size={mainCreatureIconSize}
                />
                <IconButton
                    size="md"
                    description="Next character"
                    pressErrorTitle="Couldn’t update your character"
                    onPress={async () => {
                        const nextCreature =
                            creatureIndex < creatures.length - 1
                                ? creatures[creatureIndex + 1]!
                                : creatures[0]!;

                        const {account} = await updateAccountReactionCreature(context, {
                            creature: nextCreature,
                        });

                        flushSync(() => {
                            accountRegistry.immediatelyUpdateAccountStoreIfExists(account);
                        });

                        // The `flushSync()` function above forces React to re-render synchronously.
                        // So we should be getting the correct newly selected element here.

                        const carouselElement = assertExists(carouselRef.current);
                        const ourCreatureCarouselItemElement = assertExists(
                            ourCreatureCarouselItemRef.current,
                        );

                        const spacingScale = getSpacingScaleWithoutListening();
                        const marginXPx = convertRemLengthToPx(marginX, spacingScale);

                        if (
                            !isRangeContained(
                                carouselElement.scrollLeft,
                                carouselElement.scrollLeft + carouselElement.clientWidth,
                                ourCreatureCarouselItemElement.offsetLeft - marginXPx,
                                ourCreatureCarouselItemElement.offsetLeft +
                                    ourCreatureCarouselItemElement.offsetWidth +
                                    marginXPx,
                            )
                        ) {
                            carouselElement.scrollLeft =
                                ourCreatureCarouselItemElement.offsetLeft - marginXPx;
                        }
                    }}
                >
                    <CaretRight />
                </IconButton>
            </Box>
            <Box position="relative" zIndex="0" marginX={`-${marginX}`} style={{width}}>
                <Box
                    position="absolute"
                    zIndex="10"
                    left="0"
                    top="0"
                    bottom="0"
                    width={marginX}
                    style={{
                        background: `linear-gradient(to right, ${backgroundColorVar} ${spacing["1"]},  transparent)`,
                    }}
                />
                <Box
                    position="absolute"
                    zIndex="10"
                    right="0"
                    top="0"
                    bottom="0"
                    width={marginX}
                    style={{
                        background: `linear-gradient(to left, ${backgroundColorVar} ${spacing["1"]},  transparent)`,
                    }}
                />
                <Box ref={carouselRef} data-scrollbar="false" overflowX="scroll" style={{width}}>
                    <Box paddingX={marginX} display="flex" style={{gap: 1, width: "fit-content"}}>
                        {creatures.map(creature => {
                            const isOurCreature =
                                creature.type === ourCreature.type &&
                                creature.variant === ourCreature.variant;

                            const isPendingCreatureFromCarousel =
                                pendingCreatureFromCarousel !== null &&
                                creature.type === pendingCreatureFromCarousel.type &&
                                creature.variant === pendingCreatureFromCarousel.variant;

                            return (
                                <ReactionCreatureSelectorCarouselItem
                                    key={`${creature.type}-${creature.variant}`}
                                    itemRef={isOurCreature ? ourCreatureCarouselItemRef : undefined}
                                    creature={creature}
                                    isActive={
                                        pendingCreatureFromCarousel !== null
                                            ? isPendingCreatureFromCarousel
                                            : isOurCreature
                                    }
                                    isPending={
                                        isPendingCreatureFromCarousel &&
                                        shouldShowPendingFromCarousel
                                    }
                                    onPress={() => {
                                        if (isOurCreature) return;
                                        if (pendingCreatureFromCarousel) return;

                                        setPendingCreatureFromCarousel(creature);

                                        (async () => {
                                            const {account} = await updateAccountReactionCreature(
                                                context,
                                                {creature},
                                            );

                                            accountRegistry.immediatelyUpdateAccountStoreIfExists(
                                                account,
                                            );
                                        })().then(
                                            () => {
                                                setPendingCreatureFromCarousel(null);
                                            },
                                            error => {
                                                setPendingCreatureFromCarousel(null);

                                                reporter.displayError(
                                                    "Couldn’t update your character",
                                                    error,
                                                );
                                            },
                                        );
                                    }}
                                />
                            );
                        })}
                    </Box>
                </Box>
            </Box>
        </Box>
    );
}

function ReactionCreatureSelectorCarouselItem({
    itemRef,
    creature,
    isActive,
    isPending,
    onPress,
}: {
    itemRef: RefObject<HTMLDivElement> | undefined;
    creature: ReactionCreature;
    isActive: boolean;
    isPending: boolean;
    onPress: () => void;
}) {
    const {isPressed, pressProps} = usePress({onPress});

    return (
        <Box
            {...pressProps}
            ref={itemRef}
            flexShrink="0"
            width="6"
            height="6"
            display="flex"
            justifyContent="center"
            alignItems="center"
            backgroundColor={isPressed ? "grey-10" : isActive ? "grey-5" : undefined}
            borderRadius="1"
        >
            {isPending ? (
                <SpinnerGap
                    className={spinAnimationClassName}
                    size={spacing["4"]}
                    color={colorSchemeVars["grey-70"]}
                />
            ) : (
                <ReactionIcon reaction={{creature, emotion: "Happy"}} size="6" />
            )}
        </Box>
    );
}
