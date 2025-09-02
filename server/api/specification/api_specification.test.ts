import fs from "fs";
import {OpenAPIV3} from "openapi-types";
import {join as joinPath} from "path";
import Yaml from "yaml";
import {runfilesPath} from "~/server/helpers/node/runfiles_path.js";
import {filterMapArray} from "~/shared/helpers/array/filter_map_array.js";
import {isReadonlyArray} from "~/shared/helpers/array/is_readonly_array.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {cast} from "~/shared/helpers/control/cast.js";
import {isDeepEqual} from "~/shared/helpers/control/is_deep_equal.js";
import {isObject} from "~/shared/helpers/object/is_object.js";
import {quote} from "~/shared/helpers/string/quote.js";
import {JsonScalarValue, JsonValue} from "~/shared/helpers/types/json_value.js";

const apiSpecificationPath = joinPath(
    runfilesPath,
    "cyberworlds/server/api/specification/api_specification_final.yaml",
);

const apiSpecificationString = fs.readFileSync(apiSpecificationPath, "utf8");
const apiSpecification: OpenAPIV3.Document = Yaml.parse(apiSpecificationString);

function validate(specification: JsonValue) {
    const path: Array<string> = [];
    const errors: Array<string> = [];

    visit(specification);

    return errors;

    function printPath() {
        return "#/" + path.map(pathStackItem => encodeURIComponent(pathStackItem)).join("/");
    }

    function addError(error: string) {
        errors.push(`${error} (path: ${quote(printPath())})`);
    }

    function resolvePath(path: string): JsonValue {
        assert(path.startsWith("#/"));
        const pathSegments = path.slice(2).split("/");

        let refValue: any = specification;

        for (const refPathSegment of pathSegments) {
            refValue = refValue?.[refPathSegment];
        }

        return refValue;
    }

    function visit(value: JsonValue) {
        if (isReadonlyArray(value)) {
            for (let i = 0; i < value.length; i++) {
                path.push(String(i));
                visit(value[i]!);
                path.pop();
            }
        } else if (isObject(value)) {
            if (value.type === "object") {
                // Rule: Require `additionalProperties: false` to be set on all object schemas.
                if (value.additionalProperties !== false) {
                    addError(
                        quote`\`additionalProperties\` must be set to \`false\` on all object schemas in the API specification`,
                    );
                }

                if (isObject(value.properties)) {
                    for (const key of Object.keys(value.properties)) {
                        // Rule: Object property keys must be in camel case.
                        if (!/^[a-z][a-zA-Z0-9]*$/.test(key)) {
                            addError(quote`Object property ${key} must be \`camelCase\``);
                        }
                    }
                }
            }

            if (path[path.length - 1] === "responses") {
                // Rule: Require all responses to have a `default` that references
                // `#/components/responses/Error`.
                if (
                    (!value.default ||
                        !isObject(value.default) ||
                        value.default.$ref !== "#/components/responses/Error") &&
                    // This rule doesn't apply to reusable response components.
                    !(path[0] === "components" && path[1] === "responses") &&
                    // Responses defined in `webhooks` are implemented by third-party services.
                    // They can return whatever error response they want.
                    path[0] !== "webhooks"
                ) {
                    addError(
                        quote`\`responses\` must have a \`default\` property with a \`$ref\` pointing to \`#/components/responses/Error\``,
                    );
                }
            }

            // Make sure `discriminator` schemas match our expected format. This is for
            // compatibility with JSON Schema. You could ignore the `discriminator`
            // property and still correctly validate with JSON Schema.
            if (isObject(value.discriminator)) {
                if (!Array.isArray(value.oneOf)) {
                    addError(quote`\`discriminator\` must be on a \`oneOf\` schema`);
                } else {
                    const refsArray = filterMapArray(value.oneOf, (subSchema, index) => {
                        if (isObject(subSchema) && typeof subSchema.$ref === "string") {
                            return subSchema.$ref;
                        }

                        path.push("oneOf");
                        path.push(String(index));

                        addError(quote`\`discriminator\`’s \`oneOf\` schemas must be \`$ref\`s`);

                        path.pop();
                        path.pop();

                        return;
                    });

                    const refs = new Set(refsArray);

                    if (refsArray.length !== refs.size) {
                        addError(quote`\`discriminator\`’s \`oneOf\` \`$ref\`s aren’t unique`);
                    }

                    if (typeof value.discriminator.propertyName !== "string") {
                        addError(quote`\`discriminator\` must have a string \`propertyName\``);
                    } else if (!isObject(value.discriminator.mapping)) {
                        addError(quote`\`discriminator\` must have a \`mapping\` property`);
                    } else {
                        const discriminatorRefs = new Set<string>();

                        for (const [key, ref] of Object.entries(value.discriminator.mapping)) {
                            path.push("discriminator");
                            path.push("mapping");
                            path.push(key);
                            try {
                                if (typeof ref !== "string") {
                                    addError(
                                        quote`\`discriminator\`’s \`mapping\`s must be strings`,
                                    );
                                    continue;
                                }

                                if (discriminatorRefs.has(ref)) {
                                    addError(quote`\`discriminator\`’s \`mapping\`s aren’t unique`);
                                    continue;
                                }

                                discriminatorRefs.add(ref);

                                const refValue = resolvePath(ref);

                                if (!isObject(refValue) || refValue.type !== "object") {
                                    addError(
                                        quote`\`discriminator\`’s \`mapping\` ${ref} doesn’t reference an object schema`,
                                    );
                                    continue;
                                }

                                if (
                                    !isReadonlyArray(refValue.required) ||
                                    !refValue.required.includes(value.discriminator.propertyName)
                                ) {
                                    addError(
                                        quote`\`discriminator\`’s \`mapping\` ${ref} doesn’t have a required ${value.discriminator.propertyName} property`,
                                    );
                                }

                                const hasConstProperty =
                                    isObject(refValue.properties) &&
                                    refValue.properties[value.discriminator.propertyName] &&
                                    isObject(
                                        refValue.properties[value.discriminator.propertyName],
                                    ) &&
                                    (refValue.properties[value.discriminator.propertyName] as any)
                                        .const === key;

                                if (!hasConstProperty) {
                                    addError(
                                        quote`\`discriminator\`’s \`mapping\` ${ref} doesn’t have a ${value.discriminator.propertyName} property that’s a \`const\` schema with value ${key}`,
                                    );
                                }
                            } finally {
                                path.pop();
                                path.pop();
                                path.pop();
                            }
                        }

                        if (!isDeepEqual(refs, discriminatorRefs)) {
                            addError(
                                quote`\`discriminator\`’s \`oneOf\` \`$ref\`s must match \`discriminator\`’s \`mapping\`s`,
                            );
                        }
                    }
                }
            }

            for (const [key, keyValue] of Object.entries(value)) {
                if (keyValue === undefined) continue;

                // Rule: Path segments should be `kebab-case` since that's standard for URLs.
                // Unless we have a parameter, parameters should be `{camelCase}`.
                if (path[0] === "paths" && path.length === 1) {
                    for (const pathSegment of (key.startsWith("/") ? key.slice(1) : key).split(
                        "/",
                    )) {
                        if (!/^([a-z-]+|\{[a-z][a-zA-Z0-9]*\})$/.test(pathSegment)) {
                            addError(
                                quote`Path segment ${pathSegment} in path ${key} must be \`kebab-case\` if it’s not a parameter and \`{camelCase}\` if it is a parameter`,
                            );
                        }
                    }
                }

                // Rule: Response names should be `PascalCase` since it's a type name.
                if (
                    path[0] === "components" &&
                    path[1] === "responses" &&
                    path.length === 2 &&
                    !/^[A-Z][a-zA-Z0-9]+$/.test(key)
                ) {
                    addError(quote`Response name ${key} must be \`PascalCase\``);
                }

                // Rule: Schema names should be `PascalCase` since it's a type name.
                if (
                    path[0] === "components" &&
                    path[1] === "schemas" &&
                    path.length === 2 &&
                    !/^[A-Z][a-zA-Z0-9]+$/.test(key)
                ) {
                    errors.push(
                        quote`Schema name ${key} must be \`PascalCase\` (path: ${printPath()})`,
                    );
                }

                // Rule: Webhook names should be `kebab-case` to match paths.
                if (path[0] === "webhooks" && path.length === 1 && !/^[a-z-]+$/.test(key)) {
                    errors.push(
                        quote`Webhook name ${key} must be \`kebab-case\` (path: ${printPath()})`,
                    );
                }

                path.push(key);
                visit(keyValue);
                path.pop();
            }
        } else {
            // Make sure the only values left are scalar values.
            cast<JsonScalarValue>(value);
        }
    }
}

