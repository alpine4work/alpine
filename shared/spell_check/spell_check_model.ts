import {createDynamoGeneralRealtimeEventSchema} from "~/shared/dynamo/dynamo_general_realtime_types.js";
import {Model} from "~/shared/schema/model/model.js";
import {Schema} from "~/shared/schema/schema.js";
import {SpellCheckIgnoredLintSchema} from "~/shared/spell_check/spell_check_schema.js";

export class SpellCheckIgnoredLintModel extends Model(
    SpellCheckIgnoredLintSchema.merge(
        Schema.object({
            key: Schema.string,
            kind: Schema.string,
        }),
    ),
) {
    public asPreview() {
        return new SpellCheckIgnoredLintModel({
            createdTime: this.createdTime,
            creatorId: this.creatorId,
            key: this.key,
            kind: this.kind,
        });
    }
}

const DynamoGeneralRealtimeSpellCheckIgnoredEventSchema = createDynamoGeneralRealtimeEventSchema(
    SpellCheckIgnoredLintModel.schema(),
);

export const SpellCheckIgnoredLintRealtimeTransactionSchema = Schema.object({
    eventTransaction: Schema.array(DynamoGeneralRealtimeSpellCheckIgnoredEventSchema),
});
