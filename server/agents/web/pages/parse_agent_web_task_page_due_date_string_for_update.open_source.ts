import {CalendarDate} from "@internationalized/date";
import {curlyQuote} from "~/server/agents/web/internal/curly_quote.open_source.js";
import {InvalidArgumentError} from "~/shared/error/error.open_source.js";
import {errorDisplayMessage} from "~/shared/error/error_display_message.open_source.js";
import {ErrorDisplayMessage} from "~/shared/error/types/error_display_message_type.open_source.js";
import {parseCalendarDates} from "~/shared/helpers/date/parse_calendar_dates.open_source.js";

export function parseAgentWebTaskPageDueDateStringForUpdate(
    contextDate: CalendarDate,
    dueDateString: string,
    additionalDetail: () => ErrorDisplayMessage = () => errorDisplayMessage``,
) {
    const matches = parseCalendarDates(dueDateString, contextDate.year);

    if (
        matches.length === 0 ||
        matches.length > 1 ||
        matches[0]!.start !== 0 ||
        matches[0]!.end !== dueDateString.length
    ) {
        const quotedValue = curlyQuote(dueDateString);

        throw new InvalidArgumentError("Invalid task due date", {
            displayMessage: errorDisplayMessage`Unexpected task due date ${quotedValue}${additionalDetail()}. Try again with a date like \u201cJuly 12, 2027\u201d (not including the time, just the date).`,
        });
    }

    return matches[0]!.date;
}
