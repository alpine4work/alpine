import {
    ApiContent,
    ApiContentParagraphBlockElement,
} from "~/shared/api/specification/types/api_specification_convenience_types.open_source.js";

type ApiContentElement = ApiContent["elements"][number];

/**
 * Builds the common alert heading and optional action link row.
 *
 * Alert source implementations use this so source-specific payloads share the same
 * title and action layout when posted to Alpine.
 */
export function createHeaderElements(
    title: string,
    actions?: Array<{label: string; url: string}>,
): Array<ApiContentElement> {
    const elements: Array<ApiContentElement> = [
        {
            type: "Heading",
            level: 2,
            elements: [
                {
                    type: "Text",
                    text: title,
                },
            ],
        },
    ];

    if (actions && actions.length > 0) {
        const actionElements: Array<ApiContentParagraphBlockElement["elements"][number]> = [];

        actions.forEach((action, index) => {
            if (index > 0) {
                actionElements.push({
                    type: "Text",
                    text: " • ",
                });
            }

            actionElements.push({
                type: "Text",
                text: action.label,
                marks: [
                    {
                        type: "Link",
                        url: action.url,
                    },
                ],
            });
        });

        elements.push({
            type: "Paragraph",
            elements: actionElements,
        });
    }

    return elements;
}
