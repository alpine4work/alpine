import {DurableObjectValue} from "~/collaboration-worker/durable-object-value";
import {
    DocumentCollaborationCommittedStep,
    DocumentCollaborationCommittedStepSchema,
} from "~/shared/documents/document-collaboration-schema";
import {assert} from "~/shared/helpers/control/assert";
import {Id} from "~/shared/id/id";
import {Schema, SchemaSerializedValue, SchemaType} from "~/shared/schema/schema";

export const DocumentCollaborationStepRangeSchema = Schema.object({
    startAfter: Schema.integer,
    end: Schema.integer,
});
export type DocumentCollaborationStepRange = SchemaType<
    typeof DocumentCollaborationStepRangeSchema
>;

const KEY_PREFIX = "s";

// TODO: add some sort of in-memory cache so we don't have to pay money for most step reads?
// TODO: accept steps larger than 128kb by chunking steps across several keys
export class DocumentCollaborationStepStore {
    constructor(
        private readonly state: DurableObjectState,
        private readonly documentId: Id,
        private readonly versionsRange: DurableObjectValue<DocumentCollaborationStepRange>,
    ) {}

    private getStepKeyForVersion(version: number): string {
        return `${KEY_PREFIX}-${version.toString(16).padStart(16, "0")}`;
    }

    async readStepsSince(
        startAfter: number,
    ): Promise<ReadonlyArray<DocumentCollaborationCommittedStep>> {
        return this.readStepsBetween(startAfter, this.versionsRange.get().end);
    }

    async readStepsBetween(
        startAfter: number,
        end: number,
    ): Promise<ReadonlyArray<DocumentCollaborationCommittedStep>> {
        assert(startAfter < end);

        return this.state.blockConcurrencyWhile(async () => {
            const versionsRange = this.versionsRange.get();

            // TODO: fetch earlier steps from server on-demand
            assert(startAfter >= versionsRange.startAfter, "cannot fetch earlier steps");
            assert(end <= versionsRange.end, "cannot fetch versions from the future");

            const rawSteps = await this.state.storage.list({
                startAfter: this.getStepKeyForVersion(startAfter),
                end: this.getStepKeyForVersion(end + 1),
            });

            let expectedVersion = startAfter + 1;
            const steps = [];
            for (const rawStep of rawSteps.values()) {
                const step = DocumentCollaborationCommittedStepSchema.deserialize(
                    rawStep as SchemaSerializedValue,
                );
                assert(step.version === expectedVersion);
                expectedVersion++;
                steps.push(step);
            }
            return steps;
        });
    }

    writeCommittedSteps(steps: ReadonlyArray<DocumentCollaborationCommittedStep>) {
        assert(steps.length);
        let prevVersion = this.versionsRange.get().end;
        for (const step of steps) {
            assert(step.version === prevVersion + 1);
            prevVersion++;
            void this.state.storage.put(
                this.getStepKeyForVersion(step.version),
                DocumentCollaborationCommittedStepSchema.serialize(step),
            );
        }
        this.versionsRange.set({
            ...this.versionsRange.get(),
            end: prevVersion,
        });
    }
}
