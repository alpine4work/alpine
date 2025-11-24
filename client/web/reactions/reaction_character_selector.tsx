import {CaretLeft, CaretRight, SpinnerGap} from "phosphor-react";
import {RefObject, useMemo, useRef, useState} from "react";
import {usePress} from "react-aria";
import {flushSync} from "react-dom";
import {
    useAccountModel,
    useAccountRegistry,
} from "~/client/web/accounts/account_registry_context.js";
import {useAppContext} from "~/client/web/context/app_context.js";
import {Box} from "~/client/web/design/box.js";
import {IconButton} from "~/client/web/design/icon_button.js";
import {useReporter} from "~/client/web/design/reporter.js";
import {useDelayLoadingIndicator} from "~/client/web/design/use_delay_loading_indicator.js";
import {ReactionIcon} from "~/client/web/reactions/icons/reaction_icon.js";
import {sortReactionCharactersAroundOurCharacter} from "~/client/web/reactions/internal/sort_reaction_characters_around_our_character.js";
import {getSpacingScaleWithoutListening} from "~/client/web/remix/spacing_scale_context.js";
import {useSpaceContextAndRequireSpaceAccess} from "~/client/web/spaces/space_context.js";
import {
    backgroundColorVar,
    colorSchemeVars,
    spinAnimationClassName,
} from "~/client/web/styles/styles.js";
import {addRemLengths, convertRemLengthToPx, spacing} from "~/shared/design/core/spacing.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {isRangeContained} from "~/shared/helpers/geometry/is_range_contained.js";
import {getLegacyFallbackReactionCharacterForId} from "~/shared/reactions/get_legacy_fallback_reaction_character_for_id.js";
import {ReactionCharacter} from "~/shared/reactions/reaction.js";
import {updateAccountReactionCharacter} from "~/shared/rpc/accounts_rpc_definitions.js";

const marginX = "3";

const iconButtonSize = "6";
const iconButtonGap = "1";
const mainCharacterIconSize = "12";

const width = addRemLengths(
    marginX,
    iconButtonSize,
    iconButtonGap,
    mainCharacterIconSize,
    iconButtonGap,
    iconButtonSize,
    marginX,
);

// Make sure the entire component sums up to a width of spacing `32`.
assert(width === spacing["32"]);

