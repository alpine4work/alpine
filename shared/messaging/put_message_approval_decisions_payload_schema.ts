import {MessageExperimentalApprovalDecisionValueWithoutDeciderSchema} from "~/shared/messaging/message_schema.js";
import {Schema, SchemaType} from "~/shared/schema/schema.js";

export type PutMessageApprovalDecisionsPayload = SchemaType<
    typeof PutMessageApprovalDecisionsPayloadSchema
>;

/**
 * The decisions recorded by a `putMessageApprovalDecisions` procedure call.
 *
 * This is a discriminated union so the approval flow can evolve while it's
 * experimental. When the flow graduates we can add a new variant (and eventually
 * retire `ExperimentalDecisions`) without changing the procedure shape. All four
 * messaging surfaces share this payload schema, so new variants reach every
 * surface without touching their protocol definitions.
 */
export const PutMessageApprovalDecisionsPayloadSchema = Schema.union({
    ExperimentalDecisions: Schema.object({
        type: Schema.value("ExperimentalDecisions"),
        decisions: Schema.array(
            Schema.object({
                index: Schema.integer.min(0),
                value: MessageExperimentalApprovalDecisionValueWithoutDeciderSchema,
            }),
        ),
    }),
});
