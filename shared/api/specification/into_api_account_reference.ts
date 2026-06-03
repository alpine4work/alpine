import {
    ApiAccount,
    ApiAccountReferenceResponse,
} from "~/shared/api/specification/types/api_specification_convenience_types.js";

/**
 * Convert an `ApiAccount` into a `ApiAccountReference` (response specialization).
 */
export function intoApiAccountReference(account: ApiAccount): ApiAccountReferenceResponse {
    return {
        type: "Account",
        id: account.id,
        title: account.name,
        shortName: account.shortName,
        botId: account.botId,
    };
}
