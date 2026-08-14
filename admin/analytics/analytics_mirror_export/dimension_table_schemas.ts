import {InvalidArgumentError} from "~/shared/error/error.open_source.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.open_source.js";
import {TimeZoneSchema} from "~/shared/schema/helpers/time_zone_schema.js";
import {ObjectSchema, Schema, SchemaType} from "~/shared/schema/schema.js";
import {SchemaSerializedValueDescription} from "~/shared/schema/types/schema_description_types.js";

/**
 * Allowlisted columns for the accounts dimension table. Merges
 * Account#Attributes + Account#Settings (1:1 per account).
 *
 * IMPORTANT: Only add columns here that are safe to expose in Athena queries. Do
 * NOT add PII or sensitive data like:
 *
 * - Session data
 * - Billing/Stripe data
 * - One-time passwords
 */
export const AccountDimensionSchema = Schema.object({
    // From Account#Attributes
    id: Schema.string,
    name: Schema.string,
    plan: Schema.string.optional(),
    created_time: Schema.string,
    has_internal_access: Schema.boolean.optional(),
    has_not_signed_up: Schema.boolean.optional(),
    // Bot account info (no PII - just IDs)
    bot_space_id: Schema.string.optional(),
    bot_id: Schema.string.optional(),
    // From Account#Settings
    last_opened_space_id: Schema.string.optional(),
    observed_time_zone: TimeZoneSchema.nullable(),
});

export type AccountDimension = SchemaType<typeof AccountDimensionSchema>;

/**
 * Keys that come from Account#Settings (vs Account#Attributes).
 */
export type AccountSettingsKeys = "last_opened_space_id" | "observed_time_zone";

/**
 * Allowlisted columns for the account_email_addresses dimension table. Source:
 * AccountEmailAddress#Attributes (1:N per account).
 *
 * IMPORTANT: Email addresses are PII but included for debugging/analysis.
 * Excludes: oneTimePasswordSignInState (sensitive auth data)
 */
export const AccountEmailAddressDimensionSchema = Schema.object({
    email_address: Schema.string,
    account_id: Schema.string,
    created_time: Schema.string,
    is_verified: Schema.boolean,
});

export type AccountEmailAddressDimension = SchemaType<typeof AccountEmailAddressDimensionSchema>;

/**
 * Allowlisted columns for the stripe_customers dimension table. Source:
 * StripeCustomer#Attributes (1:1 per Stripe customer).
 */
export const StripeCustomerDimensionSchema = Schema.object({
    stripe_customer_id: Schema.string,
    account_id: Schema.string,
});

export type StripeCustomerDimension = SchemaType<typeof StripeCustomerDimensionSchema>;

/**
 * Allowlisted columns for the spaces dimension table. Merges Space#Attributes +
 * Space#WelcomePackage (1:1 per space).
 *
 * IMPORTANT: Only add columns here that are safe to expose in Athena queries.
 */
export const SpaceDimensionSchema = Schema.object({
    // From Space#Attributes
    id: Schema.string,
    name: Schema.string,
    created_time: Schema.string,
    // From Space#WelcomePackage
    welcome_package_general_channel_id: Schema.string,
    welcome_package_random_channel_id: Schema.string,
    welcome_package_chat_gpt_bot_account_id: Schema.string.nullable(),
});

export type SpaceDimension = SchemaType<typeof SpaceDimensionSchema>;

/**
 * Keys that come from Space#Attributes (vs Space#WelcomePackage).
 */
export type SpaceAttributesKeys = "id" | "name" | "created_time";

/**
 * Keys that come from Space#WelcomePackage.
 */
export type SpaceWelcomePackageKeys =
    | "welcome_package_general_channel_id"
    | "welcome_package_random_channel_id"
    | "welcome_package_chat_gpt_bot_account_id";

/**
 * Allowlisted columns for the space_accounts dimension table. Source:
 * Space#Account (N:N relationship).
 */
