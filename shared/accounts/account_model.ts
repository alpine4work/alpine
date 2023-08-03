import {AccountId} from "~/shared/id/types/id_types.js";
import {LabelStringSchema} from "~/shared/schema/helpers/label_string_schema.js";
import {Model} from "~/shared/schema/model/model.js";
import {Schema} from "~/shared/schema/schema.js";

/**
 * Representation of an account in our system that we can share with
 * the client. Information like the account's email address is not
 * publicly available.
 *
 * Usually an account corresponds to a person who signed up with the real name
 * and work email address but an account could also represent a "service
 * account" or bot acting against our systems.
 *
 * Currently we make no effort to normalize these model objects on the
 * client! You may have two `AccountModel` objects that represent the same
 * underlying account.
 */
export class AccountModel extends Model(
    Schema.object({
        id: Schema.id<AccountId>(),
        name: LabelStringSchema,
        createdTime: Schema.date,
        hasInternalAccess: Schema.boolean.optional(),
    }),
) {}
