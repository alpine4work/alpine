import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {Reaction, ReactionCharacter, ReactionEmotion} from "~/shared/reactions/reaction.js";

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
        default:
            throw exhaustive(character);
    }
}

function getReactionEmotionAltText(emotion: ReactionEmotion): string {
    switch (emotion) {
        case "Celebrate":
            return "celebrating";
        case "DeadInside":
            return "who’s dead inside";
        case "Hardship":
            return "who’s sad";
        case "Happy":
            return "who’s happy";
        case "Laugh":
            return "laughing";
        case "Lolsob":
            return "laughing while crying";
        case "No":
            return "holding a sign saying “no”";
        case "Shock":
            return "in shock";
        case "Yes":
            return "holding a sign saying “yes”";
        default:
            throw exhaustive(emotion);
    }
}
