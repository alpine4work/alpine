import {ApiContent} from "~/shared/api/specification/types/api_specification_convenience_types.js";
import {defaultTimeZone} from "~/shared/helpers/intl/time_zone.js";
import type {DocumentId} from "~/shared/id/types/id_types.js";

type ApiContentBlockElement = ApiContent["elements"][number];

export interface InsertFathomMeetingNotesMentionOptions {
    readonly content: ApiContent;
    readonly documentId: DocumentId;
    readonly scheduledStartTime: string;
}

export interface InsertFathomMeetingNotesMentionResult {
    readonly content: ApiContent;
    readonly inserted: boolean;
}

const meetingSectionDateFormatter = new Intl.DateTimeFormat("en-US", {
    timeZone: defaultTimeZone,
    year: "numeric",
    month: "numeric",
});

const meetingSectionMonthFormatter = new Intl.DateTimeFormat("en-US", {
    timeZone: defaultTimeZone,
    month: "long",
});

const monthNames = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
] as const;

/**
 * Adds a document mention to the matching year and month in the meeting-notes
 * parent document.
 *
 * Year and month sections are kept newest-first, as are mentions within a month.
 * The input content is never mutated.
 */
export function insertFathomMeetingNotesMention({
    content,
    documentId,
    scheduledStartTime,
}: InsertFathomMeetingNotesMentionOptions): InsertFathomMeetingNotesMentionResult {
    const alreadyInserted = content.elements.some(
        element =>
            element.type === "Paragraph" &&
            element.elements.some(
                inlineElement =>
                    inlineElement.type === "Mention" &&
                    inlineElement.reference.type === "Document" &&
                    inlineElement.reference.id === documentId,
            ),
    );
    if (alreadyInserted) return {content, inserted: false};

    const meetingDate = new Date(scheduledStartTime);
    const meetingDateParts = meetingSectionDateFormatter.formatToParts(meetingDate);
    const year = Number(meetingDateParts.find(part => part.type === "year")?.value);
    const month = Number(meetingDateParts.find(part => part.type === "month")?.value) - 1;
    const monthName = meetingSectionMonthFormatter.format(meetingDate);
    const elements: Array<ApiContentBlockElement> = [...content.elements];
    const mentionElement: ApiContentBlockElement = {
        type: "Paragraph",
        elements: [
            {
                type: "Mention",
                reference: {type: "Document", id: documentId},
            },
        ],
    };
    const monthHeading: ApiContentBlockElement = {
        type: "Heading",
        level: 3,
        elements: [{type: "Text", text: monthName}],
    };

    const yearHeadings = elements.flatMap((element, index) => {
        if (element.type !== "Heading" || element.level !== 2) return [];
        const headingYear = Number(getFathomMeetingNotesHeadingText(element));
        return Number.isInteger(headingYear) ? [{index, year: headingYear}] : [];
    });
    const matchingYearHeading = yearHeadings.find(heading => heading.year === year);

    if (!matchingYearHeading) {
        const lowerYearHeading = yearHeadings.find(heading => heading.year < year);
        const insertionIndex = lowerYearHeading?.index ?? elements.length;

        elements.splice(
            insertionIndex,
            0,
            {
                type: "Heading",
                level: 2,
                elements: [{type: "Text", text: String(year)}],
            },
            monthHeading,
            mentionElement,
        );
        return {content: {elements}, inserted: true};
    }

    const yearSectionEnd = elements.findIndex(
        (element, index) =>
            index > matchingYearHeading.index && element.type === "Heading" && element.level === 2,
    );
    const normalizedYearSectionEnd = yearSectionEnd === -1 ? elements.length : yearSectionEnd;
    const monthHeadings = elements.flatMap((element, index) => {
        if (
            index <= matchingYearHeading.index ||
            index >= normalizedYearSectionEnd ||
            element.type !== "Heading" ||
            element.level !== 3
        ) {
            return [];
        }

        const headingText = getFathomMeetingNotesHeadingText(element);
        const headingMonth = monthNames.findIndex(knownMonthName => knownMonthName === headingText);
        return headingMonth === -1 ? [] : [{index, month: headingMonth}];
    });
    const matchingMonthHeading = monthHeadings.find(heading => heading.month === month);

    if (matchingMonthHeading) {
        elements.splice(matchingMonthHeading.index + 1, 0, mentionElement);
        return {content: {elements}, inserted: true};
    }

    const lowerMonthHeading = monthHeadings.find(heading => heading.month < month);
    const insertionIndex = lowerMonthHeading?.index ?? normalizedYearSectionEnd;
    elements.splice(insertionIndex, 0, monthHeading, mentionElement);
    return {content: {elements}, inserted: true};
}

function getFathomMeetingNotesHeadingText(
    heading: Extract<ApiContentBlockElement, {readonly type: "Heading"}>,
): string {
    return heading.elements.map(element => (element.type === "Text" ? element.text : "")).join("");
}
