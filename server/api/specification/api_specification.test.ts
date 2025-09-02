import fs from "fs";
import {OpenAPIV3} from "openapi-types";
import {join as joinPath} from "path";
import Yaml from "yaml";
import {runfilesPath} from "~/server/helpers/node/runfiles_path.js";
import {isReadonlyArray} from "~/shared/helpers/array/is_readonly_array.js";
import {cast} from "~/shared/helpers/control/cast.js";
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
    ]);
});
