import {Fragment, Mark, Node, Schema as ProsemirrorSchema, Slice} from "prosemirror-model";
import {
    AddMarkStep,
    AddNodeMarkStep,
    AttrStep,
    DocAttrStep,
    RemoveMarkStep,
    RemoveNodeMarkStep,
    ReplaceAroundStep,
    ReplaceStep,
    Step,
} from "prosemirror-transform";
import {InternalError, InvalidArgumentError} from "~/shared/error/error.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {hasAnyOwnProperties} from "~/shared/helpers/object/has_any_own_properties.js";
import {hasOwnProperty} from "~/shared/helpers/object/has_own_property.js";
import {isObject} from "~/shared/helpers/object/is_object.js";
import {isPlainObject} from "~/shared/helpers/object/is_plain_object.js";
import {omitObject} from "~/shared/helpers/object/omit_object.js";
import {quote} from "~/shared/helpers/string/quote.js";
import {StepByJsonId} from "~/shared/prosemirror/prosemirror_exhaustive_step.js";
import {
    AddMarksAfterRemoveAllStep,
    RemoveAllMarksStep,
} from "~/shared/prosemirror/remove_all_marks_step.js";
import {Schema, SchemaDeserializationError, UnionSchema} from "~/shared/schema/schema.js";

declare module "prosemirror-model" {
    interface Fragment {
        // Expose the internal `content` property on fragments.
        // https://github.com/ProseMirror/prosemirror-model/blob/9201015c268947c34fa31be26b8b7aa5a0cf9776/src/fragment.ts#L18
        readonly content: ReadonlyArray<Node>;
    }
}

declare module "prosemirror-transform" {
    interface Step {
        // ProseMirror puts JSON IDs on the step prototype.
        // https://github.com/ProseMirror/prosemirror-transform/blob/8d6be028eebb28a2d981dee146eacdd2c1cffcd4/src/step.ts#L64
        readonly jsonID?: string;
    }

    interface ReplaceStep {
        // Expose the internal `structure` property on replace steps.
        // https://github.com/ProseMirror/prosemirror-transform/blob/8d6be028eebb28a2d981dee146eacdd2c1cffcd4/src/replace_step.ts#LL23
        readonly structure: boolean;
    }

    interface ReplaceAroundStep {
        // Expose the internal `structure` property on replace steps.
        // https://github.com/ProseMirror/prosemirror-transform/blob/8d6be028eebb28a2d981dee146eacdd2c1cffcd4/src/replace_step.ts#L104
        readonly structure: boolean;
    }
}

export const AddMarksAfterRemoveAllStepRangeSchema = Schema.booleanUnion(
    "isNode",
    Schema.object({
        isNode: Schema.value(true),
        pos: Schema.integer.min(0),
    }),
    Schema.object({
        isNode: Schema.value(false),
        from: Schema.integer.min(0),
        to: Schema.integer.min(0),
    }),
).migration({
    // We added the `isNode` flag after the initial creation of this schema.
    deserialize: range => {
        if (isObject(range) && !("isNode" in range)) {
            return {...range, isNode: false};
        }
        return range;
    },
    serialize: range => range,
});

/**
 * Creates a schema in our schema framework from a ProseMirror schema for nodes
 * and steps. It serializes to the same JSON format as ProseMirror and can
 * serialize back from the ProseMirror JSON format.
 *
 * We need to create our own schema so that:
 *
 * - Attrs can be strictly typed with their own schema.
 * - We can manage cross-version compatibility and data migration of
 *   ProseMirror documents like any other data.
 * - We can efficiently encode ProseMirror documents using type information
 *   from our schema. (Unimplemented as of 2023-02-28 but someday I think we
 *   should implement a binary encoding for the schema framework to minimize
 *   bytes sent over the wire and stored in the database.)
 */
