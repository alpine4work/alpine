import {ReactionEmotion} from "~/shared/reactions/reaction.js";
import {reactionEmotionById, reactionEmotionIds} from "~/shared/reactions/reaction_emotion_id.js";
import {Schema, SchemaDeserializationError} from "~/shared/schema/schema.open_source.js";

export const ReactionEmotionSchema = Schema.integer.transform<ReactionEmotion>({
    serialize: emotion => reactionEmotionIds[emotion],
    deserialize: emotionId => {
        const emotion = reactionEmotionById.get().get(emotionId);
        if (!emotion) throw new SchemaDeserializationError("Invalid reaction emotion ID");
        return emotion;
    },
});
