import {AvatarModelSchema} from "~/shared/avatar/avatar_schema.js";
import {assertId} from "~/shared/id/id.js";
import {AccountId, BotId} from "~/shared/id/types/id_types.js";
import {ReactionCharacterSchema} from "~/shared/reactions/reaction_character_schema.js";
import {LabelStringSchema} from "~/shared/schema/helpers/label_string_schema.js";
import {Schema, SchemaType} from "~/shared/schema/schema.js";

// The `AccountId` tries to spell "unknown account" with no spaces followed by
// zeroes. We substitute 0 for "o" and since "u" is not allowed in IDs we use "n"
// in place of "u" since "n" is an upside down "u".
//
// NOTE(calebmer, 2025-01-14): I've create an account with this ID in the
// production database as a defense against randomly generating an account with
// this ID. It's incredibly unlikely that we'd randomly generate this ID but not
// impossible.
export const unknownAccountId = assertId<AccountId>("nnkn0wnacc0nnt000000000000");

export type AccountModelWithoutSpaceData = SchemaType<typeof AccountModelWithoutSpaceDataSchema>;
export type AccountModelWithoutSpaceAndAvatarData = SchemaType<
    typeof AccountModelWithoutSpaceAndAvatarDataSchema
>;

export const AccountModelWithoutSpaceAndAvatarDataSchema = Schema.object({
    id: Schema.id<AccountId>(),
    version: Schema.integer,
    name: LabelStringSchema,
    nameVersion: Schema.integer,
    // If the account is a bot then this will be defined.
    botId: Schema.id<BotId>().optional(),
    plan: Schema.enum(["LifetimeAccess"]).optional(),
    reactionCharacter: ReactionCharacterSchema.nullable().default(null),
});
export const AccountModelWithoutSpaceDataSchema = AccountModelWithoutSpaceAndAvatarDataSchema.merge(
    Schema.object({
        avatar: AvatarModelSchema.nullable().default(null),
    }),
);

/**
 * Representation of an account in our system that we can share with the client.
 * Information like the account's email address is not publicly available.
 *
 * Usually an account corresponds to a person who signed up with the real name and
 * work email address but an account could also represent a "service account" or
 * bot acting against our systems.
 *
 * This object is rarely used. Instead, most of the time you're working with a
 * `AccountModel` which represents an account in a given space. This model is more
 * generic, though. It isn't space specific and represents an account wherever it
 * may live.
 */
export class AccountModelWithoutSpace {
    public readonly id: AccountId;

    /**
     * The data this `AccountModelWithoutSpace` object was initialized with. May not be
     * the latest data for the account!
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

    private static _unknown: AccountModelWithoutSpace | null = null;

    /**
     * `botId` is immutable so it's ok to access it directly with `account.botId`
     * instead of indirectly with `account.initialData.botId`.
     */
    public get botId() {
        return this.initialData.botId;
    }

    /**
     * Get the model for an unknown account. If we need an account model but we have no
     * account available then you may use this model to render an unknown account.
     */
    public static getUnknown(): AccountModelWithoutSpace {
        this._unknown ??= new AccountModelWithoutSpace({
            id: unknownAccountId,
            version: 0,
            name: "Unknown",
            nameVersion: 0,
            avatar: null,
            reactionCharacter: {type: "Yeti", variant: "Blue"},
        });

        return this._unknown;
    }
}
