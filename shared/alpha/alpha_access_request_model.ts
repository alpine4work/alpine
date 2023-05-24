import {AccountId} from "~/shared/id/types/id_types";
import {LabelStringSchema} from "~/shared/schema/label_string_schema";
import {Model} from "~/shared/schema/model/model";
import {Schema} from "~/shared/schema/schema";

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
        emailAddress: LabelStringSchema,
        message: Schema.string,
        decision: AlphaAccessRequestDecisionSchema.nullable(),
    }),
) {}
