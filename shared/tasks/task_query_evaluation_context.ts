import {AccountId} from "~/shared/id/types/id_types.open_source.js";
import {Schema, SchemaType} from "~/shared/schema/schema.open_source.js";
import {CalendarDateSchema} from "~/shared/tasks/calendar_date_schema.js";

/**
 * Some contextually relevant information we need while evaluating a query. For
 * example, filters relative to the current date need the current date.
 */
export type TaskQueryEvaluationContext = SchemaType<typeof TaskQueryEvaluationContextSchema>;

export const TaskQueryEvaluationContextSchema = Schema.object({
    currentAccountId: Schema.id<AccountId>().nullable(),
    currentDate: CalendarDateSchema,
});