test("api specification is valid", () => {
    expect(validate(apiSpecification as any)).toEqual([]);
});

test("can validate invalid specification", () => {
    const invalidSpecification = {
        paths: {
            "/Ping1": {
                get: {
                    responses: {
                        default: {$ref: "#/components/responses/Error"},
                        "200": {
                            content: {
                                "application/json": {
                                    schema: {
                                        type: "object",
                                        required: ["Pong"],
                                        additionalProperties: true,
                                        properties: {
                                            Pong: {
                                                type: "boolean",
                                                enum: [true],
                                            },
                                        },
                                    },
                                },
                            },
                        },
                    },
                },
            },
            "/ping2": {
                get: {
                    responses: {
                        "200": {
                            content: {
                                "application/json": {
                                    schema: {
                                        type: "object",
                                        required: ["pong"],
                                        properties: {
                                            pong: {
                                                type: "boolean",
                                                enum: [true],
                                            },
                                        },
                                    },
                                },
                            },
                        },
                    },
                },
            },
            "/pingAgain": {
                get: {
                    responses: {
                        default: {$ref: "#/components/responses/Error"},
                        "200": {
                            content: {
                                "application/json": {
                                    schema: {
                                        type: "object",
                                        required: ["pong-again"],
                                        additionalProperties: false,
                                        properties: {
                                            "pong-again": {
                                                type: "boolean",
                                                enum: [true],
                                            },
                                        },
                                    },
                                },
                            },
                        },
                    },
                },
            },
            "/ping/{yo-yo}": {
                get: {
                    responses: {
                        default: {$ref: "#/components/responses/Error"},
                        "200": {
                            content: {
                                "application/json": {
                                    schema: {
                                        type: "object",
                                        required: ["pong"],
                                        additionalProperties: false,
                                        properties: {
                                            pong: {
                                                type: "boolean",
                                                enum: [true],
                                            },
                                        },
                                    },
                                },
                            },
                        },
                    },
                },
            },
        },

        components: {
            responses: {
                "test-error": {
                    content: {
                        "application/json": {
                            schema: {
                                type: "object",
                                required: ["error"],
                                additionalProperties: false,
                                properties: {
                                    error: {
                                        type: "object",
                                        required: ["message"],
                                        additionalProperties: false,
                                        properties: {message: {type: "string"}},
                                    },
                                },
                            },
                        },
                    },
                },
                testError: {
                    content: {
                        "application/json": {
                            schema: {
                                type: "object",
                                required: ["error"],
                                additionalProperties: false,
                                properties: {
                                    error: {
                                        type: "object",
                                        required: ["message"],
                                        additionalProperties: false,
                                        properties: {message: {type: "string"}},
                                    },
                                },
                            },
                        },
                    },
                },
            },
            schemas: {
                InvalidBlockElement1: {
                    type: "number",
                    discriminator: {
                        propertyName: "type",
                    },
                },
                InvalidBlockElement2: {
                    oneOf: [
                        {$ref: "#/components/schemas/ParagraphBlockElement"},
                        {$ref: "#/components/schemas/QuoteBlockElement"},
                        {type: "object", required: ["type"], properties: {type: {const: "Code"}}},
                    ],
                    discriminator: {
                        propertyName: "type",
                    },
                },
                InvalidBlockElement3: {
                    oneOf: [
                        {$ref: "#/components/schemas/ParagraphBlockElement"},
                        {$ref: "#/components/schemas/QuoteBlockElement"},
                    ],
                    discriminator: {
                        propertyName: "type",
                        mapping: {
                            NotParagraph: "#/components/schemas/ParagraphBlockElement",
                            OtherParagraph: "#/components/schemas/ParagraphBlockElement",
                            Code: "#/components/schemas/CodeBlockElement",
                        },
                    },
                },
                ParagraphBlockElement: {
                    type: "object",
                    required: ["type"],
                    additionalProperties: false,
                    properties: {
                        type: {const: "Paragraph"},
                    },
                },
                QuoteBlockElement: {
                    type: "object",
                    required: ["type"],
                    additionalProperties: false,
                    properties: {
                        type: {const: "Quote"},
                    },
                },
                CodeBlockElement: {
                    type: "object",
                    additionalProperties: false,
                    properties: {
                        type: {const: "Code"},
                    },
                },
            },
        },
    };

    expect(validate(invalidSpecification)).toEqual([
        "Path segment `Ping1` in path `/Ping1` must be `kebab-case` if it’s not a parameter and `{camelCase}` if it is a parameter (path: `#/paths`)",
        "`additionalProperties` must be set to `false` on all object schemas in the API specification (path: `#/paths/%2FPing1/get/responses/200/content/application%2Fjson/schema`)",
        "Object property `Pong` must be `camelCase` (path: `#/paths/%2FPing1/get/responses/200/content/application%2Fjson/schema`)",
        "Path segment `ping2` in path `/ping2` must be `kebab-case` if it’s not a parameter and `{camelCase}` if it is a parameter (path: `#/paths`)",
        "`responses` must have a `default` property with a `$ref` pointing to `#/components/responses/Error` (path: `#/paths/%2Fping2/get/responses`)",
        "`additionalProperties` must be set to `false` on all object schemas in the API specification (path: `#/paths/%2Fping2/get/responses/200/content/application%2Fjson/schema`)",
        "Path segment `pingAgain` in path `/pingAgain` must be `kebab-case` if it’s not a parameter and `{camelCase}` if it is a parameter (path: `#/paths`)",
        "Object property `pong-again` must be `camelCase` (path: `#/paths/%2FpingAgain/get/responses/200/content/application%2Fjson/schema`)",
        "Path segment `{yo-yo}` in path `/ping/{yo-yo}` must be `kebab-case` if it’s not a parameter and `{camelCase}` if it is a parameter (path: `#/paths`)",
        "Response name `test-error` must be `PascalCase` (path: `#/components/responses`)",
        "Response name `testError` must be `PascalCase` (path: `#/components/responses`)",
        "`discriminator` must be on a `oneOf` schema (path: `#/components/schemas/InvalidBlockElement1`)",
        "`discriminator`’s `oneOf` schemas must be `$ref`s (path: `#/components/schemas/InvalidBlockElement2/oneOf/2`)",
        "`discriminator` must have a `mapping` property (path: `#/components/schemas/InvalidBlockElement2`)",
        "`additionalProperties` must be set to `false` on all object schemas in the API specification (path: `#/components/schemas/InvalidBlockElement2/oneOf/2`)",
        "`discriminator`’s `mapping` `#/components/schemas/ParagraphBlockElement` doesn’t have a `type` property that’s a `const` schema with value `NotParagraph` (path: `#/components/schemas/InvalidBlockElement3/discriminator/mapping/NotParagraph`)",
        "`discriminator`’s `mapping`s aren’t unique (path: `#/components/schemas/InvalidBlockElement3/discriminator/mapping/OtherParagraph`)",
        "`discriminator`’s `mapping` `#/components/schemas/CodeBlockElement` doesn’t have a required `type` property (path: `#/components/schemas/InvalidBlockElement3/discriminator/mapping/Code`)",
        "`discriminator`’s `oneOf` `$ref`s must match `discriminator`’s `mapping`s (path: `#/components/schemas/InvalidBlockElement3`)",
    ]);
});
