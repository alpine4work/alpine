import {cast} from "~/shared/helpers/control/cast.open_source.js";
import {getObjectKeysWithKeyofType} from "~/shared/helpers/object/get_object_keys_with_keyof_type.open_source.js";
import {mapObjectValues} from "~/shared/helpers/object/map_object_values.js";
import {
    ReactionCharacter,
    ReactionCharacterType,
    ReactionEmotion,
} from "~/shared/reactions/reaction.js";

/**
 * Reaction characters ordered for display in the UI.
 */
export const orderedReactionCharactersByType: Record<
    ReactionCharacterType,
    ReadonlyArray<ReactionCharacter>
> = mapObjectValues(
    cast<{
        readonly [Type in ReactionCharacterType]: {
            readonly [Variant in Extract<ReactionCharacter, {readonly type: Type}>["variant"]]: {
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
            Green: {type: "Tree", variant: "Green"},
            Blue: {type: "Tree", variant: "Blue"},
            Pink: {type: "Tree", variant: "Pink"},
        },
        Pigeon: {
            Plain: {type: "Pigeon", variant: "Plain"},
            Brown: {type: "Pigeon", variant: "Brown"},
            Grey: {type: "Pigeon", variant: "Grey"},
        },
        Tulip: {
            Yellow: {type: "Tulip", variant: "Yellow"},
            Pink: {type: "Tulip", variant: "Pink"},
            Violet: {type: "Tulip", variant: "Violet"},
        },
        Frog: {
            Green: {type: "Frog", variant: "Green"},
            Cyan: {type: "Frog", variant: "Cyan"},
            Yellow: {type: "Frog", variant: "Yellow"},
        },
    }),
    value => Object.values(value),
);

/**
 * Reaction characters ordered for display in the UI.
 */
export const orderedReactionCharacters: ReadonlyArray<ReactionCharacter> = Object.values(
    orderedReactionCharactersByType,
).flat();

/**
 * Reaction emotions ordered for display in the UI.
 */
export const orderedReactionEmotions: ReadonlyArray<ReactionEmotion> = getObjectKeysWithKeyofType(
    cast<Record<ReactionEmotion, true>>({
        Happy: true,
        Laugh: true,
        Celebrate: true,
        Heart: true,
        Lolsob: true,
        Shock: true,
        DeadInside: true,
        Hardship: true,
        ThankYou: true,
        Yes: true,
        No: true,
    }),
);
