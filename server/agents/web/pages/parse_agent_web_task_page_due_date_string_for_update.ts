import {CalendarDate} from "@internationalized/date";
import {quoteMarkdown} from "~/server/agents/web/internal/quote_markdown.js";
import {InvalidArgumentError} from "~/shared/error/error.js";
import {errorDisplayMessage} from "~/shared/error/error_display_message.js";
import {ErrorDisplayMessage} from "~/shared/error/types/error_display_message_type.js";
import {parseCalendarDates} from "~/shared/helpers/date/parse_calendar_dates.js";

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
        const quotedValue = quoteMarkdown([{type: "text", value: dueDateString}]);

        throw new InvalidArgumentError("Invalid task due date", {
            displayMessage: errorDisplayMessage`Unexpected task due date ${quotedValue}${additionalDetail()}. Try again with a date like \u201cJuly 12, 2027\u201d (not including the time, just the date).`,
        });
    }

    return matches[0]!.date;
}
