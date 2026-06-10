import {CalendarDate} from "@internationalized/date";
import {AccountId} from "~/shared/id/types/id_types.js";

/**
 * Some contextually relevant information we need while evaluating a query. For
 * example, filters relative to the current date need the current date.
 */
export type TaskQueryEvaluationContext = {
    readonly currentAccountId: AccountId | null;
    readonly currentDate: CalendarDate;
};
