import {AccountId} from "~/shared/id/types/id_types.open_source.js";
import {LabelStringSchema} from "~/shared/schema/helpers/label_string_schema.js";
import {Model} from "~/shared/schema/model/model.js";
import {Schema} from "~/shared/schema/schema.js";

export const AlphaAccessRequestDecisionSchema = Schema.union({
    Approved: Schema.object({
        type: Schema.value("Approved"),
        approvedByAccountId: Schema.id<AccountId>(),
        accountId: Schema.id<AccountId>(),
    }),
    Denied: Schema.object({
        type: Schema.value("Denied"),
        deniedByAccountId: Schema.id<AccountId>(),
    }),
});

export class AlphaAccessRequestModel extends Model(
    Schema.object({
        createdTime: Schema.date,
        name: LabelStringSchema,
        emailAddress: Schema.string,
        message: Schema.string,
        decision: AlphaAccessRequestDecisionSchema.nullable(),
    }),
) {}
