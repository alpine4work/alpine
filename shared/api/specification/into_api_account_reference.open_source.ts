import {
    ApiAccountReferenceResponse,
    ApiAccountWithoutSpaceResponse,
} from "~/shared/api/specification/types/api_specification_convenience_types.open_source.js";

/**
 * Convert an `ApiAccount` into a `ApiAccountReference` (response specialization).
 */
export function intoApiAccountReference(
    account: ApiAccountWithoutSpaceResponse,
): ApiAccountReferenceResponse {
    return {
        type: "Account",
        id: account.id,
        title: account.name,
        shortName: account.shortName,
        bot: account.bot,
    };
}

/**
 * Convert a `ApiAccountReference` into a `ApiAccount` (response specialization).
 */
export function fromApiAccountReference(
    account: ApiAccountReferenceResponse,
): ApiAccountWithoutSpaceResponse {
    return {
        id: account.id,
        name: account.title,
        shortName: account.shortName,
        bot: account.bot,
    };
}
