import {ReactionCharacter} from "~/shared/reactions/reaction.js";
import {
    reactionCharacterById,
    reactionCharacterIds,
} from "~/shared/reactions/reaction_character_id.js";
import {Schema, SchemaDeserializationError} from "~/shared/schema/schema.open_source.js";

export const ReactionCharacterSchema = Schema.integer.transform<ReactionCharacter>({
    serialize: character => (reactionCharacterIds as any)[character.type][character.variant],
    deserialize: characterId => {
        const character = reactionCharacterById.get().get(characterId);
        if (!character) throw new SchemaDeserializationError("Invalid reaction character ID");
        return character;
    },
});
