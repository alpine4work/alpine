import {ReactionCreature} from "~/shared/reactions/reaction.js";
import {
    reactionCreatureById,
    reactionCreatureIds,
} from "~/shared/reactions/reaction_creature_id.js";
import {Schema, SchemaDeserializationError} from "~/shared/schema/schema.js";

export const ReactionCreatureSchema = Schema.integer.transform<ReactionCreature>({
    serialize: creature => (reactionCreatureIds as any)[creature.type][creature.variant],
    deserialize: creatureId => {
        const creature = reactionCreatureById.get().get(creatureId);
        if (!creature) throw new SchemaDeserializationError("Invalid reaction creature ID");
        return creature;
    },
});
