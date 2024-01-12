import {Schema, SchemaType} from "~/shared/schema/schema.js";

/**
 * A maintenance job description is similar to `JobDescription` but not scoped
 * to a particular space. Generally prefer `JobDescription`s since permissions
 * are locked down to one space.
 *
 * You use a maintenance job to perform work like database cleanup.
 */
export type MaintenanceJobDescription = SchemaType<typeof MaintenanceJobDescriptionSchema>;

export const MaintenanceJobDescriptionSchema = Schema.union({
    /**
     * This job is queued every few minutes so if we failed to process a
     * task action transaction it can be processed by the job.
     *
     * It's imperative that all task action transactions are processed in a timely
     * manner. Inconsistent data between our task DynamoDB table and OpenSearch
     * index leads to bugs, there's even a risk of security bugs! If an action that
     * updates an access policy is not processed.
     */
    RetryUnprocessedTaskActionTransactions: Schema.object({
        type: Schema.value("RetryUnprocessedTaskActionTransactions"),
    }),
});
