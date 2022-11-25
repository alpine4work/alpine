import {LabelStringSchema} from "~/shared/schema/label_string_schema";
import {Model} from "~/shared/schema/model";
import {Schema} from "~/shared/schema/schema";

export const AlphaAccessRequestDecisionSchema = Schema.union({
    Approved: Schema.object({
        type: Schema.value("Approved"),
        approvedByAccountId: Schema.id,
        accountId: Schema.id,
    }),
    Denied: Schema.object({
        type: Schema.value("Denied"),
        deniedByAccountId: Schema.id,
    }),
});

export class AlphaAccessRequestModel extends Model(
    Schema.object({
        createdTime: Schema.date,
        name: LabelStringSchema,
        emailAddress: LabelStringSchema,
        message: Schema.string,
        decision: AlphaAccessRequestDecisionSchema.nullable(),
    }),
) {}