export const SpaceAccountDimensionSchema = Schema.object({
    space_id: Schema.string,
    account_id: Schema.string,
    role: Schema.string.optional(),
    added_time: Schema.string,
    state: Schema.string,
});

export type SpaceAccountDimension = SchemaType<typeof SpaceAccountDimensionSchema>;

/**
 * Allowlisted columns for the space_email_domains dimension table. Source:
 * AutoAddAccountsFromEmailDomain#Space (1 row per space-domain pair).
 */
export const SpaceEmailDomainDimensionSchema = Schema.object({
    space_id: Schema.string,
    email_domain: Schema.string,
    is_enabled: Schema.boolean,
});

export type SpaceEmailDomainDimension = SchemaType<typeof SpaceEmailDomainDimensionSchema>;

type GlueColumn = {
    readonly name: string;
    readonly type: string;
};

function schemaToGlueType(description: SchemaSerializedValueDescription): string {
    switch (description.type) {
        case "Integer":
            return "int";
        case "Float":
            return "double";
        case "Boolean":
            return "boolean";
        case "Date":
            return "timestamp";
        case "Nullable":
            return schemaToGlueType(description.schema);
        case "String":
        case "Id":
        case "Enum":
            return "string";
        case "Array":
        case "BooleanUnion":
        case "Bytes":
        case "Set":
        case "Map":
        case "Object":
        case "Tuple":
        case "Value":
        case "Unknown":
        case "Uint64":
        case "Union":
            throw new InvalidArgumentError(`Unsupported schema type: ${description.type}`);
        default:
            throw exhaustive(description);
    }
}

/**
 * Generates Glue column definitions from an ObjectSchema.
 */
function generateGlueSchemaFromObjectSchema(schema: ObjectSchema<any>): Array<GlueColumn> {
    return Array.from(schema.propertySchemaByKey.entries()).map(([key, propertySchema]) => ({
        name: key,
        // propertySchema has getDescription() but isn't typed as Schema, use any
        type: schemaToGlueType(propertySchema.valueSchema.getDescription()),
    }));
}

export function generateAccountDimensionGlueSchema(): Array<GlueColumn> {
    return generateGlueSchemaFromObjectSchema(AccountDimensionSchema);
}

export function generateAccountEmailAddressDimensionGlueSchema(): Array<GlueColumn> {
    return generateGlueSchemaFromObjectSchema(AccountEmailAddressDimensionSchema);
}

export function generateStripeCustomerDimensionGlueSchema(): Array<GlueColumn> {
    return generateGlueSchemaFromObjectSchema(StripeCustomerDimensionSchema);
}

export function generateSpaceDimensionGlueSchema(): Array<GlueColumn> {
    return generateGlueSchemaFromObjectSchema(SpaceDimensionSchema);
}

export function generateSpaceAccountDimensionGlueSchema(): Array<GlueColumn> {
    return generateGlueSchemaFromObjectSchema(SpaceAccountDimensionSchema);
}

export function generateSpaceEmailDomainDimensionGlueSchema(): Array<GlueColumn> {
    return generateGlueSchemaFromObjectSchema(SpaceEmailDomainDimensionSchema);
}

/**
 * The S3 prefix for accounts dimension data.
 */
export const accountsDimensionS3Prefix = "accounts";

/**
 * The S3 prefix for account_email_addresses dimension data.
 */
export const accountEmailAddressesDimensionS3Prefix = "account_email_addresses";

/**
 * The S3 prefix for stripe_customers dimension data.
 */
export const stripeCustomersDimensionS3Prefix = "stripe_customers";

/**
 * The S3 prefix for spaces dimension data.
 */
export const spacesDimensionS3Prefix = "spaces";

/**
 * The S3 prefix for space_accounts dimension data.
 */
export const spaceAccountsDimensionS3Prefix = "space_accounts";

/**
 * The S3 prefix for space_email_domains dimension data.
 */
export const spaceEmailDomainsDimensionS3Prefix = "space_email_domains";
