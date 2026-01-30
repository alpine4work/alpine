import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {
    Reaction,
    ReactionCharacter,
    ReactionCharacterType,
    ReactionEmotion,
} from "~/shared/reactions/reaction.js";

export function getReactionAltText(icon: Reaction): string {
    return (
        getReactionCharacterAltText(icon.character) + " " + getReactionEmotionAltText(icon.emotion)
    );
}

function getReactionCharacterAltText(character: ReactionCharacter): string {
    switch (character.type) {
        case "Cat": {
            switch (character.variant) {
                case "Grey":
                    return "Grey cat";
                case "Pink":
                    return "Pink cat";
                case "Yellow":
                    return "Yellow cat";
                default:
                    throw exhaustive(character);
            }
        }
        case "Tree": {
            switch (character.variant) {
                case "Blue":
                    return "Blue tree";
                case "Green":
                    return "Green tree";
                case "Pink":
                    return "Pink tree";
                default:
                    throw exhaustive(character);
            }
        }
        case "Yeti": {
            switch (character.variant) {
                case "Blue":
                    return "Blue yeti";
                case "Brown":
                    return "Brown yeti";
                case "Olive":
                    return "Olive yeti";
                default:
                    throw exhaustive(character);
            }
        }
        case "Frog": {
            switch (character.variant) {
                case "Green":
                    return "Green frog";
                case "Cyan":
                    return "Cyan frog";
                case "Yellow":
                    return "Yellow frog";
            }
        }
        case "Pigeon": {
            switch (character.variant) {
                case "Plain":
                    return "Pigeon";
                case "Brown":
                    return "Brown pigeon";
                case "Grey":
                    return "Grey pigeon";
                default:
                    throw exhaustive(character);
            }
        }
        case "Tulip": {
            switch (character.variant) {
                case "Yellow":
                    return "Yellow tulip";
                case "Pink":
                    return "Pink tulip";
                case "Violet":
                    return "Violet tulip";
                default:
                    throw exhaustive(character);
            }
        }
        default:
            throw exhaustive(character);
    }
}

function getReactionEmotionAltText(emotion: ReactionEmotion): string {
    switch (emotion) {
        case "Celebrate":
            return "celebrating";
        case "DeadInside":
            return "who\u2019s dead inside";
        case "Hardship":
            return "who\u2019s sad";
        case "Happy":
            return "who\u2019s happy";
        case "Laugh":
            return "laughing";
        case "Lolsob":
            return "laughing while crying";
        case "Shock":
            return "in shock";
        case "Heart":
            return "holding a heart";
        case "Yes":
            return "holding a sign saying \u201Cyes\u201D";
        case "No":
            return "holding a sign saying \u201Cno\u201D";
        case "ThankYou":
            return "holding a sign saying \u201Cthank you\u201D";
        default:
            throw exhaustive(emotion);
    }
}

export function getReactionCharacterTypeAltText(characterType: ReactionCharacterType): string {
    switch (characterType) {
        case "Cat":
            return "Cat";
        case "Tree":
            return "Tree";
        case "Yeti":
            return "Yeti";
        case "Frog":
            return "Frog";
        case "Pigeon":
            return "Pigeon";
        case "Tulip":
            return "Tulip";
        default:
            throw exhaustive(characterType);
    }
}
