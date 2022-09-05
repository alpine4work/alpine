import {paramCase} from "change-case";
import fs from "fs-extra";
import path from "path";
import {
    DynamoKeyAttributeSchema,
    DynamoKeyAttributeSchemaType,
} from "~/server/dynamo/internal/dynamo-key-attribute-schema";
import {
    DynamoPartitionDescription,
    DynamoPartitionSchema,
    DynamoPartitionSchemaConfig,
} from "~/server/dynamo/internal/old-dynamo-partition-schema";
import {repoDirectoryPath} from "~/server/helpers/repo-directory-path";
import {scheduleMicrotask} from "~/shared/helpers/async/schedule-microtask";
import {assert} from "~/shared/helpers/control/assert";
import {quote} from "~/shared/helpers/string/quote";

const dynamoGeneratedDirectoryPath = path.join(repoDirectoryPath, "server/dynamo/generated");

export type DynamoTableDescription = {
    readonly name: string;
    readonly partitionByName: {readonly [name: string]: DynamoPartitionDescription};
};

// TODO(calebmer): Test that no file exports a `DynamoTableSchema` instance!
// You should only be able to access a DynamoDB table from the file where it
// was defined.
//
// Also check for `DynamoPartitionSchema`, `DynamoPartitionRangeSchema`, and
// `DynamoRecordSchema` exports.

export class DynamoTableSchema {
    public readonly name: string;
    private readonly _lastDescription: DynamoTableDescription | null;

    private _isFrozen = false;

    private readonly _partitionByName = new Map<
        string,
        DynamoPartitionSchema<{[key: string]: unknown}>
    >();

    constructor({name}: {name: string}) {
        this.name = name;

        const tableDescriptionPath = path.join(
            dynamoGeneratedDirectoryPath,
            `dynamo-${paramCase(this.name)}-table-description.json`,
        );

        this._lastDescription = fs.existsSync(tableDescriptionPath)
            ? JSON.parse(fs.readFileSync(tableDescriptionPath, "utf8"))
            : null;

        // Wait for all synchronous module body code to execute. This code should add
        // all partition schemas, range schemas, and record schemas to our table. After
        // synchronous execution is done, we freeze the table schema and check that the
        // table schema matches our generated JSON files.
        scheduleMicrotask(() => {
            this.freeze();

            if (!this._lastDescription) {
                throw new Error(
                    quote`Could not find a generated description for table ${this.name}. Try running \`pnpm migrate\``,
                );
            } else {
                this.checkAgainstDescription(this._lastDescription);
            }
        });
    }

    public freeze() {
        this._isFrozen = true;
    }

    public isFrozen() {
        return this._isFrozen;
    }

    public addPartition<
        PartitionKeyAttributes extends {[key: string]: DynamoKeyAttributeSchema<any>},
    >(
        config: DynamoPartitionSchemaConfig<PartitionKeyAttributes>,
    ): DynamoPartitionSchema<{
        [Key in keyof PartitionKeyAttributes]: DynamoKeyAttributeSchemaType<
            PartitionKeyAttributes[Key]
        >;
    }> {
        assert(!this._isFrozen);
        assert(!this._partitionByName.has(config.name));

        const partition = DynamoPartitionSchema._addToTable(
            this,
            this._lastDescription?.partitionByName[config.name] ?? null,
            config,
        );

        assert(config.name === partition.name);
        this._partitionByName.set(partition.name, partition);
        return partition;
    }

    public getDescription(): DynamoTableDescription {
        assert(this.isFrozen());

        return {
            name: this.name,
            partitionByName: Object.fromEntries(
                Array.from(this._partitionByName, ([name, partition]) => [
                    name,
                    partition.getDescription(),
                ]),
            ),
        };
    }

    public checkAgainstDescription(description: DynamoTableDescription) {
        assert(this.isFrozen());

        if (this.name !== description.name)
            throw new Error(
                quote`Table name mismatch, the name in the database is ${description.name} but the name in the schema is ${this.name}`,
            );

        const partitionNames = new Set(Object.keys(description.partitionByName));

        for (const partition of this._partitionByName.values()) {
            if (!partitionNames.delete(partition.name))
                throw new Error(
                    quote`Partition ${partition.name} exists in the schema but not in the database`,
                );

            partition.checkAgainstDescription(description.partitionByName[partition.name]!);
        }

        for (const partitionName of partitionNames)
            throw new Error(
                quote`Partition ${partitionName} exists in the database but not in the schema`,
            );
    }
}
