import {DynamoKeyAttributeSchema} from "~/server/dynamo/internal/dynamo-key-attribute-schema";
import {DynamoTableSchema} from "~/server/dynamo/internal/dynamo-table-schema";

const DocumentsTable = new DynamoTableSchema({
    name: "Documents",
});

const DocumentPartition = DocumentsTable.addPartition({
    name: "Document",
    keyAttributes: {
        documentId: DynamoKeyAttributeSchema.id,
    },
});

const DocumentMetadataRange = DocumentPartition.addRange({
    name: "Metadata",
    keyAttributes: {},
});

const DocumentMetadataRecord = DocumentMetadataRange.addRecord({
    name: "Metadata",
    attributes: {
        // TODO(calebmer): version, title
    },
});

const DocumentStepsAfterSnapshotRange = DocumentPartition.addRange({
    name: "StepsAfterSnapshot",
    keyAttributes: {
        version: DynamoKeyAttributeSchema.integer,
    },
});

const DocumentStepAfterSnapshotRecord = DocumentStepsAfterSnapshotRange.addRecord({
    name: "StepAfterSnapshot",
    attributes: {
        // TODO(calebmer): version, step
    },
});

const DocumentSnapshotRange = DocumentPartition.addRange({
    name: "Snapshot",
    keyAttributes: {},
});

const DocumentSnapshotRecord = DocumentSnapshotRange.addRecord({
    name: "Step",
    attributes: {
        // TODO(calebmer): version, doc
    },
});

const DocumentStepsBeforeSnapshotRange = DocumentPartition.addRange({
    name: "StepsBeforeSnapshot",
    keyAttributes: {
        version: DynamoKeyAttributeSchema.integer,
    },
});

const DocumentStepBeforeSnapshotRecord = DocumentStepsBeforeSnapshotRange.addRecord({
    name: "StepBeforeSnapshot",
    attributes: {
        // TODO(calebmer): version, step
    },
});
