import {CalendarDate, parseDate} from "@internationalized/date";
import {Schema} from "~/shared/schema/schema.open_source.js";

export const CalendarDateSchema = Schema.string.transform<CalendarDate>({
    serialize: date => date.toString(),
    deserialize: date => parseDate(date),
});
