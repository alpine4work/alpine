import {
    gitHubUsernameToAlpineId,
    nameToAlpineId,
    pagerDutyIdToAlpineId,
} from "~/admin/lambda/send_alert/internal/send_alert_user_mappings.js";
import {ApiContentMentionInlineElement} from "~/shared/api/specification/types/api_specification_convenience_types.js";
import {ApiSpecification} from "~/shared/api/specification/types/api_specification_types.js";

type CreateUserElementOptions = {
    tagUser?: boolean;
};

/**
 * Creates an Alpine account mention when a service identity is known.
 *
 * Unknown identities are rendered as linked text, and known identities can be
 * rendered as plain first names when a source wants attribution without a mention
 * notification.
 */
export function createUserElement(
    displayName: string,
    url: string,
    id: string,
    options: CreateUserElementOptions = {},
): ApiSpecification.components["schemas"]["ContentInlineElement"] {
    const {tagUser = shouldTagUsers()} = options;
    const alpineId =
        pagerDutyIdToAlpineId[id.toLowerCase()] ||
        gitHubUsernameToAlpineId[id.toLowerCase()] ||
        nameToAlpineId[displayName.toLowerCase()];

    if (alpineId) {
        if (!tagUser) {
            const nameForAlpineId =
                Object.entries(nameToAlpineId).find(
                    ([, mappedAlpineId]) => mappedAlpineId === alpineId,
                )?.[0] || displayName;
            const firstName = nameForAlpineId.trim().split(/\s+/, 1)[0];

            return {
                type: "Text",
                text: firstName
                    ? firstName.charAt(0).toUpperCase() + firstName.substring(1).toLowerCase()
                    : nameForAlpineId,
            };
        }

        const mention: ApiContentMentionInlineElement = {
            type: "Mention",
            target: {type: "Account", id: alpineId},
            isAccountShortName: true,
        };

        return mention;
    }

    return {
        type: "Text",
        text: displayName,
        marks: [
            {
                type: "Link",
                url: url,
            },
        ],
    };
}

function shouldTagUsers(): boolean {
    return process.env.NODE_ENV !== "development";
}
