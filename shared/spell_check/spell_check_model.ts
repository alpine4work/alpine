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
