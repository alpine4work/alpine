import {BotSettingsSchemaSelectPropertySchema} from "~/shared/bots/bot_settings_schema.js";

test("select property accepts options with unique values", () => {
    const property = {
        type: "Select",
        label: "Model",
        hint: "Choose the model this bot uses.",
        level: "Space",
        defaultValue: "fast",
        options: [
            {label: "Fast", value: "fast"},
            {label: "Accurate", value: "accurate"},
        ],
    } as const;

    expect(BotSettingsSchemaSelectPropertySchema.deserialize(property)).toEqual(property);
});

test("select property rejects options with duplicate values", () => {
    expect(() =>
        BotSettingsSchemaSelectPropertySchema.deserialize({
            type: "Select",
            label: "Model",
            hint: null,
            level: "SpaceAccount",
            defaultValue: "model",
            options: [
                {label: "Fast", value: "model"},
                {label: "Accurate", value: "model"},
            ],
        }),
    ).toThrow("Validation failed: Select option values must be unique");
});

test("select property rejects default value that doesn\u2019t exist in options", () => {
    expect(() =>
        BotSettingsSchemaSelectPropertySchema.deserialize({
            type: "Select",
            label: "Model",
            hint: null,
            level: "SpaceAccount",
            defaultValue: "slow",
            options: [
                {label: "Fast", value: "fast"},
                {label: "Accurate", value: "accurate"},
            ],
        }),
    ).toThrow("Validation failed: Default value must be present in options");
});
