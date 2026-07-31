import {ApiContent} from "~/shared/api/specification/types/api_specification_convenience_types.js";
import {defaultTimeZone} from "~/shared/helpers/intl/time_zone.js";
import {DocumentId} from "~/shared/id/types/id_types.js";

export interface GetFathomMeetingNotesMonthDocumentIdsOptions {
    readonly content: ApiContent;
    readonly scheduledStartTime: string;
}

const meetingSectionDateFormatter = new Intl.DateTimeFormat("en-US", {
    timeZone: defaultTimeZone,
    year: "numeric",
    month: "long",
});

/**
 * Returns document mentions in the meeting's year/month section.
 */
export function getFathomMeetingNotesMonthDocumentIds({
    content,
    scheduledStartTime,
}: GetFathomMeetingNotesMonthDocumentIdsOptions): Array<DocumentId> {
    const dateParts = meetingSectionDateFormatter.formatToParts(new Date(scheduledStartTime));
    const year = dateParts.find(part => part.type === "year")?.value;
    const month = dateParts.find(part => part.type === "month")?.value;
    const documentIds: Array<DocumentId> = [];
    let isMatchingYear = false;
    let isMatchingMonth = false;

    for (const element of content.elements) {
        if (element.type === "Heading" && element.level === 2) {
            isMatchingYear = getHeadingText(element) === year;
            isMatchingMonth = false;
            continue;
        }

        if (element.type === "Heading" && element.level === 3) {
            isMatchingMonth = isMatchingYear && getHeadingText(element) === month;
            continue;
        }

        if (!isMatchingMonth || element.type !== "Paragraph") continue;
        for (const inlineElement of element.elements) {
            if (inlineElement.type === "Mention" && inlineElement.reference.type === "Document") {
                documentIds.push(inlineElement.reference.id);
            }
        }
    }

    return documentIds;
}

function getHeadingText(
    heading: Extract<ApiContent["elements"][number], {readonly type: "Heading"}>,
): string {
    return heading.elements.map(element => (element.type === "Text" ? element.text : "")).join("");
}
