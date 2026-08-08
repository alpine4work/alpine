import {createRynamoEventSchema} from "~/shared/dynamo/rynamo_types.js";
import {Model} from "~/shared/schema/model/model.js";
import {Schema} from "~/shared/schema/schema.open_source.js";
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

const RynamoSpellCheckIgnoredEventSchema = createRynamoEventSchema(
    SpellCheckIgnoredLintModel.schema(),
);

export const SpellCheckIgnoredLintRealtimeTransactionSchema = Schema.object({
    events: Schema.array(RynamoSpellCheckIgnoredEventSchema),
});
