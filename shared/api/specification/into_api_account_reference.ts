import {
    ApiAccountReferenceResponse,
    ApiAccountWithoutSpaceResponse,
} from "~/shared/api/specification/types/api_specification_convenience_types.js";

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
