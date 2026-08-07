import {Fragment, Node, Slice} from "prosemirror-model";
import {
    AddMarkStep,
    AddNodeMarkStep,
    AttrStep,
    RemoveMarkStep,
    RemoveNodeMarkStep,
    ReplaceAroundStep,
    ReplaceStep,
    Step,
} from "prosemirror-transform";
import {InvalidArgumentError} from "~/shared/error/error.open_source.js";
import {PostContentProsemirrorSchema as schema} from "~/shared/forum/post_content_schema.js";
import {createSchemaForProsemirrorSchema} from "~/shared/prosemirror/create_schema_for_prosemirror_schema.js";
import {SchemaDeserializationError} from "~/shared/schema/schema.open_source.js";

const {TopNodeType, createStepSchema} = createSchemaForProsemirrorSchema(schema);
const StepSchema = createStepSchema();

const testNodes: Array<Node> = [
    schema.node("doc", {}, [schema.node("paragraph", {}, [schema.text("test")])]),
    schema.node("doc", {}, [
        schema.node("paragraph", {}, [
            schema.text("foo"),
            schema.text("test", [
                schema.mark("bold"),
                schema.mark("link", {url: "https://cyberworlds.dev"}),
            ]),
            schema.text("bar", [schema.mark("bold")]),
        ]),
    ]),
    schema.node("doc", {}, [
        schema.node("unorderedListItem", {}, [schema.node("paragraph", {}, [schema.text("test")])]),
    ]),
    schema.node("doc", {}, [
        schema.node("unorderedListItem", {indent: 3}, [
            schema.node("paragraph", {}, [schema.text("test")]),
        ]),
    ]),
];

const testSteps: Array<Step> = [
    new AttrStep(42, "indent", 3),
    new AddMarkStep(42, 44, schema.mark("bold")),
    new RemoveMarkStep(42, 44, schema.mark("bold")),
    new AddNodeMarkStep(42, schema.mark("bold")),
    new RemoveNodeMarkStep(42, schema.mark("bold")),
    new ReplaceStep(42, 44, new Slice(Fragment.from([schema.text("test")]), 0, 0), false),
    new ReplaceStep(42, 44, new Slice(Fragment.from([schema.text("test")]), 1, 0), false),
    new ReplaceStep(42, 44, new Slice(Fragment.from([schema.text("test")]), 0, 1), false),
    new ReplaceStep(42, 44, new Slice(Fragment.from([schema.text("test")]), 1, 1), false),
    new ReplaceStep(42, 44, new Slice(Fragment.empty, 0, 0), false),
    new ReplaceStep(42, 44, new Slice(Fragment.from([schema.text("test")]), 0, 0), true),
    new ReplaceAroundStep(
        42,
        44,
        0,
        0,
        new Slice(Fragment.from([schema.text("test")]), 0, 0),
        1,
        false,
    ),
    new ReplaceAroundStep(42, 44, 0, 0, new Slice(Fragment.empty, 0, 0), 1, false),
    new ReplaceAroundStep(
        42,
        44,
        0,
        0,
        new Slice(Fragment.from([schema.text("test")]), 0, 0),
        1,
        true,
    ),
];

for (const [i, testNode] of testNodes.entries()) {
    test(`serializes test node #${i + 1} to the same JSON as ProseMirror`, () => {
        expect(JSON.parse(JSON.stringify(TopNodeType.serialize(testNode)))).toEqual(
            testNode.toJSON(),
        );
    });

    test(`deserializes test node #${i + 1} to an equivalent node`, () => {
        expect(TopNodeType.deserialize(TopNodeType.serialize(testNode)).eq(testNode)).toEqual(true);
        expect(TopNodeType.deserialize(testNode.toJSON()).eq(testNode)).toEqual(true);
    });
}

for (const [i, testStep] of testSteps.entries()) {
    test(`serializes test step #${i + 1} to the same JSON as ProseMirror`, () => {
        expect(JSON.parse(JSON.stringify(StepSchema.serialize(testStep)))).toEqual(
            testStep.toJSON(),
        );
    });

    test(`deserializes test step #${i + 1} to an equivalent step`, () => {
        expect(StepSchema.deserialize(StepSchema.serialize(testStep)).toJSON()).toEqual(
            testStep.toJSON(),
        );
    });
}

test("does not allow structurally fine but invalid content", () => {
    // This form does not validate child content.
    const node = schema.nodes.doc.create({}, [
        schema.nodes.unorderedListItem.create({}, [
            schema.nodes.unorderedListItem.create({}, [schema.text("test")]),
        ]),
    ]);

    expect(() => TopNodeType.serialize(node)).toThrow(InvalidArgumentError);
    expect(() => TopNodeType.deserialize(node.toJSON())).toThrow(SchemaDeserializationError);
    expect(() => TopNodeType.validate?.(node)).toThrow(InvalidArgumentError);
});
