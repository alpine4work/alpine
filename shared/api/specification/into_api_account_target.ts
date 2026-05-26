import {
    ApiAccount,
    ApiAccountTargetResponse,
} from "~/shared/api/specification/types/api_specification_convenience_types.js";

/**
 * Convert an `ApiAccount` into a `ApiAccountTarget` (response specialization).
 */
export function intoApiAccountTarget(account: ApiAccount): ApiAccountTargetResponse {
    return {
        type: "Account",
        id: account.id,
        title: account.name,
        shortName: account.shortName,
        botId: account.botId,
    };
}
