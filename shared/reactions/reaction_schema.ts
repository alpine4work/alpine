import {Reaction, getValueByReaction} from "~/shared/reactions/reaction.js";
import {reactionById, reactionIds} from "~/shared/reactions/reaction_id.js";
import {Schema, SchemaDeserializationError} from "~/shared/schema/schema.js";

export const ReactionSchema = Schema.integer.transform<Reaction>({
    serialize: reaction => getValueByReaction(reactionIds, reaction),
    deserialize: reactionId => {
        const reaction = reactionById.get().get(reactionId);
        if (!reaction) throw new SchemaDeserializationError("Invalid reaction ID");
        return reaction;
    },
});
