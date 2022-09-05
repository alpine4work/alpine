import {DynamoKeyAttributeSchema} from "~/server/dynamo/internal/dynamo-key-attribute-schema";
import {DynamoTableSchema} from "~/server/dynamo/internal/dynamo-table-schema";

const DocumentsTable = new DynamoTableSchema({
    name: "Documents",
    partitions: {
        Document: {
            keyAttributes: {
                documentId: DynamoKeyAttributeSchema.id,
            },
            ranges: {
                Metadata: {
                    keyAttributes: {},
                    records: {
                        Metadata: {
                            attributes: {
                                // TODO(calebmer): version, title
                            },
                        },
                    },
                },
                StepsAfterSnapshot: {
                    keyAttributes: {
                        version: DynamoKeyAttributeSchema.integer,
                    },
                    records: {
                        Step: {
                            attributes: {
                                // TODO(calebmer): version, step
                            },
                        },
                    },
                },
                Snapshot: {
                    keyAttributes: {},
                    records: {
                        Snapshot: {
                            attributes: {
                                // TODO(calebmer): version, doc
                            },
                        },
                    },
                },
                StepsBeforeSnapshot: {
                    keyAttributes: {
                        version: DynamoKeyAttributeSchema.integer,
                    },
                    records: {
                        Step: {
                            attributes: {
                                // TODO(calebmer): version, step
                            },
                        },
                    },
                },
            },
        },
    },
});
