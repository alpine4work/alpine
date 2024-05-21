import {AccountId} from "~/shared/id/types/id_types.js";
import {LabelStringSchema} from "~/shared/schema/helpers/label_string_schema.js";
import {Schema, SchemaType} from "~/shared/schema/schema.js";

export type AccountModelWithoutSpaceData = SchemaType<typeof AccountModelWithoutSpaceDataSchema>;

export const AccountModelWithoutSpaceDataSchema = Schema.object({
    id: Schema.id<AccountId>(),
    version: Schema.integer,
    name: LabelStringSchema,
    nameVersion: Schema.integer,
});

/**
 * Representation of an account in our system that we can share with
 * the client. Information like the account's email address is not
 * publicly available.
 *
 * Usually an account corresponds to a person who signed up with the real name
 * and work email address but an account could also represent a "service
 * account" or bot acting against our systems.
 *
 * This object is rarely used. Instead, most of the time you're working with a
 * `AccountModel` which represents an account in a given space. This model is
 * more generic, though. It isn't space specific and represents an account
 * wherever it may live.
 */
export class AccountModelWithoutSpace {
    public readonly id: AccountId;

    /**
     * The data this `AccountModelWithoutSpace` object was initialized with. May
     * not be the latest data for the account!
     *
     * You can use the `version` property on an account's data to tell whether one
     * instance of the account is newer than another instance of the account.
     */
    public readonly initialData: AccountModelWithoutSpaceData;

    constructor(initialData: AccountModelWithoutSpaceData) {
        this.id = initialData.id;
        this.initialData = initialData;
    }

    public static readonly schema =
        AccountModelWithoutSpaceDataSchema.transform<AccountModelWithoutSpace>({
            serialize: account => account.initialData,
            deserialize: account => new AccountModelWithoutSpace(account),
        });
}