export function ReactionCharacterSelector() {
    const context = useAppContext();
    const {currentAccount} = useSpaceContextAndRequireSpaceAccess();
    const reporter = useReporter();
    const accountRegistry = useAccountRegistry();

    const carouselRef = useRef<HTMLDivElement>(null);
    const ourCharacterCarouselItemRef = useRef<HTMLDivElement>(null);

    const currentAccountData = useAccountModel(currentAccount);

    const ourCharacter = useMemo(
        () =>
            currentAccountData.reactionCharacter ??
            getLegacyFallbackReactionCharacterForId(currentAccount.id),
        [currentAccount.id, currentAccountData.reactionCharacter],
    );

    // `useState()` instead of `useMemo()` since we want to calculate this on mount
    // then keep it the same after that.
    const [characters] = useState(() => sortReactionCharactersAroundOurCharacter(ourCharacter));

    const characterIndex = useMemo(() => {
        return characters.findIndex(
            character =>
                character.type === ourCharacter.type && character.variant === ourCharacter.variant,
        );
    }, [characters, ourCharacter]);

    const [pendingCharacterFromCarousel, setPendingCharacterFromCarousel] =
        useState<ReactionCharacter | null>(null);
    const shouldShowPendingFromCarousel = useDelayLoadingIndicator(!!pendingCharacterFromCarousel);

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
                        const nextCharacter =
                            characterIndex > 0
                                ? characters[characterIndex - 1]!
                                : characters[characters.length - 1]!;

                        const {account} = await updateAccountReactionCharacter(context, {
                            character: nextCharacter,
                        });

                        flushSync(() => {
                            accountRegistry.immediatelyUpdateAccountStoreIfExists(account);
                        });

                        // The `flushSync()` function above forces React to re-render synchronously.
                        // So we should be getting the correct newly selected element here.

                        const carouselElement = assertExists(carouselRef.current);
                        const ourCharacterCarouselItemElement = assertExists(
                            ourCharacterCarouselItemRef.current,
                        );

                        const spacingScale = getSpacingScaleWithoutListening();
                        const marginXPx = convertRemLengthToPx(marginX, spacingScale);

                        if (
                            !isRangeContained(
                                carouselElement.scrollLeft,
                                carouselElement.scrollLeft + carouselElement.clientWidth,
                                ourCharacterCarouselItemElement.offsetLeft - marginXPx,
                                ourCharacterCarouselItemElement.offsetLeft +
                                    ourCharacterCarouselItemElement.offsetWidth +
                                    marginXPx,
                            )
                        ) {
                            carouselElement.scrollLeft =
                                ourCharacterCarouselItemElement.offsetLeft +
                                ourCharacterCarouselItemElement.offsetWidth +
                                marginXPx -
                                carouselElement.clientWidth;
                        }
                    }}
                >
                    <CaretLeft />
                </IconButton>
                <ReactionIcon
                    reaction={{character: ourCharacter, emotion: "Happy"}}
                    size={mainCharacterIconSize}
                />
                <IconButton
                    size="md"
                    description="Next character"
                    pressErrorTitle="Couldn’t update your character"
                    onPress={async () => {
                        const nextCharacter =
                            characterIndex < characters.length - 1
                                ? characters[characterIndex + 1]!
                                : characters[0]!;

                        const {account} = await updateAccountReactionCharacter(context, {
                            character: nextCharacter,
                        });

                        flushSync(() => {
                            accountRegistry.immediatelyUpdateAccountStoreIfExists(account);
                        });

                        // The `flushSync()` function above forces React to re-render synchronously.
                        // So we should be getting the correct newly selected element here.

                        const carouselElement = assertExists(carouselRef.current);
                        const ourCharacterCarouselItemElement = assertExists(
                            ourCharacterCarouselItemRef.current,
                        );

                        const spacingScale = getSpacingScaleWithoutListening();
                        const marginXPx = convertRemLengthToPx(marginX, spacingScale);

                        if (
                            !isRangeContained(
                                carouselElement.scrollLeft,
                                carouselElement.scrollLeft + carouselElement.clientWidth,
                                ourCharacterCarouselItemElement.offsetLeft - marginXPx,
                                ourCharacterCarouselItemElement.offsetLeft +
                                    ourCharacterCarouselItemElement.offsetWidth +
                                    marginXPx,
                            )
                        ) {
                            carouselElement.scrollLeft =
                                ourCharacterCarouselItemElement.offsetLeft - marginXPx;
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
                        {characters.map(character => {
                            const isOurCharacter =
                                character.type === ourCharacter.type &&
                                character.variant === ourCharacter.variant;

                            const isPendingCharacterFromCarousel =
                                pendingCharacterFromCarousel !== null &&
                                character.type === pendingCharacterFromCarousel.type &&
                                character.variant === pendingCharacterFromCarousel.variant;

                            return (
                                <ReactionCharacterSelectorCarouselItem
                                    key={`${character.type}-${character.variant}`}
                                    itemRef={
                                        isOurCharacter ? ourCharacterCarouselItemRef : undefined
                                    }
                                    character={character}
                                    isActive={
                                        pendingCharacterFromCarousel !== null
                                            ? isPendingCharacterFromCarousel
                                            : isOurCharacter
                                    }
                                    isPending={
                                        isPendingCharacterFromCarousel &&
                                        shouldShowPendingFromCarousel
                                    }
                                    onPress={() => {
                                        if (isOurCharacter) return;
                                        if (pendingCharacterFromCarousel) return;

                                        setPendingCharacterFromCarousel(character);

                                        (async () => {
                                            const {account} = await updateAccountReactionCharacter(
                                                context,
                                                {character},
                                            );

                                            accountRegistry.immediatelyUpdateAccountStoreIfExists(
                                                account,
                                            );
                                        })().then(
                                            () => {
                                                setPendingCharacterFromCarousel(null);
                                            },
                                            error => {
                                                setPendingCharacterFromCarousel(null);

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

function ReactionCharacterSelectorCarouselItem({
    itemRef,
    character,
    isActive,
    isPending,
    onPress,
}: {
    itemRef: RefObject<HTMLDivElement | null> | undefined;
    character: ReactionCharacter;
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
                <ReactionIcon reaction={{character: character, emotion: "Happy"}} size="6" />
            )}
        </Box>
    );
}
