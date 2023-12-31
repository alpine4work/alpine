import {Schema} from "~/shared/schema/schema.js";

/**
 * Explanation for why a hit has a certain score. If `explain` is set to true
 * on a query this will be included with each hit.
 *
 * Constructed by the [`Explanation` Lucene class][1].
 *
 * [1]: https://github.com/apache/lucene/blob/78b4f75a2c632c84f582e38f2cd79565ae586753/lucene/core/src/java/org/apache/lucene/search/Explanation.java#L27
 */
export type OpensearchSearchHitExplanation = {
    readonly value: number;
    readonly description: string;
    readonly details: ReadonlyArray<OpensearchSearchHitExplanation>;
};

const OpensearchSearchHitExplanationRecursiveSchema =
    Schema.declare<OpensearchSearchHitExplanation>();

export const OpensearchSearchHitExplanationSchema: Schema<OpensearchSearchHitExplanation> =
    Schema.object({
        value: Schema.float,
        description: Schema.string,
        details: Schema.array(OpensearchSearchHitExplanationRecursiveSchema),
    });

OpensearchSearchHitExplanationRecursiveSchema.define(OpensearchSearchHitExplanationSchema);
