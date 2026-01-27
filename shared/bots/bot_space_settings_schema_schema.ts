import {IdentifierStringSchema} from "~/shared/schema/helpers/identifier_string_schema.js";
import {
    LabelStringSchema,
    LabelStringWithoutMaxLengthSchema,
} from "~/shared/schema/helpers/label_string_schema.js";
import {Schema, SchemaType} from "~/shared/schema/schema.js";

/**
 * Schema for the bot's space-specific settings. We use this to render inputs
 * on the bot settings page and these inputs update a JSON object that matches
 * the shape of this schema.
 *
 * `properties` is a `Map` since order matters! We render properties in the
 * order they're defined in the UI.
 */
export type BotSpaceSettingsSchema = SchemaType<typeof BotSpaceSettingsSchemaSchema>;

export type BotSpaceSettingsStringPropertySchema = SchemaType<
    typeof BotSpaceSettingsStringPropertySchemaSchema
>;

export const BotSpaceSettingsStringPropertySchemaSchema = Schema.object({
    type: Schema.value("String"),
    label: LabelStringSchema,
    hint: LabelStringWithoutMaxLengthSchema.maxLength(128).nullable(),

    /**
     * Placeholder rendered when the text input is empty.
     */
    placeholder: Schema.string,

    /**
     * Should we use a code style for the text input?
     */
    isCode: Schema.boolean,

    /**
     * Is this setting a secret? If true then it'll be rendered as a password input
     * and we won't allow non-admins to see the value of the secret. Only whether
     * the value is configured or not.
     */
    isSecret: Schema.boolean,
});

export const BotSpaceSettingsSchemaSchema = Schema.object({
    // TODO(calebmer, #public-api): The public API should represent this as an
    // array. So ordering is not lost for languages that don't parse JSON objects
    // into an ordered struct.
    properties: Schema.map(
        IdentifierStringSchema,
        Schema.union({
            String: BotSpaceSettingsStringPropertySchemaSchema,
        }),
    ),
});
