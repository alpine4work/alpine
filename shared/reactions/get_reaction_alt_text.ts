import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {Reaction, ReactionCreature, ReactionEmotion} from "~/shared/reactions/reaction.js";

export function getReactionAltText(icon: Reaction): string {
    return (
        getReactionCreatureAltText(icon.creature) + " " + getReactionEmotionAltText(icon.emotion)
    );
}

function getReactionCreatureAltText(creature: ReactionCreature): string {
    switch (creature.type) {
        case "Cat": {
            switch (creature.variant) {
                case "Grey":
                    return "Grey cat";
                case "Pink":
                    return "Pink cat";
                case "Yellow":
                    return "Yellow cat";
                default:
                    throw exhaustive(creature);
            }
        }
        case "Tree": {
            switch (creature.variant) {
                case "Blue":
                    return "Blue tree";
                case "Green":
                    return "Green tree";
                case "Pink":
                    return "Pink tree";
                default:
                    throw exhaustive(creature);
            }
        }
        case "Yeti": {
            switch (creature.variant) {
                case "Blue":
                    return "Blue yeti";
                case "Brown":
                    return "Brown yeti";
                case "Olive":
                    return "Olive yeti";
                default:
                    throw exhaustive(creature);
            }
        }
        default:
            throw exhaustive(creature);
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
