import {cast} from "~/shared/helpers/control/cast.js";
import {getObjectKeysWithKeyofType} from "~/shared/helpers/object/get_object_keys_with_keyof_type.js";
import {mapObjectValues} from "~/shared/helpers/object/map_object_values.js";

/**
 * An icon selected by the user to react to some content. Can be an emotion
 * from any of our characters.
 *
 * Right now each character has each emotion but we may allow characters to
 * have different emotions in the future.
 *
 * In the product reactions are referred to as "likes". Normally we strive for
 * names in code to be the same as names in the product. But in this case we're
 * quite unsure about the name "like" in the product. "Reaction" is the
 * standard name for this feature so choosing to use the name "reaction" in
 * code for now.
 */
export type Reaction = {
    readonly character: ReactionCharacter;
    readonly emotion: ReactionEmotion;
};

/**
 * An emotion a character can have.
 */
export type ReactionEmotion =
    | "Celebrate"
    | "DeadInside"
    | "Hardship"
    | "Happy"
    | "Laugh"
    | "Lolsob"
    | "No"
    | "Shock"
    | "Yes";

export const allReactionEmotions: ReadonlyArray<ReactionEmotion> = getObjectKeysWithKeyofType(
    cast<Record<ReactionEmotion, true>>({
        Celebrate: true,
        DeadInside: true,
        Hardship: true,
        Happy: true,
        Laugh: true,
        Lolsob: true,
        No: true,
        Shock: true,
        Yes: true,
    }),
);

export type ReactionCharacterType = ReactionCharacter["type"];

export type ReactionCatCharacterVariant = "Grey" | "Pink" | "Yellow";

export type ReactionTreeCharacterVariant = "Blue" | "Green" | "Pink";

export type ReactionYetiCharacterVariant = "Blue" | "Brown" | "Olive";

/**
 * The character used for a reaction icon. We have different character types
 * with some slight variants (basic recolors mostly).
 */
export type ReactionCharacter =
    | {readonly type: "Cat"; readonly variant: ReactionCatCharacterVariant}
    | {readonly type: "Tree"; readonly variant: ReactionTreeCharacterVariant}
    | {readonly type: "Yeti"; readonly variant: ReactionYetiCharacterVariant};

const allReactionCharacters: ReactionCharacterMap<true> = {
    Cat: {Grey: true, Pink: true, Yellow: true},
    Tree: {Blue: true, Green: true, Pink: true},
    Yeti: {Blue: true, Brown: true, Olive: true},
};

export const allReactionCharacterTypes: ReadonlyArray<ReactionCharacterType> =
    getObjectKeysWithKeyofType(allReactionCharacters);

export const allReactionCharacterVariantsByType: {
    readonly [Type in ReactionCharacterType]: Readonly<
        ReadonlyArray<Extract<ReactionCharacter, {readonly type: Type}>["variant"]>
    >;
} = mapObjectValues(allReactionCharacters, getObjectKeysWithKeyofType) as any;

/**
 * Are the two reactions equal to one another?
 */
export function areReactionsEqual(
    reaction1: Reaction | "GenericLike" | undefined,
    reaction2: Reaction | "GenericLike" | undefined,
): boolean {
    if (reaction1 === undefined) {
        if (reaction2 === undefined) return true;
        return false;
    } else if (reaction2 === undefined) {
        return false;
    }

    if (reaction1 === "GenericLike") {
        if (reaction2 === "GenericLike") return true;
        return false;
    } else if (reaction2 === "GenericLike") {
        return false;
    }

    return (
        reaction1.character.type === reaction2.character.type &&
        reaction1.character.variant === reaction2.character.variant &&
        reaction1.emotion === reaction2.emotion
    );
}

/**
 * An exhaustive map that lists each of our reaction characters.
 */
export type ReactionCharacterMap<Value> = {
    readonly [Type in ReactionCharacterType]: {
        readonly [Variant in Extract<ReactionCharacter, {readonly type: Type}>["variant"]]: Value;
    };
};

/**
 * Get a value for a reaction character from a reaction character map.
 */
export function getValueByReactionCharacter<Value>(
    map: ReactionCharacterMap<Value>,
    character: ReactionCharacter,
): Value {
    return (map as any)[character.type][character.variant];
}

/**
 * Transforms values in a `ReactionCharacterMap` from one type to another.
 */
export function mapReactionCharacterMap<Value, NewValue>(
    map: ReactionCharacterMap<Value>,
    mapper: (value: Value) => NewValue,
): ReactionCharacterMap<NewValue> {
    return mapObjectValues(map, value1 =>
        mapObjectValues(value1, value2 => mapper(value2)),
    ) as ReactionCharacterMap<NewValue>;
}

/**
 * An exhaustive map that lists each of our reactions.
 */
export type ReactionMap<Value> = ReactionCharacterMap<Record<ReactionEmotion, Value>>;

/**
 * Get a value for a reaction from a reaction map.
 */
export function getValueByReaction<Value>(map: ReactionMap<Value>, reaction: Reaction): Value {
    return (map as any)[reaction.character.type][reaction.character.variant][reaction.emotion];
}

/**
 * Transforms values in a `ReactionMap` from one type to another.
 */
export function mapReactionMap<Value, NewValue>(
    map: ReactionMap<Value>,
    mapper: (value: Value) => NewValue,
): ReactionMap<NewValue> {
    return mapObjectValues(map, value1 =>
        mapObjectValues(value1, value2 => mapObjectValues(value2, value3 => mapper(value3))),
    ) as ReactionMap<NewValue>;
}
