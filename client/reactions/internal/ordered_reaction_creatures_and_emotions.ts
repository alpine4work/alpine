import {cast} from "~/shared/helpers/control/cast.js";
import {getObjectKeysWithKeyofType} from "~/shared/helpers/object/get_object_keys_with_keyof_type.js";
import {
    ReactionCreature,
    ReactionCreatureType,
    ReactionEmotion,
} from "~/shared/reactions/reaction.js";

/**
 * Reaction creatures ordered for display in the UI.
 */
export const orderedReactionCreatures: ReadonlyArray<ReactionCreature> = Object.values(
    cast<{
        readonly [Type in ReactionCreatureType]: {
            readonly [Variant in Extract<ReactionCreature, {readonly type: Type}>["variant"]]: {
                readonly type: Type;
                readonly variant: Variant;
            };
        };
    }>({
        Yeti: {
            Blue: {type: "Yeti", variant: "Blue"},
            Brown: {type: "Yeti", variant: "Brown"},
            Olive: {type: "Yeti", variant: "Olive"},
        },
        Cat: {
            Yellow: {type: "Cat", variant: "Yellow"},
            Pink: {type: "Cat", variant: "Pink"},
            Grey: {type: "Cat", variant: "Grey"},
        },
        Tree: {
            Blue: {type: "Tree", variant: "Blue"},
            Green: {type: "Tree", variant: "Green"},
            Pink: {type: "Tree", variant: "Pink"},
        },
    }),
).flatMap(Object.values);

/**
 * Reaction emotions ordered for display in the UI.
 */
export const orderedReactionEmotions: ReadonlyArray<ReactionEmotion> = getObjectKeysWithKeyofType(
    cast<Record<ReactionEmotion, true>>({
        Happy: true,
        Laugh: true,
        Celebrate: true,
        Yes: true,
        No: true,
        Lolsob: true,
        Shock: true,
        DeadInside: true,
        Hardship: true,
    }),
);