export function createSchemaForProsemirrorSchema(schema: ProsemirrorSchema) {
    /* ========================================================================== *\
     *                               Mark schemas                                 *
    \* ========================================================================== */

    const markSchemaByName = new Map<string, Schema<Mark>>();
    const attrSchemaByName = new Map<string, Schema<unknown>>();
    const docAttrSchemaByName = new Map<string, Schema<unknown>>();

    for (const [markTypeName, markType] of Object.entries(schema.marks)) {
        const markAttrSpecEntries = Object.entries(markType.spec.attrs ?? {});
        const allMarkAttrsHaveDefault = markAttrSpecEntries.every(([, markAttrSpec]) =>
            hasOwnProperty(markAttrSpec, "default"),
        );

        const MarkAttrsSchema = Schema.object(
            Object.fromEntries(
                markAttrSpecEntries.map(([markAttrName, markAttrSpec]) => {
                    const markAttrSchema: unknown = (markAttrSpec as any).schema;
                    if (!(markAttrSchema instanceof Schema)) {
                        throw new InternalError(
                            quote`Mark ${markTypeName} has an attr ${markAttrName} without a schema`,
                        );
                    }
                    return [
                        markAttrName,
                        hasOwnProperty(markAttrSpec, "default")
                            ? markAttrSchema.default(markAttrSpec.default)
                            : markAttrSchema,
                    ];
                }),
            ),
        );

        for (const [attrName, attrPropertySchema] of MarkAttrsSchema.propertySchemaByKey) {
            const attrSchema = attrPropertySchema.valueSchema;

            const existingAttrSchema = attrSchemaByName.get(attrName);
            if (existingAttrSchema && existingAttrSchema !== attrSchema)
                throw new InternalError(
                    quote`Mark ${markTypeName} has an attr ${attrName} that shares the same name but different schema with another attr, attrs with the same name must have the same schema`,
                );

            attrSchemaByName.set(attrName, attrSchema);
        }

        const MarkSchema = Schema.object({
            type: Schema.value(markTypeName),
            ...(markAttrSpecEntries.length > 0
                ? {
                      attrs: allMarkAttrsHaveDefault
                          ? MarkAttrsSchema.nullable().optional()
                          : MarkAttrsSchema,
                  }
                : {}),
        }).transform<Mark>({
            deserialize: value => markType.create(value.attrs),
            serialize: value => {
                assert(value.type.name === markTypeName);

                if (hasAnyOwnProperties(value.attrs)) {
                    return {
                        type: value.type.name,
                        attrs: value.attrs,
                    };
                } else {
                    return {type: value.type.name};
                }
            },
        });

        markSchemaByName.set(markTypeName, MarkSchema);
    }

    const MarkUnionSchema: UnionSchema<Mark> = UnionSchema._new(
        Object.fromEntries(markSchemaByName),
        {
            getType: value => value.type.name,
        },
    );

    /* ========================================================================== *\
     *                               Node schemas                                 *
    \* ========================================================================== */

    const FragmentSchema = Schema.declare<Fragment>();
    const NodeMarksPropertySchema = Schema.array(MarkUnionSchema).optional();
    const NodeContentPropertySchema = FragmentSchema.optional();
    const nodeSchemaByName = new Map<string, Schema<Node>>();
    const uncheckedNodeSchemaByName = new Map<string, Schema<Node>>();

    for (const [nodeTypeName, nodeType] of Object.entries(schema.nodes)) {
        if (nodeTypeName === "text") {
            const TextNodeSchema = Schema.object({
                type: Schema.value("text"),
                marks: NodeMarksPropertySchema,
                text: Schema.string,
            }).transform<Node>({
                deserialize: value => schema.text(value.text, value.marks),
                serialize: value => {
                    assert(value.isText);
                    return {
                        type: "text",
                        marks: value.marks.length > 0 ? value.marks : undefined,
                        text: value.text!,
                    };
                },
            });
            nodeSchemaByName.set(nodeTypeName, TextNodeSchema);
            uncheckedNodeSchemaByName.set(nodeTypeName, TextNodeSchema);
            continue;
        }

        const nodeAttrSpecEntries = Object.entries(nodeType.spec.attrs ?? {});
        const allNodeAttrsHaveDefault = nodeAttrSpecEntries.every(([, markAttrSpec]) =>
            hasOwnProperty(markAttrSpec, "default"),
        );

        const NodeAttrsSchema = Schema.object(
            Object.fromEntries(
                nodeAttrSpecEntries.map(([nodeAttrName, nodeAttrSpec]) => {
                    const nodeAttrSchema: unknown = (nodeAttrSpec as any).schema;
                    if (!(nodeAttrSchema instanceof Schema)) {
                        throw new InternalError(
                            quote`Node ${nodeTypeName} has an attr ${nodeAttrName} without a schema`,
                        );
                    }
                    return [
                        nodeAttrName,
                        hasOwnProperty(nodeAttrSpec, "default")
                            ? nodeAttrSchema.default(nodeAttrSpec.default)
                            : nodeAttrSchema,
                    ];
                }),
            ),
        );

        if (nodeTypeName === "doc") {
            for (const [attrName, attrPropertySchema] of NodeAttrsSchema.propertySchemaByKey) {
                const attrSchema = attrPropertySchema.valueSchema;

                const existingAttrSchema = docAttrSchemaByName.get(attrName);
                if (existingAttrSchema && existingAttrSchema !== attrSchema)
                    throw new InternalError(
                        quote`Node ${nodeTypeName} has an attr ${attrName} that shares the same name but different schema with another attr, attrs with the same name must have the same schema`,
                    );

                docAttrSchemaByName.set(attrName, attrSchema);
            }
        } else {
            for (const [attrName, attrPropertySchema] of NodeAttrsSchema.propertySchemaByKey) {
                const attrSchema = attrPropertySchema.valueSchema;

                const existingAttrSchema = attrSchemaByName.get(attrName);
                if (existingAttrSchema && existingAttrSchema !== attrSchema)
                    throw new InternalError(
                        quote`Node ${nodeTypeName} has an attr ${attrName} that shares the same name but different schema with another attr, attrs with the same name must have the same schema`,
                    );

                attrSchemaByName.set(attrName, attrSchema);
            }
        }

        const NodeSchemaBase = Schema.object({
            type: Schema.value(nodeTypeName),
            ...(nodeAttrSpecEntries.length > 0
                ? {
                      attrs: allNodeAttrsHaveDefault
                          ? NodeAttrsSchema.nullable().optional()
                          : NodeAttrsSchema,
                  }
                : {}),
            ...(nodeType.markSet?.length !== 0
                ? {
                      marks: NodeMarksPropertySchema,
                  }
                : {}),
            ...(nodeType.contentMatch.edgeCount > 0
                ? {
                      content: NodeContentPropertySchema,
                  }
                : {}),
        });

        const NodeSchema = NodeSchemaBase.transform<Node>({
            deserialize: value => {
                const node = nodeType.create(value.attrs, value.content, value.marks);

                if (!node.type.validContent(node.content)) {
                    throw new SchemaDeserializationError(
                        quote`Invalid content for node ${node.type.name}`,
                    );
                }

                return node;
            },
            serialize: node => {
                assert(node.type.name === nodeTypeName);

                if (!node.type.validContent(node.content)) {
                    throw new InvalidArgumentError(
                        quote`Invalid content for node ${
                            node.type.name
                        }, expected content to match ${node.type.spec.content ?? ""}`,
                    );
                }

                return {
                    type: node.type.name,
                    attrs: hasAnyOwnProperties(node.attrs) ? node.attrs : undefined,
                    marks: node.marks.length > 0 ? node.marks : undefined,
                    content: node.content.size > 0 ? node.content : undefined,
                };
            },
        });

        const UncheckedNodeSchema = NodeSchemaBase.transform<Node>({
            deserialize: value => nodeType.create(value.attrs, value.content, value.marks),
            serialize: node => {
                assert(node.type.name === nodeTypeName);
                return {
                    type: node.type.name,
                    attrs: hasAnyOwnProperties(node.attrs) ? node.attrs : undefined,
                    marks: node.marks.length > 0 ? node.marks : undefined,
                    content: node.content.size > 0 ? node.content : undefined,
                };
            },
        });

        nodeSchemaByName.set(nodeTypeName, NodeSchema);
        uncheckedNodeSchemaByName.set(nodeTypeName, UncheckedNodeSchema);
    }

    const NodeUnionSchema: UnionSchema<Node> = UnionSchema._new(
        Object.fromEntries(nodeSchemaByName),
        {
            getType: value => value.type.name,
        },
    );

    const UncheckedNodeUnionSchema: UnionSchema<Node> = UnionSchema._new(
        Object.fromEntries(uncheckedNodeSchemaByName),
        {
            getType: value => value.type.name,
        },
    );

    FragmentSchema.define(
        Schema.array(NodeUnionSchema)
            .nullable()
            .transform<Fragment>({
                deserialize: value => (value === null ? Fragment.empty : Fragment.from(value)),
                serialize: value => (value.content.length > 0 ? value.content : null),
            }),
    );

    const UncheckedFragmentSchema = Schema.array(UncheckedNodeUnionSchema)
        .nullable()
        .transform<Fragment>({
            deserialize: value => (value === null ? Fragment.empty : Fragment.from(value)),
            serialize: value => (value.content.length > 0 ? value.content : null),
        });

    const TopNodeType = assertExists(nodeSchemaByName.get(schema.topNodeType.name));

    const UncheckedTopNodeType = assertExists(
        uncheckedNodeSchemaByName.get(schema.topNodeType.name),
    );

    /* ========================================================================== *\
     *                               Step schemas                                 *
    \* ========================================================================== */

    // Lazily create the step schema since not every schema needs it.
    const createStepSchema = () => {
        const AttrStepSchema = Schema.object({
            stepType: Schema.value("attr"),
            pos: Schema.integer.min(0),
            attr: Schema.union(
                Object.fromEntries(
                    Array.from(attrSchemaByName, ([attrName, attrSchema]) => [
                        attrName,
                        Schema.object({
                            type: Schema.value(attrName),
                            value: attrSchema,
                        }),
                    ]),
                ),
            ),
        })
            .transform<AttrStep>({
                deserialize: value => new AttrStep(value.pos, value.attr.type, value.attr.value),
                serialize: value => ({
                    stepType: "attr",
                    pos: value.pos,
                    attr: {type: value.attr, value: value.value},
                }),
            })
            // We need to use a union for `attr` in our schema framework but we want the
            // serialized/deserialized JSON to be compatible with `prosemirror-transform`'s
            // JSON which has a slightly different format.
            //
            // If/when we add a binary format to our schema framework we won't need this
            // migration. It is only needed for JSON compatibility with
            // `prosemirror-transform`.
            //
            // https://github.com/ProseMirror/prosemirror-transform/blob/8d6be028eebb28a2d981dee146eacdd2c1cffcd4/src/attr_step.ts#L42-L50
            .migration({
                serialize: value => {
                    assert(isPlainObject(value));
                    assert(isPlainObject(value.attr));
                    return {
                        ...omitObject(value, ["attr"]),
                        attr: value.attr.type,
                        value: value.attr.value,
                    };
                },
                deserialize: value => {
                    if (!isPlainObject(value) || typeof value.attr !== "string") return value;
                    return {
                        ...omitObject(value, ["attr", "value"]),
                        attr: {
                            type: value.attr,
                            value: value.value,
                        },
                    };
                },
            });

        const DocAttrStepSchema = Schema.object({
            stepType: Schema.value("docAttr"),
            attr: Schema.union(
                Object.fromEntries(
                    Array.from(docAttrSchemaByName, ([attrName, attrSchema]) => [
                        attrName,
                        Schema.object({
                            type: Schema.value(attrName),
                            value: attrSchema,
                        }),
                    ]),
                ),
            ),
        })
            .transform<DocAttrStep>({
                deserialize: value => new DocAttrStep(value.attr.type, value.attr.value),
                serialize: value => ({
                    stepType: "docAttr",
                    attr: {type: value.attr, value: value.value},
                }),
            })
            // We need to use a union for `attr` in our schema framework but we want the
            // serialized/deserialized JSON to be compatible with `prosemirror-transform`'s
            // JSON which has a slightly different format.
            //
            // If/when we add a binary format to our schema framework we won't need this
            // migration. It is only needed for JSON compatibility with
            // `prosemirror-transform`.
            //
            // https://github.com/ProseMirror/prosemirror-transform/blob/8d6be028eebb28a2d981dee146eacdd2c1cffcd4/src/attr_step.ts#L42-L50
            .migration({
                serialize: value => {
                    assert(isPlainObject(value));
                    assert(isPlainObject(value.attr));
                    return {
                        ...omitObject(value, ["attr"]),
                        attr: value.attr.type,
                        value: value.attr.value,
                    };
                },
                deserialize: value => {
                    if (!isPlainObject(value) || typeof value.attr !== "string") return value;
                    return {
                        ...omitObject(value, ["attr", "value"]),
                        attr: {
                            type: value.attr,
                            value: value.value,
                        },
                    };
                },
            });

        const AddMarkStepSchema = Schema.object({
            stepType: Schema.value("addMark"),
            from: Schema.integer.min(0),
            to: Schema.integer.min(0),
            mark: MarkUnionSchema,
        }).transform<AddMarkStep>({
            deserialize: value => new AddMarkStep(value.from, value.to, value.mark),
            serialize: value => ({
                stepType: "addMark",
                from: value.from,
                to: value.to,
                mark: value.mark,
            }),
        });

        const RemoveMarkStepSchema = Schema.object({
            stepType: Schema.value("removeMark"),
            from: Schema.integer.min(0),
            to: Schema.integer.min(0),
            mark: MarkUnionSchema,
        }).transform<RemoveMarkStep>({
            deserialize: value => new RemoveMarkStep(value.from, value.to, value.mark),
            serialize: value => ({
                stepType: "removeMark",
                from: value.from,
                to: value.to,
                mark: value.mark,
            }),
        });

        const AddNodeMarkStepSchema = Schema.object({
            stepType: Schema.value("addNodeMark"),
            pos: Schema.integer.min(0),
            mark: MarkUnionSchema,
        }).transform<AddNodeMarkStep>({
            deserialize: value => new AddNodeMarkStep(value.pos, value.mark),
            serialize: value => ({
                stepType: "addNodeMark",
                pos: value.pos,
                mark: value.mark,
            }),
        });

        const RemoveNodeMarkStepSchema = Schema.object({
            stepType: Schema.value("removeNodeMark"),
            pos: Schema.integer.min(0),
            mark: MarkUnionSchema,
        }).transform<RemoveNodeMarkStep>({
            deserialize: value => new RemoveNodeMarkStep(value.pos, value.mark),
            serialize: value => ({
                stepType: "removeNodeMark",
                pos: value.pos,
                mark: value.mark,
            }),
        });

        const UncheckedSliceSchema = Schema.object({
            content: UncheckedFragmentSchema,
            openStart: Schema.integer.min(0).optional(),
            openEnd: Schema.integer.min(0).optional(),
        })
            .nullable()
            .transform<Slice>({
                deserialize: value =>
                    value
                        ? new Slice(value.content, value.openStart ?? 0, value.openEnd ?? 0)
                        : Slice.empty,
                serialize: value =>
                    value.content.size > 0
                        ? {
                              content: value.content,
                              openStart: value.openStart > 0 ? value.openStart : undefined,
                              openEnd: value.openEnd > 0 ? value.openEnd : undefined,
                          }
                        : null,
            });

        const ReplaceStepSchema = Schema.object({
            stepType: Schema.value("replace"),
            from: Schema.integer.min(0),
            to: Schema.integer.min(0),
            // We don't check that the content is valid because structure updates may only
            // include a node, no children.
            slice: UncheckedSliceSchema.optional(),
            structure: Schema.boolean.optional(),
        }).transform<ReplaceStep>({
            deserialize: value =>
                new ReplaceStep(
                    value.from,
                    value.to,
                    value.slice ?? Slice.empty,
                    !!value.structure,
                ),
            serialize: value => ({
                stepType: "replace",
                from: value.from,
                to: value.to,
                // Serialized only when available by ProseMirror:
                // https://github.com/ProseMirror/prosemirror-transform/blob/8d6be028eebb28a2d981dee146eacdd2c1cffcd4/src/replace_step.ts#L66-L67
                slice: value.slice.size > 0 ? value.slice : undefined,
                structure: value.structure ? true : undefined,
            }),
        });

        const ReplaceAroundStepSchema = Schema.object({
            stepType: Schema.value("replaceAround"),
            from: Schema.integer.min(0),
            to: Schema.integer.min(0),
            gapFrom: Schema.integer,
            gapTo: Schema.integer,
            // We don't check that the content is valid because structure updates may only
            // include a node, no children.
            slice: UncheckedSliceSchema.optional(),
            insert: Schema.integer,
            structure: Schema.boolean.optional(),
        }).transform<ReplaceAroundStep>({
            deserialize: value =>
                new ReplaceAroundStep(
                    value.from,
                    value.to,
                    value.gapFrom,
                    value.gapTo,
                    value.slice ?? Slice.empty,
                    value.insert,
                    !!value.structure,
                ),
            serialize: value => ({
                stepType: "replaceAround",
                from: value.from,
                to: value.to,
                gapFrom: value.gapFrom,
                gapTo: value.gapTo,
                insert: value.insert,
                // Serialized only when available by ProseMirror:
                // https://github.com/ProseMirror/prosemirror-transform/blob/8d6be028eebb28a2d981dee146eacdd2c1cffcd4/src/replace_step.ts#L145-L146
                slice: value.slice.size > 0 ? value.slice : undefined,
                structure: value.structure ? true : undefined,
            }),
        });

        const RemoveAllMarksStepSchema = Schema.object({
            stepType: Schema.value("removeAllMarks"),
            mark: MarkUnionSchema,
        }).transform<RemoveAllMarksStep>({
            deserialize: value => new RemoveAllMarksStep(value.mark),
            serialize: value => ({
                stepType: "removeAllMarks",
                mark: value.mark,
            }),
        });

        const AddMarksAfterRemoveAllStepSchema = Schema.object({
            stepType: Schema.value("addMarksAfterRemoveAll"),
            mark: MarkUnionSchema,
            ranges: Schema.array(AddMarksAfterRemoveAllStepRangeSchema),
        }).transform<AddMarksAfterRemoveAllStep>({
            deserialize: value => new AddMarksAfterRemoveAllStep(value.mark, value.ranges),
            serialize: value => ({
                stepType: "addMarksAfterRemoveAll",
                mark: value.mark,
                ranges: value.ranges,
            }),
        });

        const stepSchemas: {
            [Key in keyof StepByJsonId]: Schema<StepByJsonId[Key]>;
        } = {
            attr: AttrStepSchema,
            docAttr: DocAttrStepSchema,
            addMark: AddMarkStepSchema,
            removeMark: RemoveMarkStepSchema,
            addNodeMark: AddNodeMarkStepSchema,
            removeNodeMark: RemoveNodeMarkStepSchema,
            replace: ReplaceStepSchema,
            replaceAround: ReplaceAroundStepSchema,
            removeAllMarks: RemoveAllMarksStepSchema,
            addMarksAfterRemoveAll: AddMarksAfterRemoveAllStepSchema,
        };

        const StepSchema = UnionSchema._new(stepSchemas, {
            getType: step => assertExists((step as any).jsonID),
            serializedTypeKey: "stepType",
        }) as UnionSchema<any> as UnionSchema<Step>;

        return StepSchema;
    };

    return {
        TopNodeType,
        UncheckedTopNodeType,
        Mark: MarkUnionSchema,
        createStepSchema,
    };
}
