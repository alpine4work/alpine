import {orderedReactionCharacters} from "~/client/web/reactions/ordered_reaction_characters_and_emotions.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {ReactionCharacter} from "~/shared/reactions/reaction.js";

export function sortReactionCharactersAroundOurCharacter(
    ourCharacter: ReactionCharacter,
): ReadonlyArray<ReactionCharacter> {
    const characters: Array<ReactionCharacter> = [];

    const ourCharacterIndex = orderedReactionCharacters.findIndex(
        otherCharacter =>
            otherCharacter.type === ourCharacter.type &&
            otherCharacter.variant === ourCharacter.variant,
    );
    assert(ourCharacterIndex !== -1);

    for (let index = ourCharacterIndex; index < orderedReactionCharacters.length; index++) {
        const otherCharacter = orderedReactionCharacters[index]!;
        characters.push(otherCharacter);
    }

    let sameCharacterTypeInsertionIndex = 1;

    for (let index = 0; index < ourCharacterIndex; index++) {
        const otherCharacter = orderedReactionCharacters[index]!;

        if (otherCharacter.type === ourCharacter.type) {
            characters.splice(sameCharacterTypeInsertionIndex, 0, otherCharacter);
            sameCharacterTypeInsertionIndex++;
        } else {
            characters.push(otherCharacter);
        }
    }

    return characters;
}
