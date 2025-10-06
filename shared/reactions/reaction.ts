import {cast} from "~/shared/helpers/control/cast.js";
import {getObjectKeysWithKeyofType} from "~/shared/helpers/object/get_object_keys_with_keyof_type.js";
import {mapObjectValues} from "~/shared/helpers/object/map_object_values.js";

/**
 * An icon selected by the user to react to some content. Can be an emotion
 * from any of our creatures.
 *
 * Right now each creature has each emotion but we may allow creatures to have
 * different emotions in the future.
 */
export type Reaction = {
    readonly creature: ReactionCreature;
    readonly emotion: ReactionEmotion;
};

/**
 * An emotion a creature can have.
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

export type ReactionCreatureType = ReactionCreature["type"];

export type ReactionCatCreatureVariant = "Grey" | "Pink" | "Yellow";

export type ReactionTreeCreatureVariant = "Blue" | "Green" | "Pink";

export type ReactionYetiCreatureVariant = "Blue" | "Brown" | "Olive";

/**
 * The creature used for a reaction icon. We have different creature types with
 * some slight variants (basic recolors mostly).
 */
export type ReactionCreature =
    | {readonly type: "Cat"; readonly variant: ReactionCatCreatureVariant}
    | {readonly type: "Tree"; readonly variant: ReactionTreeCreatureVariant}
    | {readonly type: "Yeti"; readonly variant: ReactionYetiCreatureVariant};

const allReactionCreatures: {
    readonly [Type in ReactionCreatureType]: Readonly<
        Record<Extract<ReactionCreature, {readonly type: Type}>["variant"], true>
    >;
} = {
    Cat: {Grey: true, Pink: true, Yellow: true},
    Tree: {Blue: true, Green: true, Pink: true},
    Yeti: {Blue: true, Brown: true, Olive: true},
};

export const allReactionCreatureTypes: ReadonlyArray<ReactionCreatureType> =
    getObjectKeysWithKeyofType(allReactionCreatures);

export const allReactionCreatureVariantsByType: {
    readonly [Type in ReactionCreatureType]: Readonly<
        ReadonlyArray<Extract<ReactionCreature, {readonly type: Type}>["variant"]>
    >;
} = mapObjectValues(allReactionCreatures, getObjectKeysWithKeyofType) as any;

/**
 * An exhaustive map that lists each of our reaction icons.
 */
export type ReactionMap<Value> = {
    readonly [Type in ReactionCreatureType]: Readonly<
        Record<
            Extract<ReactionCreature, {readonly type: Type}>["variant"],
            Record<ReactionEmotion, Value>
        >
    >;
};

/**
 * Get a value for a reaction from a map.
 */
export function getReactionInMap<Value>(map: ReactionMap<Value>, icon: Reaction): Value {
    return (map as any)[icon.creature.type][icon.creature.variant][icon.emotion];
}

/**
 * Transforms a `ReactionMap` from one value to another.
 */
export function mapReactionMap<Value, NewValue>(
    map: ReactionMap<Value>,
    mapper: (value: Value) => NewValue,
): ReactionMap<NewValue> {
    return mapObjectValues(map, value1 =>
        mapObjectValues(value1, value2 => mapObjectValues(value2, value3 => mapper(value3))),
    ) as ReactionMap<NewValue>;
}
