import {
    ApiAccountReference,
    ApiAccountWithoutSpace,
} from "~/shared/api/specification/types/api_specification_convenience_types.open_source.js";

/**
 * Convert an `ApiAccountRequest` into a `ApiAccountReferenceRequest` (response
 * specialization).
 */
export function intoApiAccountReference(account: ApiAccountWithoutSpace): ApiAccountReference {
    return {
        type: "Account",
        id: account.id,
        title: account.name,
        shortName: account.shortName,
        bot: account.bot,
    };
}

/**
 * Convert a `ApiAccountReferenceRequest` into a `ApiAccountRequest` (response
 * specialization).
 */
export function fromApiAccountReference(account: ApiAccountReference): ApiAccountWithoutSpace {
    return {
        id: account.id,
        name: account.title,
        shortName: account.shortName,
        bot: account.bot,
    };
}
