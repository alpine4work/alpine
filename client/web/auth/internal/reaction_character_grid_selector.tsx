import {setInteractionModality} from "@react-aria/interactions";
import {RefObject, createRef, useState} from "react";
import {usePress} from "react-aria";
import {Box} from "~/client/web/design/box.js";
import {FocusRing} from "~/client/web/design/focus_ring.js";
import {ReactionIcon} from "~/client/web/reactions/icons/reaction_icon.js";
import {orderedReactionCharactersByType} from "~/client/web/reactions/ordered_reaction_characters_and_emotions.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {getObjectEntriesWithKeyofType} from "~/shared/helpers/object/get_object_entries_with_keyof_type.js";
import {getReactionCharacterTypeAltText} from "~/shared/reactions/get_reaction_alt_text.js";
import {ReactionCharacter, areReactionCharactersEqual} from "~/shared/reactions/reaction.js";

const reactionCharacterGridSelectorItems = getObjectEntriesWithKeyofType(
    orderedReactionCharactersByType,
);

export function ReactionCharacterGridSelector({
    "aria-labelledby": ariaLabelledBy,
    character: selectedCharacter,
    onCharacterChange: onSelectedCharacterChange,
}: {
    "aria-labelledby": string;
    character: ReactionCharacter;
    onCharacterChange: (character: ReactionCharacter) => void;
}) {
    const [{refs, flatRefs}] = useState(() => {
        const refs = reactionCharacterGridSelectorItems.map(([, characters]) =>
            characters.map(() => createRef<HTMLDivElement>()),
        );

        const flatRefs = refs.flat();

        return {refs, flatRefs};
    });

    return (
        <Box
            role="listbox"
            aria-labelledby={ariaLabelledBy}
            aria-orientation="vertical"
            display="flex"
            flexDirection="row"
            gap="1"
            onKeyDown={event => {
                const currentFlatIndex = flatRefs.findIndex(
                    ref => ref?.current === document.activeElement,
                );
                assert(currentFlatIndex !== -1);

                switch (event.key) {
                    case "ArrowDown": {
                        event.preventDefault();
                        event.stopPropagation();

                        setInteractionModality("keyboard");

                        assertExists(
                            flatRefs[(flatRefs.length + (currentFlatIndex + 1)) % flatRefs.length]!
                                .current,
                        ).focus();
                        break;
                    }
                    case "ArrowUp": {
                        event.preventDefault();
                        event.stopPropagation();

                        setInteractionModality("keyboard");

                        assertExists(
                            flatRefs[(flatRefs.length + (currentFlatIndex - 1)) % flatRefs.length]!
                                .current,
                        ).focus();
                        break;
                    }
                    case "ArrowLeft": {
                        event.preventDefault();
                        event.stopPropagation();

                        const variantCount = reactionCharacterGridSelectorItems[0]![1].length;

                        setInteractionModality("keyboard");

                        assertExists(
                            flatRefs[
                                (flatRefs.length + (currentFlatIndex - variantCount)) %
                                    flatRefs.length
                            ]!.current,
                        ).focus();
                        break;
                    }
                    case "ArrowRight": {
                        event.preventDefault();
                        event.stopPropagation();

                        const variantCount = reactionCharacterGridSelectorItems[0]![1].length;

                        setInteractionModality("keyboard");

                        assertExists(
                            flatRefs[
                                (flatRefs.length + (currentFlatIndex + variantCount)) %
                                    flatRefs.length
                            ]!.current,
                        ).focus();
                        break;
                    }
                    case "Home": {
                        event.preventDefault();
                        event.stopPropagation();

                        setInteractionModality("keyboard");

                        assertExists(flatRefs[0]!.current).focus();
                        break;
                    }
                    case "End": {
                        event.preventDefault();
                        event.stopPropagation();

                        setInteractionModality("keyboard");

                        assertExists(flatRefs[flatRefs.length - 1]!.current).focus();
                        break;
                    }
                }
            }}
        >
            {reactionCharacterGridSelectorItems.map(([characterType, characters], index1) => (
                <Box
                    key={characterType}
                    role="group"
                    aria-label={getReactionCharacterTypeAltText(characterType)}
                    display="flex"
                    flexDirection="column"
                    gap="1"
                >
                    {characters.map((character, index2) => (
                        <ReactionCharacterGridSelectorItem
                            ref={refs[index1]![index2]!}
                            key={character.variant}
                            selectedCharacter={selectedCharacter}
                            onSelectedCharacterChange={onSelectedCharacterChange}
                            character={character}
                        />
                    ))}
                </Box>
            ))}
        </Box>
    );
}

function ReactionCharacterGridSelectorItem({
    ref,
    selectedCharacter,
    onSelectedCharacterChange,
    character,
}: {
    ref: RefObject<HTMLDivElement | null>;
    selectedCharacter: ReactionCharacter;
    onSelectedCharacterChange: (character: ReactionCharacter) => void;
    character: ReactionCharacter;
}) {
    const isSelected = areReactionCharactersEqual(selectedCharacter, character);

    const {pressProps, isPressed} = usePress({
        onPress: () => {
            onSelectedCharacterChange(character);
        },
    });

    return (
        <FocusRing offset="0">
            <Box
                {...pressProps}
                ref={ref}
                tabIndex={isSelected ? 0 : -1}
                role="option"
                aria-selected={isSelected}
                backgroundColor={isPressed ? "grey-10" : isSelected ? "grey-5" : undefined}
                borderRadius="1.5"
            >
                <ReactionIcon reaction={{character, emotion: "Happy"}} size="full" />
            </Box>
        </FocusRing>
    );
}
