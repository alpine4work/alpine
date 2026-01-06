import {Node} from "prosemirror-model";
import {createTestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {CohereEmbedEnglishV3LanguageTokenizer} from "~/server/language_models/cohere_embed_english_v3/cohere_embed_english_v3_language_tokenizer.js";
import {
    getFullSearchContentChunk,
    printSearchContentChunk,
} from "~/server/search/data/index/internal/chunk_search_content.js";
import {chunkDocumentSearchContent} from "~/server/search/data/index/internal/get_search_entity.js";
import {parseSearchContent} from "~/server/search/data/index/internal/parse_search_content.js";
import {getAccountIfExists} from "~/server/spaces/get_account.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {AccountModelWithoutSpaceData} from "~/shared/accounts/account_model_without_space.js";
import {ContentMention} from "~/shared/content/content_mention.js";
import {
    RenderContentMentionToTextSearchEntity,
    renderContentMentionToText,
} from "~/shared/content/render_content_mention_to_text.js";
import {
    DocumentContent,
    DocumentContentProsemirrorSchema,
    DocumentWithoutTitleContentProsemirrorSchema,
} from "~/shared/documents/document_content_schema.js";
import {createArrayWithLength} from "~/shared/helpers/array/create_array_with_length.js";
import {emptyArray} from "~/shared/helpers/array/empty_array.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {cast} from "~/shared/helpers/control/cast.js";
import {isNonNullable} from "~/shared/helpers/control/is_non_nullable.js";
import {generateChronologicalId} from "~/shared/id/chronological_id.js";
import {generateId} from "~/shared/id/id.js";
import {AccountId, FileId} from "~/shared/id/types/id_types.js";
import {SearchMentionEntityId} from "~/shared/search/search_entity_id.js";

const schema = DocumentWithoutTitleContentProsemirrorSchema;

const context = createTestContext();

function testGetFullSearchContentChunk(
    content: Node,
    options: {
        tokenizer: CohereEmbedEnglishV3LanguageTokenizer;
        getAccountIfExists: (accountId: AccountId) => AccountModelWithoutSpaceData | null;
        getSearchEntityIfExists: (
            entityId: SearchMentionEntityId,
        ) => RenderContentMentionToTextSearchEntity | null;
        skipParseCorrectnessTests?: boolean;
    },
) {
    const chunk = getFullSearchContentChunk(content, options);

    const text = printSearchContentChunk({
        preamble: {text: "", lineMarginBottom: 0},
        body: chunk,
    }).text;

    if (!options.skipParseCorrectnessTests) {
        const content2 = parseSearchContent(text);

        const chunk2 = getFullSearchContentChunk(content2, options);

        const text2 = printSearchContentChunk({
            preamble: {text: "", lineMarginBottom: 0},
            body: chunk2,
        }).text;

        // Content we get after parsing should equal the content we printed with some
        // acceptable lossiness.
        expect(content2.toJSON()).toEqual(
            dropIgnoredSearchContent(content, {
                getAccountIfExists: options.getAccountIfExists,
                getSearchEntityIfExists: options.getSearchEntityIfExists,
                withoutMarks: false,
            })?.toJSON(),
        );
        expect(text2).toEqual(text);

        const content3 = parseSearchContent(text2);

        // Printing/parsing our parsed content again should give us the exact same
        // content. Parsing/printing should be reversible after we've removed lossy
        // styles.
        expect(content3.toJSON()).toEqual(content2.toJSON());
    }

    return {
        text,
        ...chunk,
    };
}

/**
 * Drop styles that aren't preserved by chunking.
 */
function dropIgnoredSearchContent(
    node: Node,
    options: {
        getAccountIfExists: (accountId: AccountId) => AccountModelWithoutSpaceData | null;
        getSearchEntityIfExists: (
            entityId: SearchMentionEntityId,
        ) => RenderContentMentionToTextSearchEntity | null;
        withoutMarks: boolean;
    },
): Node | null {
    if (node.type.name === "fileRow" || node.type.name === "fileFloat") return null;

    if (node.type.name === "mention") {
        const mention: ContentMention = node.attrs.mention;
        return node.type.schema.text(renderContentMentionToText(mention, options));
    }

    const marks = !options.withoutMarks
        ? node.marks.filter(
              mark =>
                  mark.type.name !== "link" &&
                  mark.type.name !== "comment" &&
                  mark.type.name !== "highlight",
          )
        : emptyArray;

    if (marks.length !== node.marks.length) {
        node = node.mark(marks);
    }

    if (node.type.name === "text") return node;

    if (node.type.name === "codeBlockLine") {
        options = {...options, withoutMarks: true};
    }

    const content = createArrayWithLength(node.content.childCount, index =>
        dropIgnoredSearchContent(node.content.child(index), options),
    ).filter(isNonNullable);

    if (node.type.name === "checkListItem") {
        return assertExists(
            assertExists(node.type.schema.nodes.unorderedListItem).createAndFill(
                {indent: node.attrs.indent},
                content,
            ),
        );
    }

    return assertExists(node.type.createAndFill(node.attrs, content));
}

test("discovers paragraph and sentence structure", async () => {
    const tokenizer = await CohereEmbedEnglishV3LanguageTokenizer.get();
    const getAccountIfExists = () => null;
    const getSearchEntityIfExists = () => null;

    expect(
        testGetFullSearchContentChunk(
            schema.node("doc", {}, [
                schema.node("paragraph", {}, [
                    schema.text(
                        "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Pellentesque facilisis consectetur felis, sed dapibus felis suscipit ac. Proin non condimentum orci, a consequat ex. In hac habitasse platea dictumst. In feugiat libero interdum dolor vestibulum, sit amet pulvinar sem commodo. Integer in tortor cursus, venenatis justo sed, euismod risus. Proin hendrerit facilisis mauris ut sollicitudin. Vivamus dapibus commodo urna, vitae cursus metus sodales sed. Nullam mollis imperdiet tincidunt. Nam at enim dui.",
                    ),
                ]),
                schema.node("paragraph", {}, [
                    schema.text(
                        "Ut suscipit sit amet libero sit amet volutpat. Integer dignissim nec nisl sed faucibus. Duis faucibus porttitor justo a elementum. Etiam pellentesque ligula ac hendrerit elementum. Fusce vitae bibendum erat, vel tristique ante. Donec et lectus vitae lectus vestibulum vestibulum. Etiam arcu metus, placerat quis gravida commodo, ultricies eget enim. Praesent convallis neque id convallis dictum. Donec sodales varius malesuada. Sed at pellentesque tellus. Orci varius natoque penatibus et magnis dis parturient montes, nascetur ridiculus mus. Nulla ut turpis commodo, luctus mi malesuada, venenatis purus. Aliquam erat volutpat. Proin quis bibendum augue. Praesent in lacinia dui.",
                    ),
                ]),
                schema.node("paragraph", {}, [
                    schema.text(
                        "Nulla luctus purus venenatis lacus molestie, vitae pulvinar purus accumsan. Ut diam magna, pretium ac lectus at, condimentum porttitor ligula. Praesent in dignissim turpis, eget scelerisque massa. Donec nunc tellus, finibus quis nisl quis, pharetra mollis elit. In vel auctor eros. Nulla ac quam mi. Pellentesque a arcu eros. Cras felis ligula, vestibulum nec pulvinar quis, efficitur sit amet sapien. Etiam vestibulum id sem eget mollis.",
                    ),
                ]),
            ]),
            {tokenizer, getAccountIfExists, getSearchEntityIfExists},
        ),
    ).toEqual({
        text: `\
Lorem ipsum dolor sit amet, consectetur adipiscing elit. Pellentesque facilisis consectetur felis, sed dapibus felis suscipit ac. Proin non condimentum orci, a consequat ex. In hac habitasse platea dictumst. In feugiat libero interdum dolor vestibulum, sit amet pulvinar sem commodo. Integer in tortor cursus, venenatis justo sed, euismod risus. Proin hendrerit facilisis mauris ut sollicitudin. Vivamus dapibus commodo urna, vitae cursus metus sodales sed. Nullam mollis imperdiet tincidunt. Nam at enim dui.

Ut suscipit sit amet libero sit amet volutpat. Integer dignissim nec nisl sed faucibus. Duis faucibus porttitor justo a elementum. Etiam pellentesque ligula ac hendrerit elementum. Fusce vitae bibendum erat, vel tristique ante. Donec et lectus vitae lectus vestibulum vestibulum. Etiam arcu metus, placerat quis gravida commodo, ultricies eget enim. Praesent convallis neque id convallis dictum. Donec sodales varius malesuada. Sed at pellentesque tellus. Orci varius natoque penatibus et magnis dis parturient montes, nascetur ridiculus mus. Nulla ut turpis commodo, luctus mi malesuada, venenatis purus. Aliquam erat volutpat. Proin quis bibendum augue. Praesent in lacinia dui.

Nulla luctus purus venenatis lacus molestie, vitae pulvinar purus accumsan. Ut diam magna, pretium ac lectus at, condimentum porttitor ligula. Praesent in dignissim turpis, eget scelerisque massa. Donec nunc tellus, finibus quis nisl quis, pharetra mollis elit. In vel auctor eros. Nulla ac quam mi. Pellentesque a arcu eros. Cras felis ligula, vestibulum nec pulvinar quis, efficitur sit amet sapien. Etiam vestibulum id sem eget mollis.`,
        isGroup: true,
        tokenCount: 603,
        context: {sectionHeading: null},
        childChunks: [
            {
                isGroup: false,
                tokenCount: 192,
                context: {sectionHeading: null},
                lineMarginBottom: 2,
                lineMarginTop: 2,
                sentenceChunks: [
                    {
                        text: "Lorem ipsum dolor sit amet, consectetur adipiscing elit.",
                        tokenCount: 21,
                    },
                    {
                        text: "Pellentesque facilisis consectetur felis, sed dapibus felis suscipit ac.",
                        tokenCount: 29,
                    },
                    {
                        text: "Proin non condimentum orci, a consequat ex. In hac habitasse platea dictumst.",
                        tokenCount: 27,
                    },
                    {
                        text: "In feugiat libero interdum dolor vestibulum, sit amet pulvinar sem commodo.",
                        tokenCount: 30,
                    },
                    {
                        text: "Integer in tortor cursus, venenatis justo sed, euismod risus.",
                        tokenCount: 23,
                    },
                    {
                        text: "Proin hendrerit facilisis mauris ut sollicitudin.",
                        tokenCount: 19,
                    },
                    {
                        text: "Vivamus dapibus commodo urna, vitae cursus metus sodales sed.",
                        tokenCount: 23,
                    },
                    {text: "Nullam mollis imperdiet tincidunt.", tokenCount: 13},
                    {text: "Nam at enim dui.", tokenCount: 7},
                ],
            },
            {
                isGroup: false,
                tokenCount: 247,
                context: {sectionHeading: null},
                lineMarginBottom: 2,
                lineMarginTop: 2,
                sentenceChunks: [
                    {
                        text: "Ut suscipit sit amet libero sit amet volutpat.",
                        tokenCount: 19,
                    },
                    {
                        text: "Integer dignissim nec nisl sed faucibus.",
                        tokenCount: 15,
                    },
                    {
                        text: "Duis faucibus porttitor justo a elementum.",
                        tokenCount: 15,
                    },
                    {
                        text: "Etiam pellentesque ligula ac hendrerit elementum.",
                        tokenCount: 16,
                    },
                    {
                        text: "Fusce vitae bibendum erat, vel tristique ante.",
                        tokenCount: 20,
                    },
                    {
                        text: "Donec et lectus vitae lectus vestibulum vestibulum.",
                        tokenCount: 16,
                    },
                    {
                        text: "Etiam arcu metus, placerat quis gravida commodo, ultricies eget enim.",
                        tokenCount: 26,
                    },
                    {
                        text: "Praesent convallis neque id convallis dictum.",
                        tokenCount: 16,
                    },
                    {text: "Donec sodales varius malesuada.", tokenCount: 10},
                    {text: "Sed at pellentesque tellus.", tokenCount: 10},
                    {
                        text: "Orci varius natoque penatibus et magnis dis parturient montes, nascetur ridiculus mus.",
                        tokenCount: 29,
                    },
                    {
                        text: "Nulla ut turpis commodo, luctus mi malesuada, venenatis purus.",
                        tokenCount: 24,
                    },
                    {text: "Aliquam erat volutpat.", tokenCount: 10},
                    {text: "Proin quis bibendum augue.", tokenCount: 11},
                    {text: "Praesent in lacinia dui.", tokenCount: 10},
                ],
            },
            {
                isGroup: false,
                tokenCount: 164,
                context: {sectionHeading: null},
                lineMarginBottom: 2,
                lineMarginTop: 2,
                sentenceChunks: [
                    {
                        text: "Nulla luctus purus venenatis lacus molestie, vitae pulvinar purus accumsan.",
                        tokenCount: 28,
                    },
                    {
                        text: "Ut diam magna, pretium ac lectus at, condimentum porttitor ligula.",
                        tokenCount: 22,
                    },
                    {
                        text: "Praesent in dignissim turpis, eget scelerisque massa.",
                        tokenCount: 22,
                    },
                    {
                        text: "Donec nunc tellus, finibus quis nisl quis, pharetra mollis elit.",
                        tokenCount: 25,
                    },
                    {text: "In vel auctor eros.", tokenCount: 8},
                    {text: "Nulla ac quam mi. Pellentesque a arcu eros.", tokenCount: 17},
                    {
                        text: "Cras felis ligula, vestibulum nec pulvinar quis, efficitur sit amet sapien.",
                        tokenCount: 29,
                    },
                    {text: "Etiam vestibulum id sem eget mollis.", tokenCount: 13},
                ],
            },
        ],
    });
});

test("discovers heading structure", async () => {
    const tokenizer = await CohereEmbedEnglishV3LanguageTokenizer.get();
    const getAccountIfExists = () => null;
    const getSearchEntityIfExists = () => null;

    expect(
        testGetFullSearchContentChunk(
            // C+ content generated by yours truly, ChatGPT.
            schema.node("doc", {}, [
                schema.node("heading", {level: 1}, [
                    schema.text("The Importance of Renewable Energy for a Sustainable Future"),
                ]),
                schema.node("heading", {level: 2}, [
                    schema.text("Addressing Environmental Concerns"),
                ]),
                schema.node("paragraph", {}, [
                    schema.text(
                        "The urgent need for renewable energy arises from the escalating environmental issues caused by conventional energy sources. Fossil fuels, the primary energy source for centuries, emit greenhouse gases, contributing significantly to climate change. Renewable energy, derived from natural resources like sunlight, wind, and water, offers a cleaner alternative, reducing carbon emissions and mitigating environmental degradation. Embracing renewables aligns with global initiatives to combat climate change, preserving ecosystems and safeguarding the planet for future generations.",
                    ),
                ]),
                schema.node("paragraph", {}, [
                    schema.text(
                        "Transitioning to renewable energy sources is not just an environmental imperative but an economic opportunity. Investments in renewable technologies drive innovation and create job opportunities, fostering economic growth. Moreover, the renewable energy sector demonstrates resilience, providing a stable and diverse energy supply that isn’t as vulnerable to geopolitical tensions or market fluctuations as traditional energy sources. By diversifying energy portfolios, nations can enhance energy security and reduce dependence on finite resources.",
                    ),
                ]),
                schema.node("heading", {level: 2}, [
                    schema.text("Advantages and Challenges of Renewable Energy Adoption"),
                ]),
                schema.node("paragraph", {}, [
                    schema.text(
                        "The adoption of renewable energy brings forth numerous advantages, from reducing air and water pollution to improving public health by minimizing respiratory diseases associated with fossil fuel emissions. Additionally, renewable energy systems can be decentralized, allowing communities to generate their power, promoting energy independence. However, challenges exist, including intermittency issues with some renewable sources like solar and wind. Overcoming these challenges requires investments in energy storage technologies and grid modernization to ensure a consistent and reliable energy supply.",
                    ),
                ]),
                schema.node("divider", {}, []),
                schema.node("paragraph", {}, [
                    schema.text(
                        "To realize a sustainable future, a collective effort is necessary. Governments, industries, and individuals must collaborate to accelerate the transition towards renewable energy. Policymakers can implement supportive regulations and incentives to encourage renewable energy adoption, such as tax credits and subsidies for renewable projects. Industries can invest in research and development to enhance renewable technologies’ efficiency and affordability. Individuals can contribute by adopting energy-efficient practices and supporting renewable energy initiatives in their communities. Together, this collective action can pave the way for a sustainable energy future, mitigating environmental impact and ensuring a resilient and thriving planet for generations to come.",
                    ),
                ]),
            ]),
            {tokenizer, getAccountIfExists, getSearchEntityIfExists},
        ),
    ).toEqual({
        text: `\
## The Importance of Renewable Energy for a Sustainable Future

### Addressing Environmental Concerns

The urgent need for renewable energy arises from the escalating environmental issues caused by conventional energy sources. Fossil fuels, the primary energy source for centuries, emit greenhouse gases, contributing significantly to climate change. Renewable energy, derived from natural resources like sunlight, wind, and water, offers a cleaner alternative, reducing carbon emissions and mitigating environmental degradation. Embracing renewables aligns with global initiatives to combat climate change, preserving ecosystems and safeguarding the planet for future generations.

Transitioning to renewable energy sources is not just an environmental imperative but an economic opportunity. Investments in renewable technologies drive innovation and create job opportunities, fostering economic growth. Moreover, the renewable energy sector demonstrates resilience, providing a stable and diverse energy supply that isn’t as vulnerable to geopolitical tensions or market fluctuations as traditional energy sources. By diversifying energy portfolios, nations can enhance energy security and reduce dependence on finite resources.

### Advantages and Challenges of Renewable Energy Adoption

The adoption of renewable energy brings forth numerous advantages, from reducing air and water pollution to improving public health by minimizing respiratory diseases associated with fossil fuel emissions. Additionally, renewable energy systems can be decentralized, allowing communities to generate their power, promoting energy independence. However, challenges exist, including intermittency issues with some renewable sources like solar and wind. Overcoming these challenges requires investments in energy storage technologies and grid modernization to ensure a consistent and reliable energy supply.

---

To realize a sustainable future, a collective effort is necessary. Governments, industries, and individuals must collaborate to accelerate the transition towards renewable energy. Policymakers can implement supportive regulations and incentives to encourage renewable energy adoption, such as tax credits and subsidies for renewable projects. Industries can invest in research and development to enhance renewable technologies’ efficiency and affordability. Individuals can contribute by adopting energy-efficient practices and supporting renewable energy initiatives in their communities. Together, this collective action can pave the way for a sustainable energy future, mitigating environmental impact and ensuring a resilient and thriving planet for generations to come.`,
        isGroup: true,
        tokenCount: 431,
        context: {sectionHeading: null},
        childChunks: [
            {
                isGroup: true,
                tokenCount: 201,
                context: {sectionHeading: null},
                childChunks: [
                    {
                        isGroup: false,
                        tokenCount: 11,
                        context: {sectionHeading: null},
                        sentenceChunks: [
                            {
                                text: "## The Importance of Renewable Energy for a Sustainable Future",
                                tokenCount: 11,
                            },
                        ],
                        lineMarginTop: 2,
                        lineMarginBottom: 2,
                    },
                    {
                        isGroup: false,
                        tokenCount: 6,
                        context: {sectionHeading: null},
                        sentenceChunks: [
                            {text: "### Addressing Environmental Concerns", tokenCount: 6},
                        ],
                        lineMarginTop: 2,
                        lineMarginBottom: 2,
                    },
                    {
                        isGroup: false,
                        tokenCount: 95,
                        context: {sectionHeading: "Addressing Environmental Concerns"},
                        sentenceChunks: [
                            {
                                text: "The urgent need for renewable energy arises from the escalating environmental issues caused by conventional energy sources.",
                                tokenCount: 20,
                            },
                            {
                                text: "Fossil fuels, the primary energy source for centuries, emit greenhouse gases, contributing significantly to climate change.",
                                tokenCount: 21,
                            },
                            {
                                text: "Renewable energy, derived from natural resources like sunlight, wind, and water, offers a cleaner alternative, reducing carbon emissions and mitigating environmental degradation.",
                                tokenCount: 30,
                            },
                            {
                                text: "Embracing renewables aligns with global initiatives to combat climate change, preserving ecosystems and safeguarding the planet for future generations.",
                                tokenCount: 24,
                            },
                        ],
                        lineMarginTop: 2,
                        lineMarginBottom: 2,
                    },
                    {
                        isGroup: false,
                        tokenCount: 89,
                        context: {sectionHeading: "Addressing Environmental Concerns"},
                        sentenceChunks: [
                            {
                                text: "Transitioning to renewable energy sources is not just an environmental imperative but an economic opportunity.",
                                tokenCount: 17,
                            },
                            {
                                text: "Investments in renewable technologies drive innovation and create job opportunities, fostering economic growth.",
                                tokenCount: 16,
                            },
                            {
                                text: "Moreover, the renewable energy sector demonstrates resilience, providing a stable and diverse energy supply that isn’t as vulnerable to geopolitical tensions or market fluctuations as traditional energy sources.",
                                tokenCount: 37,
                            },
                            {
                                text: "By diversifying energy portfolios, nations can enhance energy security and reduce dependence on finite resources.",
                                tokenCount: 19,
                            },
                        ],
                        lineMarginTop: 2,
                        lineMarginBottom: 2,
                    },
                ],
            },
            {
                isGroup: true,
                tokenCount: 105,
                context: {sectionHeading: null},
                childChunks: [
                    {
                        isGroup: false,
                        tokenCount: 10,
                        context: {sectionHeading: null},
                        sentenceChunks: [
                            {
                                text: "### Advantages and Challenges of Renewable Energy Adoption",
                                tokenCount: 10,
                            },
                        ],
                        lineMarginTop: 2,
                        lineMarginBottom: 2,
                    },
                    {
                        isGroup: false,
                        tokenCount: 95,
                        context: {
                            sectionHeading:
                                "Advantages and Challenges of Renewable Energy Adoption",
                        },
                        sentenceChunks: [
                            {
                                text: "The adoption of renewable energy brings forth numerous advantages, from reducing air and water pollution to improving public health by minimizing respiratory diseases associated with fossil fuel emissions.",
                                tokenCount: 32,
                            },
                            {
                                text: "Additionally, renewable energy systems can be decentralized, allowing communities to generate their power, promoting energy independence.",
                                tokenCount: 22,
                            },
                            {
                                text: "However, challenges exist, including intermittency issues with some renewable sources like solar and wind.",
                                tokenCount: 20,
                            },
                            {
                                text: "Overcoming these challenges requires investments in energy storage technologies and grid modernization to ensure a consistent and reliable energy supply.",
                                tokenCount: 21,
                            },
                        ],
                        lineMarginTop: 2,
                        lineMarginBottom: 2,
                    },
                ],
            },
            {
                isGroup: true,
                tokenCount: 125,
                context: {sectionHeading: null},
                childChunks: [
                    {
                        isGroup: false,
                        tokenCount: 3,
                        context: {sectionHeading: null},
                        sentenceChunks: [{text: "---", tokenCount: 3}],
                        lineMarginTop: 2,
                        lineMarginBottom: 2,
                    },
                    {
                        isGroup: false,
                        tokenCount: 122,
                        context: {sectionHeading: null},
                        sentenceChunks: [
                            {
                                text: "To realize a sustainable future, a collective effort is necessary.",
                                tokenCount: 12,
                            },
                            {
                                text: "Governments, industries, and individuals must collaborate to accelerate the transition towards renewable energy.",
                                tokenCount: 16,
                            },
                            {
                                text: "Policymakers can implement supportive regulations and incentives to encourage renewable energy adoption, such as tax credits and subsidies for renewable projects.",
                                tokenCount: 24,
                            },
                            {
                                text: "Industries can invest in research and development to enhance renewable technologies’ efficiency and affordability.",
                                tokenCount: 17,
                            },
                            {
                                text: "Individuals can contribute by adopting energy-efficient practices and supporting renewable energy initiatives in their communities.",
                                tokenCount: 18,
                            },
                            {
                                text: "Together, this collective action can pave the way for a sustainable energy future, mitigating environmental impact and ensuring a resilient and thriving planet for generations to come.",
                                tokenCount: 35,
                            },
                        ],
                        lineMarginTop: 2,
                        lineMarginBottom: 2,
                    },
                ],
            },
        ],
    });
});

test("discovers bullet list structure", async () => {
    const tokenizer = await CohereEmbedEnglishV3LanguageTokenizer.get();
    const getAccountIfExists = () => null;
    const getSearchEntityIfExists = () => null;

    expect(
        testGetFullSearchContentChunk(
            // C+ content generated by yours truly, ChatGPT.
            schema.node("doc", {}, [
                schema.node("heading", {level: 1}, [
                    schema.text("Sustainable Agriculture: Nurturing the Earth and Communities"),
                ]),
                schema.node("orderedListItem", {indent: 0}, [
                    schema.node("paragraph", {}, [schema.text("Soil Health:")]),
                ]),
                schema.node("orderedListItem", {indent: 1}, [
                    schema.node("paragraph", {}, [
                        schema.text(
                            "Preventing Erosion: Sustainable farming practices like crop rotation and cover cropping protect soil from erosion, preserving its fertility.",
                        ),
                    ]),
                ]),
                schema.node("orderedListItem", {indent: 1}, [
                    schema.node("paragraph", {}, [
                        schema.text(
                            "Enhancing Soil Quality: Practices such as composting and reduced tillage improve soil structure and nutrient content.",
                        ),
                    ]),
                ]),
                schema.node("orderedListItem", {indent: 1}, [
                    schema.node("paragraph", {}, [schema.text("Water Conservation:")]),
                ]),
                schema.node("unorderedListItem", {indent: 2}, [
                    schema.node("paragraph", {}, [
                        schema.text(
                            "Reduced Water Usage: Sustainable methods like drip irrigation and rainwater harvesting minimize water waste in agriculture.",
                        ),
                    ]),
                ]),
                schema.node("unorderedListItem", {indent: 2}, [
                    schema.node("paragraph", {}, [
                        schema.text(
                            "Preserving Water Quality: Practices like buffer zones prevent agricultural runoff, preserving water quality in surrounding ecosystems.",
                        ),
                    ]),
                ]),
                schema.node("orderedListItem", {indent: 0}, [
                    schema.node("paragraph", {}, [schema.text("Cost Reduction:")]),
                ]),
                schema.node("orderedListItem", {indent: 1}, [
                    schema.node("paragraph", {}, [
                        schema.text(
                            "Lower Input Costs: Sustainable practices reduce the need for expensive fertilizers and pesticides, lowering production costs.",
                        ),
                    ]),
                ]),
                schema.node("orderedListItem", {indent: 1}, [
                    schema.node("paragraph", {}, [
                        schema.text(
                            "Long-Term Viability: By preserving soil fertility and biodiversity, sustainable agriculture ensures long-term productivity and economic stability for farmers.",
                        ),
                    ]),
                ]),
                schema.node("orderedListItem", {indent: 0}, [
                    schema.node("paragraph", {}, [
                        schema.text(
                            "Consumer Demand: Growing consumer preference for sustainably produced goods creates market opportunities for farmers practicing sustainable agriculture.",
                        ),
                    ]),
                ]),
                schema.node("paragraph", {}, [
                    schema.text(
                        "Sustainable agriculture significantly benefits the environment by promoting soil health, conserving water, and minimizing the negative impact of farming activities on surrounding ecosystems.",
                    ),
                ]),
                schema.node("paragraph", {}, [
                    schema.text(
                        "Adopting sustainable agricultural methods not only reduces costs for farmers but also opens up market opportunities, aligning with consumer preferences and offering long-term economic viability.",
                    ),
                ]),
                schema.node("unorderedListItem", {indent: 0}, [
                    schema.node("paragraph", {}, [
                        schema.text(
                            "Supporting Local Communities: Sustainable agriculture encourages local food production and distribution, supporting local economies and communities.",
                        ),
                    ]),
                ]),
                schema.node("unorderedListItem", {indent: 0}, [
                    schema.node("paragraph", {}, [
                        schema.text(
                            "Food Security: Diverse and sustainable farming methods contribute to food security, ensuring a more resilient food system.",
                        ),
                    ]),
                    schema.node("paragraph", {}, [
                        schema.text(
                            "Here’s a second paragraph in the list item to make sure that works.",
                        ),
                    ]),
                ]),
                schema.node("unorderedListItem", {indent: 0}, [
                    schema.node("paragraph", {}, [
                        schema.text(
                            "Knowledge Sharing: Sustainable farming practices involve education and knowledge sharing within communities, empowering farmers with valuable skills.",
                        ),
                    ]),
                ]),
            ]),
            {tokenizer, getAccountIfExists, getSearchEntityIfExists},
        ),
    ).toEqual({
        text: `\
## Sustainable Agriculture: Nurturing the Earth and Communities

1. Soil Health:
    1. Preventing Erosion: Sustainable farming practices like crop rotation and cover cropping protect soil from erosion, preserving its fertility.
    2. Enhancing Soil Quality: Practices such as composting and reduced tillage improve soil structure and nutrient content.
    3. Water Conservation:
        - Reduced Water Usage: Sustainable methods like drip irrigation and rainwater harvesting minimize water waste in agriculture.
        - Preserving Water Quality: Practices like buffer zones prevent agricultural runoff, preserving water quality in surrounding ecosystems.
2. Cost Reduction:
    1. Lower Input Costs: Sustainable practices reduce the need for expensive fertilizers and pesticides, lowering production costs.
    2. Long-Term Viability: By preserving soil fertility and biodiversity, sustainable agriculture ensures long-term productivity and economic stability for farmers.
3. Consumer Demand: Growing consumer preference for sustainably produced goods creates market opportunities for farmers practicing sustainable agriculture.

Sustainable agriculture significantly benefits the environment by promoting soil health, conserving water, and minimizing the negative impact of farming activities on surrounding ecosystems.

Adopting sustainable agricultural methods not only reduces costs for farmers but also opens up market opportunities, aligning with consumer preferences and offering long-term economic viability.

- Supporting Local Communities: Sustainable agriculture encourages local food production and distribution, supporting local economies and communities.
- Food Security: Diverse and sustainable farming methods contribute to food security, ensuring a more resilient food system.

  Here’s a second paragraph in the list item to make sure that works.
- Knowledge Sharing: Sustainable farming practices involve education and knowledge sharing within communities, empowering farmers with valuable skills.`,
        isGroup: true,
        tokenCount: 330,
        context: {sectionHeading: null},
        childChunks: [
            {
                isGroup: false,
                tokenCount: 11,
                context: {sectionHeading: null},
                sentenceChunks: [
                    {
                        text: "## Sustainable Agriculture: Nurturing the Earth and Communities",
                        tokenCount: 11,
                    },
                ],
                lineMarginTop: 2,
                lineMarginBottom: 2,
            },
            {
                isGroup: true,
                tokenCount: 177,
                context: {
                    sectionHeading: "Sustainable Agriculture: Nurturing the Earth and Communities",
                },
                childChunks: [
                    {
                        isGroup: true,
                        tokenCount: 97,
                        context: {
                            sectionHeading:
                                "Sustainable Agriculture: Nurturing the Earth and Communities",
                        },
                        childChunks: [
                            {
                                isGroup: false,
                                tokenCount: 5,
                                context: {
                                    sectionHeading:
                                        "Sustainable Agriculture: Nurturing the Earth and Communities",
                                },
                                sentenceChunks: [{text: "1. Soil Health:", tokenCount: 5}],
                                lineMarginTop: 1,
                                lineMarginBottom: 1,
                            },
                            {
                                isGroup: false,
                                tokenCount: 24,
                                context: {
                                    sectionHeading:
                                        "Sustainable Agriculture: Nurturing the Earth and Communities",
                                },
                                sentenceChunks: [
                                    {
                                        text: "    1. Preventing Erosion: Sustainable farming practices like crop rotation and cover cropping protect soil from erosion, preserving its fertility.",
                                        tokenCount: 24,
                                    },
                                ],
                                lineMarginTop: 1,
                                lineMarginBottom: 1,
                            },
                            {
                                isGroup: false,
                                tokenCount: 23,
                                context: {
                                    sectionHeading:
                                        "Sustainable Agriculture: Nurturing the Earth and Communities",
                                },
                                sentenceChunks: [
                                    {
                                        text: "    2. Enhancing Soil Quality: Practices such as composting and reduced tillage improve soil structure and nutrient content.",
                                        tokenCount: 23,
                                    },
                                ],
                                lineMarginTop: 1,
                                lineMarginBottom: 1,
                            },
                            {
                                isGroup: true,
                                tokenCount: 45,
                                context: {
                                    sectionHeading:
                                        "Sustainable Agriculture: Nurturing the Earth and Communities",
                                },
                                childChunks: [
                                    {
                                        isGroup: false,
                                        tokenCount: 5,
                                        context: {
                                            sectionHeading:
                                                "Sustainable Agriculture: Nurturing the Earth and Communities",
                                        },
                                        sentenceChunks: [
                                            {text: "    3. Water Conservation:", tokenCount: 5},
                                        ],
                                        lineMarginTop: 1,
                                        lineMarginBottom: 1,
                                    },
                                    {
                                        isGroup: false,
                                        tokenCount: 20,
                                        context: {
                                            sectionHeading:
                                                "Sustainable Agriculture: Nurturing the Earth and Communities",
                                        },
                                        sentenceChunks: [
                                            {
                                                text: "        - Reduced Water Usage: Sustainable methods like drip irrigation and rainwater harvesting minimize water waste in agriculture.",
                                                tokenCount: 20,
                                            },
                                        ],
                                        lineMarginTop: 1,
                                        lineMarginBottom: 1,
                                    },
                                    {
                                        isGroup: false,
                                        tokenCount: 20,
                                        context: {
                                            sectionHeading:
                                                "Sustainable Agriculture: Nurturing the Earth and Communities",
                                        },
                                        sentenceChunks: [
                                            {
                                                text: "        - Preserving Water Quality: Practices like buffer zones prevent agricultural runoff, preserving water quality in surrounding ecosystems.",
                                                tokenCount: 20,
                                            },
                                        ],
                                        lineMarginTop: 1,
                                        lineMarginBottom: 1,
                                    },
                                ],
                            },
                        ],
                    },
                    {
                        isGroup: true,
                        tokenCount: 58,
                        context: {
                            sectionHeading:
                                "Sustainable Agriculture: Nurturing the Earth and Communities",
                        },
                        childChunks: [
                            {
                                isGroup: false,
                                tokenCount: 5,
                                context: {
                                    sectionHeading:
                                        "Sustainable Agriculture: Nurturing the Earth and Communities",
                                },
                                sentenceChunks: [{text: "2. Cost Reduction:", tokenCount: 5}],
                                lineMarginTop: 1,
                                lineMarginBottom: 1,
                            },
                            {
                                isGroup: false,
                                tokenCount: 25,
                                context: {
                                    sectionHeading:
                                        "Sustainable Agriculture: Nurturing the Earth and Communities",
                                },
                                sentenceChunks: [
                                    {
                                        text: "    1. Lower Input Costs: Sustainable practices reduce the need for expensive fertilizers and pesticides, lowering production costs.",
                                        tokenCount: 25,
                                    },
                                ],
                                lineMarginTop: 1,
                                lineMarginBottom: 1,
                            },
                            {
                                isGroup: false,
                                tokenCount: 28,
                                context: {
                                    sectionHeading:
                                        "Sustainable Agriculture: Nurturing the Earth and Communities",
                                },
                                sentenceChunks: [
                                    {
                                        text: "    2. Long-Term Viability: By preserving soil fertility and biodiversity, sustainable agriculture ensures long-term productivity and economic stability for farmers.",
                                        tokenCount: 28,
                                    },
                                ],
                                lineMarginTop: 1,
                                lineMarginBottom: 1,
                            },
                        ],
                    },
                    {
                        isGroup: false,
                        tokenCount: 22,
                        context: {
                            sectionHeading:
                                "Sustainable Agriculture: Nurturing the Earth and Communities",
                        },
                        sentenceChunks: [
                            {
                                text: "3. Consumer Demand: Growing consumer preference for sustainably produced goods creates market opportunities for farmers practicing sustainable agriculture.",
                                tokenCount: 22,
                            },
                        ],
                        lineMarginTop: 1,
                        lineMarginBottom: 1,
                    },
                ],
            },
            {
                isGroup: false,
                tokenCount: 30,
                context: {
                    sectionHeading: "Sustainable Agriculture: Nurturing the Earth and Communities",
                },
                sentenceChunks: [
                    {
                        text: "Sustainable agriculture significantly benefits the environment by promoting soil health, conserving water, and minimizing the negative impact of farming activities on surrounding ecosystems.",
                        tokenCount: 30,
                    },
                ],
                lineMarginTop: 2,
                lineMarginBottom: 2,
            },
            {
                isGroup: false,
                tokenCount: 31,
                context: {
                    sectionHeading: "Sustainable Agriculture: Nurturing the Earth and Communities",
                },
                sentenceChunks: [
                    {
                        text: "Adopting sustainable agricultural methods not only reduces costs for farmers but also opens up market opportunities, aligning with consumer preferences and offering long-term economic viability.",
                        tokenCount: 31,
                    },
                ],
                lineMarginTop: 2,
                lineMarginBottom: 2,
            },
            {
                isGroup: true,
                tokenCount: 81,
                context: {
                    sectionHeading: "Sustainable Agriculture: Nurturing the Earth and Communities",
                },
                childChunks: [
                    {
                        isGroup: false,
                        tokenCount: 20,
                        context: {
                            sectionHeading:
                                "Sustainable Agriculture: Nurturing the Earth and Communities",
                        },
                        sentenceChunks: [
                            {
                                text: "- Supporting Local Communities: Sustainable agriculture encourages local food production and distribution, supporting local economies and communities.",
                                tokenCount: 20,
                            },
                        ],
                        lineMarginTop: 1,
                        lineMarginBottom: 1,
                    },
                    {
                        isGroup: false,
                        tokenCount: 39,
                        context: {
                            sectionHeading:
                                "Sustainable Agriculture: Nurturing the Earth and Communities",
                        },
                        sentenceChunks: [
                            {
                                text: "- Food Security: Diverse and sustainable farming methods contribute to food security, ensuring a more resilient food system.",
                                tokenCount: 23,
                            },
                            {
                                text: "\n\n  Here’s a second paragraph in the list item to make sure that works.",
                                tokenCount: 16,
                            },
                        ],
                        lineMarginTop: 1,
                        lineMarginBottom: 1,
                    },
                    {
                        isGroup: false,
                        tokenCount: 22,
                        context: {
                            sectionHeading:
                                "Sustainable Agriculture: Nurturing the Earth and Communities",
                        },
                        sentenceChunks: [
                            {
                                text: "- Knowledge Sharing: Sustainable farming practices involve education and knowledge sharing within communities, empowering farmers with valuable skills.",
                                tokenCount: 22,
                            },
                        ],
                        lineMarginTop: 1,
                        lineMarginBottom: 1,
                    },
                ],
            },
        ],
    });
});

test("discovers long ordered list structure", async () => {
    const tokenizer = await CohereEmbedEnglishV3LanguageTokenizer.get();
    const getAccountIfExists = () => null;
    const getSearchEntityIfExists = () => null;

    expect(
        testGetFullSearchContentChunk(
            // C+ content generated by yours truly, ChatGPT.
            schema.node("doc", {}, [
                ...createArrayWithLength(110, index =>
                    schema.node("orderedListItem", {indent: 0}, [
                        schema.node("paragraph", {}, [schema.text(`${index + 1}`)]),
                    ]),
                ),
                schema.node("orderedListItem", {indent: 1}, [
                    schema.node("paragraph", {}, [schema.text("a")]),
                ]),
                schema.node("orderedListItem", {indent: 1}, [
                    schema.node("paragraph", {}, [schema.text("b")]),
                ]),
            ]),
            {tokenizer, getAccountIfExists, getSearchEntityIfExists},
        ),
    ).toEqual({
        text: `\
1. 1
2. 2
3. 3
4. 4
5. 5
6. 6
7. 7
8. 8
9. 9
10. 10
11. 11
12. 12
13. 13
14. 14
15. 15
16. 16
17. 17
18. 18
19. 19
20. 20
21. 21
22. 22
23. 23
24. 24
25. 25
26. 26
27. 27
28. 28
29. 29
30. 30
31. 31
32. 32
33. 33
34. 34
35. 35
36. 36
37. 37
38. 38
39. 39
40. 40
41. 41
42. 42
43. 43
44. 44
45. 45
46. 46
47. 47
48. 48
49. 49
50. 50
51. 51
52. 52
53. 53
54. 54
55. 55
56. 56
57. 57
58. 58
59. 59
60. 60
61. 61
62. 62
63. 63
64. 64
65. 65
66. 66
67. 67
68. 68
69. 69
70. 70
71. 71
72. 72
73. 73
74. 74
75. 75
76. 76
77. 77
78. 78
79. 79
80. 80
81. 81
82. 82
83. 83
84. 84
85. 85
86. 86
87. 87
88. 88
89. 89
90. 90
91. 91
92. 92
93. 93
94. 94
95. 95
96. 96
97. 97
98. 98
99. 99
99. 100
99. 101
99. 102
99. 103
99. 104
99. 105
99. 106
99. 107
99. 108
99. 109
99. 110
    1. a
    2. b`,
        isGroup: true,
        context: {sectionHeading: null},
        tokenCount: 336,
        childChunks: [
            {
                isGroup: false,
                tokenCount: 3,
                context: {sectionHeading: null},
                sentenceChunks: [{text: "1. 1", tokenCount: 3}],
                lineMarginTop: 1,
                lineMarginBottom: 1,
            },
            {
                isGroup: false,
                tokenCount: 3,
                context: {sectionHeading: null},
                sentenceChunks: [{text: "2. 2", tokenCount: 3}],
                lineMarginTop: 1,
                lineMarginBottom: 1,
            },
            {
                isGroup: false,
                tokenCount: 3,
                context: {sectionHeading: null},
                sentenceChunks: [{text: "3. 3", tokenCount: 3}],
                lineMarginTop: 1,
                lineMarginBottom: 1,
            },
            {
                isGroup: false,
                tokenCount: 3,
                context: {sectionHeading: null},
                sentenceChunks: [{text: "4. 4", tokenCount: 3}],
                lineMarginTop: 1,
                lineMarginBottom: 1,
            },
            {
                isGroup: false,
                tokenCount: 3,
                context: {sectionHeading: null},
                sentenceChunks: [{text: "5. 5", tokenCount: 3}],
                lineMarginTop: 1,
                lineMarginBottom: 1,
            },
            {
                isGroup: false,
                tokenCount: 3,
                context: {sectionHeading: null},
                sentenceChunks: [{text: "6. 6", tokenCount: 3}],
                lineMarginTop: 1,
                lineMarginBottom: 1,
            },
            {
                isGroup: false,
                tokenCount: 3,
                context: {sectionHeading: null},
                sentenceChunks: [{text: "7. 7", tokenCount: 3}],
                lineMarginTop: 1,
                lineMarginBottom: 1,
            },
            {
                isGroup: false,
                tokenCount: 3,
                context: {sectionHeading: null},
                sentenceChunks: [{text: "8. 8", tokenCount: 3}],
                lineMarginTop: 1,
                lineMarginBottom: 1,
            },
            {
                isGroup: false,
                tokenCount: 3,
                context: {sectionHeading: null},
                sentenceChunks: [{text: "9. 9", tokenCount: 3}],
                lineMarginTop: 1,
                lineMarginBottom: 1,
            },
            {
                isGroup: false,
                tokenCount: 3,
                context: {sectionHeading: null},
                sentenceChunks: [{text: "10. 10", tokenCount: 3}],
                lineMarginTop: 1,
                lineMarginBottom: 1,
            },
            {
                isGroup: false,
                tokenCount: 3,
                context: {sectionHeading: null},
                sentenceChunks: [{text: "11. 11", tokenCount: 3}],
                lineMarginTop: 1,
                lineMarginBottom: 1,
            },
            {
                isGroup: false,
                tokenCount: 3,
                context: {sectionHeading: null},
                sentenceChunks: [{text: "12. 12", tokenCount: 3}],
                lineMarginTop: 1,
                lineMarginBottom: 1,
            },
            {
                isGroup: false,
                tokenCount: 3,
                context: {sectionHeading: null},
                sentenceChunks: [{text: "13. 13", tokenCount: 3}],
                lineMarginTop: 1,
                lineMarginBottom: 1,
            },
            {
                isGroup: false,
                tokenCount: 3,
                context: {sectionHeading: null},
                sentenceChunks: [{text: "14. 14", tokenCount: 3}],
                lineMarginTop: 1,
                lineMarginBottom: 1,
            },
            {
                isGroup: false,
                tokenCount: 3,
                context: {sectionHeading: null},
                sentenceChunks: [{text: "15. 15", tokenCount: 3}],
                lineMarginTop: 1,
                lineMarginBottom: 1,
            },
            {
                isGroup: false,
                tokenCount: 3,
                context: {sectionHeading: null},
                sentenceChunks: [{text: "16. 16", tokenCount: 3}],
                lineMarginTop: 1,
                lineMarginBottom: 1,
            },
            {
                isGroup: false,
                tokenCount: 3,
                context: {sectionHeading: null},
                sentenceChunks: [{text: "17. 17", tokenCount: 3}],
                lineMarginTop: 1,
                lineMarginBottom: 1,
            },
            {
                isGroup: false,
                tokenCount: 3,
                context: {sectionHeading: null},
                sentenceChunks: [{text: "18. 18", tokenCount: 3}],
                lineMarginTop: 1,
                lineMarginBottom: 1,
            },
            {
                isGroup: false,
                tokenCount: 3,
                context: {sectionHeading: null},
                sentenceChunks: [{text: "19. 19", tokenCount: 3}],
                lineMarginTop: 1,
                lineMarginBottom: 1,
            },
            {
                isGroup: false,
                tokenCount: 3,
                context: {sectionHeading: null},
                sentenceChunks: [{text: "20. 20", tokenCount: 3}],
                lineMarginTop: 1,
                lineMarginBottom: 1,
            },
            {
                isGroup: false,
                tokenCount: 3,
                context: {sectionHeading: null},
                sentenceChunks: [{text: "21. 21", tokenCount: 3}],
                lineMarginTop: 1,
                lineMarginBottom: 1,
            },
            {
                isGroup: false,
                tokenCount: 3,
                context: {sectionHeading: null},
                sentenceChunks: [{text: "22. 22", tokenCount: 3}],
                lineMarginTop: 1,
                lineMarginBottom: 1,
            },
            {
                isGroup: false,
                tokenCount: 3,
                context: {sectionHeading: null},
                sentenceChunks: [{text: "23. 23", tokenCount: 3}],
                lineMarginTop: 1,
                lineMarginBottom: 1,
            },
            {
                isGroup: false,
                tokenCount: 3,
                context: {sectionHeading: null},
                sentenceChunks: [{text: "24. 24", tokenCount: 3}],
                lineMarginTop: 1,
                lineMarginBottom: 1,
            },
            {
                isGroup: false,
                tokenCount: 3,
                context: {sectionHeading: null},
                sentenceChunks: [{text: "25. 25", tokenCount: 3}],
                lineMarginTop: 1,
                lineMarginBottom: 1,
            },
            {
                isGroup: false,
                tokenCount: 3,
                context: {sectionHeading: null},
                sentenceChunks: [{text: "26. 26", tokenCount: 3}],
                lineMarginTop: 1,
                lineMarginBottom: 1,
            },
            {
                isGroup: false,
                tokenCount: 3,
                context: {sectionHeading: null},
                sentenceChunks: [{text: "27. 27", tokenCount: 3}],
                lineMarginTop: 1,
                lineMarginBottom: 1,
            },
            {
                isGroup: false,
                tokenCount: 3,
                context: {sectionHeading: null},
                sentenceChunks: [{text: "28. 28", tokenCount: 3}],
                lineMarginTop: 1,
                lineMarginBottom: 1,
            },
            {
                isGroup: false,
                tokenCount: 3,
                context: {sectionHeading: null},
                sentenceChunks: [{text: "29. 29", tokenCount: 3}],
                lineMarginTop: 1,
                lineMarginBottom: 1,
            },
            {
                isGroup: false,
                tokenCount: 3,
                context: {sectionHeading: null},
                sentenceChunks: [{text: "30. 30", tokenCount: 3}],
                lineMarginTop: 1,
                lineMarginBottom: 1,
            },
            {
                isGroup: false,
                tokenCount: 3,
                context: {sectionHeading: null},
                sentenceChunks: [{text: "31. 31", tokenCount: 3}],
                lineMarginTop: 1,
                lineMarginBottom: 1,
            },
            {
                isGroup: false,
                tokenCount: 3,
                context: {sectionHeading: null},
                sentenceChunks: [{text: "32. 32", tokenCount: 3}],
                lineMarginTop: 1,
                lineMarginBottom: 1,
            },
            {
                isGroup: false,
                tokenCount: 3,
                context: {sectionHeading: null},
                sentenceChunks: [{text: "33. 33", tokenCount: 3}],
                lineMarginTop: 1,
                lineMarginBottom: 1,
            },
            {
                isGroup: false,
                tokenCount: 3,
                context: {sectionHeading: null},
                sentenceChunks: [{text: "34. 34", tokenCount: 3}],
                lineMarginTop: 1,
                lineMarginBottom: 1,
            },
            {
                isGroup: false,
                tokenCount: 3,
                context: {sectionHeading: null},
                sentenceChunks: [{text: "35. 35", tokenCount: 3}],
                lineMarginTop: 1,
                lineMarginBottom: 1,
            },
            {
                isGroup: false,
                tokenCount: 3,
                context: {sectionHeading: null},
                sentenceChunks: [{text: "36. 36", tokenCount: 3}],
                lineMarginTop: 1,
                lineMarginBottom: 1,
            },
            {
                isGroup: false,
                tokenCount: 3,
                context: {sectionHeading: null},
                sentenceChunks: [{text: "37. 37", tokenCount: 3}],
                lineMarginTop: 1,
                lineMarginBottom: 1,
            },
            {
                isGroup: false,
                tokenCount: 3,
                context: {sectionHeading: null},
                sentenceChunks: [{text: "38. 38", tokenCount: 3}],
                lineMarginTop: 1,
                lineMarginBottom: 1,
            },
            {
                isGroup: false,
                tokenCount: 3,
                context: {sectionHeading: null},
                sentenceChunks: [{text: "39. 39", tokenCount: 3}],
                lineMarginTop: 1,
                lineMarginBottom: 1,
            },
            {
                isGroup: false,
                tokenCount: 3,
                context: {sectionHeading: null},
                sentenceChunks: [{text: "40. 40", tokenCount: 3}],
                lineMarginTop: 1,
                lineMarginBottom: 1,
            },
            {
                isGroup: false,
                tokenCount: 3,
                context: {sectionHeading: null},
                sentenceChunks: [{text: "41. 41", tokenCount: 3}],
                lineMarginTop: 1,
                lineMarginBottom: 1,
            },
            {
                isGroup: false,
                tokenCount: 3,
                context: {sectionHeading: null},
                sentenceChunks: [{text: "42. 42", tokenCount: 3}],
                lineMarginTop: 1,
                lineMarginBottom: 1,
            },
            {
                isGroup: false,
                tokenCount: 3,
                context: {sectionHeading: null},
                sentenceChunks: [{text: "43. 43", tokenCount: 3}],
                lineMarginTop: 1,
                lineMarginBottom: 1,
            },
            {
                isGroup: false,
                tokenCount: 3,
                context: {sectionHeading: null},
                sentenceChunks: [{text: "44. 44", tokenCount: 3}],
                lineMarginTop: 1,
                lineMarginBottom: 1,
            },
            {
                isGroup: false,
                tokenCount: 3,
                context: {sectionHeading: null},
                sentenceChunks: [{text: "45. 45", tokenCount: 3}],
                lineMarginTop: 1,
                lineMarginBottom: 1,
            },
            {
                isGroup: false,
                tokenCount: 3,
                context: {sectionHeading: null},
                sentenceChunks: [{text: "46. 46", tokenCount: 3}],
                lineMarginTop: 1,
                lineMarginBottom: 1,
            },
            {
                isGroup: false,
                tokenCount: 3,
                context: {sectionHeading: null},
                sentenceChunks: [{text: "47. 47", tokenCount: 3}],
                lineMarginTop: 1,
                lineMarginBottom: 1,
            },
            {
                isGroup: false,
                tokenCount: 3,
                context: {sectionHeading: null},
                sentenceChunks: [{text: "48. 48", tokenCount: 3}],
                lineMarginTop: 1,
                lineMarginBottom: 1,
            },
            {
                isGroup: false,
                tokenCount: 3,
                context: {sectionHeading: null},
                sentenceChunks: [{text: "49. 49", tokenCount: 3}],
                lineMarginTop: 1,
                lineMarginBottom: 1,
            },
            {
                isGroup: false,
                tokenCount: 3,
                context: {sectionHeading: null},
                sentenceChunks: [{text: "50. 50", tokenCount: 3}],
                lineMarginTop: 1,
                lineMarginBottom: 1,
            },
            {
                isGroup: false,
                tokenCount: 3,
                context: {sectionHeading: null},
                sentenceChunks: [{text: "51. 51", tokenCount: 3}],
                lineMarginTop: 1,
                lineMarginBottom: 1,
            },
            {
                isGroup: false,
                tokenCount: 3,
                context: {sectionHeading: null},
                sentenceChunks: [{text: "52. 52", tokenCount: 3}],
                lineMarginTop: 1,
                lineMarginBottom: 1,
            },
            {
                isGroup: false,
                tokenCount: 3,
                context: {sectionHeading: null},
                sentenceChunks: [{text: "53. 53", tokenCount: 3}],
                lineMarginTop: 1,
                lineMarginBottom: 1,
            },
            {
                isGroup: false,
                tokenCount: 3,
                context: {sectionHeading: null},
                sentenceChunks: [{text: "54. 54", tokenCount: 3}],
                lineMarginTop: 1,
                lineMarginBottom: 1,
            },
            {
                isGroup: false,
                tokenCount: 3,
                context: {sectionHeading: null},
                sentenceChunks: [{text: "55. 55", tokenCount: 3}],
                lineMarginTop: 1,
                lineMarginBottom: 1,
            },
            {
                isGroup: false,
                tokenCount: 3,
                context: {sectionHeading: null},
                sentenceChunks: [{text: "56. 56", tokenCount: 3}],
                lineMarginTop: 1,
                lineMarginBottom: 1,
            },
            {
                isGroup: false,
                tokenCount: 3,
                context: {sectionHeading: null},
                sentenceChunks: [{text: "57. 57", tokenCount: 3}],
                lineMarginTop: 1,
                lineMarginBottom: 1,
            },
            {
                isGroup: false,
                tokenCount: 3,
                context: {sectionHeading: null},
                sentenceChunks: [{text: "58. 58", tokenCount: 3}],
                lineMarginTop: 1,
                lineMarginBottom: 1,
            },
            {
                isGroup: false,
                tokenCount: 3,
                context: {sectionHeading: null},
                sentenceChunks: [{text: "59. 59", tokenCount: 3}],
                lineMarginTop: 1,
                lineMarginBottom: 1,
            },
            {
                isGroup: false,
                tokenCount: 3,
                context: {sectionHeading: null},
                sentenceChunks: [{text: "60. 60", tokenCount: 3}],
                lineMarginTop: 1,
                lineMarginBottom: 1,
            },
            {
                isGroup: false,
                tokenCount: 3,
                context: {sectionHeading: null},
                sentenceChunks: [{text: "61. 61", tokenCount: 3}],
                lineMarginTop: 1,
                lineMarginBottom: 1,
            },
            {
                isGroup: false,
                tokenCount: 3,
                context: {sectionHeading: null},
                sentenceChunks: [{text: "62. 62", tokenCount: 3}],
                lineMarginTop: 1,
                lineMarginBottom: 1,
            },
            {
                isGroup: false,
                tokenCount: 3,
                context: {sectionHeading: null},
                sentenceChunks: [{text: "63. 63", tokenCount: 3}],
                lineMarginTop: 1,
                lineMarginBottom: 1,
            },
            {
                isGroup: false,
                tokenCount: 3,
                context: {sectionHeading: null},
                sentenceChunks: [{text: "64. 64", tokenCount: 3}],
                lineMarginTop: 1,
                lineMarginBottom: 1,
            },
            {
                isGroup: false,
                tokenCount: 3,
                context: {sectionHeading: null},
                sentenceChunks: [{text: "65. 65", tokenCount: 3}],
                lineMarginTop: 1,
                lineMarginBottom: 1,
            },
            {
                isGroup: false,
                tokenCount: 3,
                context: {sectionHeading: null},
                sentenceChunks: [{text: "66. 66", tokenCount: 3}],
                lineMarginTop: 1,
                lineMarginBottom: 1,
            },
            {
                isGroup: false,
                tokenCount: 3,
                context: {sectionHeading: null},
                sentenceChunks: [{text: "67. 67", tokenCount: 3}],
                lineMarginTop: 1,
                lineMarginBottom: 1,
            },
            {
                isGroup: false,
                tokenCount: 3,
                context: {sectionHeading: null},
                sentenceChunks: [{text: "68. 68", tokenCount: 3}],
                lineMarginTop: 1,
                lineMarginBottom: 1,
            },
            {
                isGroup: false,
                tokenCount: 3,
                context: {sectionHeading: null},
                sentenceChunks: [{text: "69. 69", tokenCount: 3}],
                lineMarginTop: 1,
                lineMarginBottom: 1,
            },
            {
                isGroup: false,
                tokenCount: 3,
                context: {sectionHeading: null},
                sentenceChunks: [{text: "70. 70", tokenCount: 3}],
                lineMarginTop: 1,
                lineMarginBottom: 1,
            },
            {
                isGroup: false,
                tokenCount: 3,
                context: {sectionHeading: null},
                sentenceChunks: [{text: "71. 71", tokenCount: 3}],
                lineMarginTop: 1,
                lineMarginBottom: 1,
            },
            {
                isGroup: false,
                tokenCount: 3,
                context: {sectionHeading: null},
                sentenceChunks: [{text: "72. 72", tokenCount: 3}],
                lineMarginTop: 1,
                lineMarginBottom: 1,
            },
            {
                isGroup: false,
                tokenCount: 3,
                context: {sectionHeading: null},
                sentenceChunks: [{text: "73. 73", tokenCount: 3}],
                lineMarginTop: 1,
                lineMarginBottom: 1,
            },
            {
                isGroup: false,
                tokenCount: 3,
                context: {sectionHeading: null},
                sentenceChunks: [{text: "74. 74", tokenCount: 3}],
                lineMarginTop: 1,
                lineMarginBottom: 1,
            },
            {
                isGroup: false,
                tokenCount: 3,
                context: {sectionHeading: null},
                sentenceChunks: [{text: "75. 75", tokenCount: 3}],
                lineMarginTop: 1,
                lineMarginBottom: 1,
            },
            {
                isGroup: false,
                tokenCount: 3,
                context: {sectionHeading: null},
                sentenceChunks: [{text: "76. 76", tokenCount: 3}],
                lineMarginTop: 1,
                lineMarginBottom: 1,
            },
            {
                isGroup: false,
                tokenCount: 3,
                context: {sectionHeading: null},
                sentenceChunks: [{text: "77. 77", tokenCount: 3}],
                lineMarginTop: 1,
                lineMarginBottom: 1,
            },
            {
                isGroup: false,
                tokenCount: 3,
                context: {sectionHeading: null},
                sentenceChunks: [{text: "78. 78", tokenCount: 3}],
                lineMarginTop: 1,
                lineMarginBottom: 1,
            },
            {
                isGroup: false,
                tokenCount: 3,
                context: {sectionHeading: null},
                sentenceChunks: [{text: "79. 79", tokenCount: 3}],
                lineMarginTop: 1,
                lineMarginBottom: 1,
            },
            {
                isGroup: false,
                tokenCount: 3,
                context: {sectionHeading: null},
                sentenceChunks: [{text: "80. 80", tokenCount: 3}],
                lineMarginTop: 1,
                lineMarginBottom: 1,
            },
            {
                isGroup: false,
                tokenCount: 3,
                context: {sectionHeading: null},
                sentenceChunks: [{text: "81. 81", tokenCount: 3}],
                lineMarginTop: 1,
                lineMarginBottom: 1,
            },
            {
                isGroup: false,
                tokenCount: 3,
                context: {sectionHeading: null},
                sentenceChunks: [{text: "82. 82", tokenCount: 3}],
                lineMarginTop: 1,
                lineMarginBottom: 1,
            },
            {
                isGroup: false,
                tokenCount: 3,
                context: {sectionHeading: null},
                sentenceChunks: [{text: "83. 83", tokenCount: 3}],
                lineMarginTop: 1,
                lineMarginBottom: 1,
            },
            {
                isGroup: false,
                tokenCount: 3,
                context: {sectionHeading: null},
                sentenceChunks: [{text: "84. 84", tokenCount: 3}],
                lineMarginTop: 1,
                lineMarginBottom: 1,
            },
            {
                isGroup: false,
                tokenCount: 3,
                context: {sectionHeading: null},
                sentenceChunks: [{text: "85. 85", tokenCount: 3}],
                lineMarginTop: 1,
                lineMarginBottom: 1,
            },
            {
                isGroup: false,
                tokenCount: 3,
                context: {sectionHeading: null},
                sentenceChunks: [{text: "86. 86", tokenCount: 3}],
                lineMarginTop: 1,
                lineMarginBottom: 1,
            },
            {
                isGroup: false,
                tokenCount: 3,
                context: {sectionHeading: null},
                sentenceChunks: [{text: "87. 87", tokenCount: 3}],
                lineMarginTop: 1,
                lineMarginBottom: 1,
            },
            {
                isGroup: false,
                tokenCount: 3,
                context: {sectionHeading: null},
                sentenceChunks: [{text: "88. 88", tokenCount: 3}],
                lineMarginTop: 1,
                lineMarginBottom: 1,
            },
            {
                isGroup: false,
                tokenCount: 3,
                context: {sectionHeading: null},
                sentenceChunks: [{text: "89. 89", tokenCount: 3}],
                lineMarginTop: 1,
                lineMarginBottom: 1,
            },
            {
                isGroup: false,
                tokenCount: 3,
                context: {sectionHeading: null},
                sentenceChunks: [{text: "90. 90", tokenCount: 3}],
                lineMarginTop: 1,
                lineMarginBottom: 1,
            },
            {
                isGroup: false,
                tokenCount: 3,
                context: {sectionHeading: null},
                sentenceChunks: [{text: "91. 91", tokenCount: 3}],
                lineMarginTop: 1,
                lineMarginBottom: 1,
            },
            {
                isGroup: false,
                tokenCount: 3,
                context: {sectionHeading: null},
                sentenceChunks: [{text: "92. 92", tokenCount: 3}],
                lineMarginTop: 1,
                lineMarginBottom: 1,
            },
            {
                isGroup: false,
                tokenCount: 3,
                context: {sectionHeading: null},
                sentenceChunks: [{text: "93. 93", tokenCount: 3}],
                lineMarginTop: 1,
                lineMarginBottom: 1,
            },
            {
                isGroup: false,
                tokenCount: 3,
                context: {sectionHeading: null},
                sentenceChunks: [{text: "94. 94", tokenCount: 3}],
                lineMarginTop: 1,
                lineMarginBottom: 1,
            },
            {
                isGroup: false,
                tokenCount: 3,
                context: {sectionHeading: null},
                sentenceChunks: [{text: "95. 95", tokenCount: 3}],
                lineMarginTop: 1,
                lineMarginBottom: 1,
            },
            {
                isGroup: false,
                tokenCount: 3,
                context: {sectionHeading: null},
                sentenceChunks: [{text: "96. 96", tokenCount: 3}],
                lineMarginTop: 1,
                lineMarginBottom: 1,
            },
            {
                isGroup: false,
                tokenCount: 3,
                context: {sectionHeading: null},
                sentenceChunks: [{text: "97. 97", tokenCount: 3}],
                lineMarginTop: 1,
                lineMarginBottom: 1,
            },
            {
                isGroup: false,
                tokenCount: 3,
                context: {sectionHeading: null},
                sentenceChunks: [{text: "98. 98", tokenCount: 3}],
                lineMarginTop: 1,
                lineMarginBottom: 1,
            },
            {
                isGroup: false,
                tokenCount: 3,
                context: {sectionHeading: null},
                sentenceChunks: [{text: "99. 99", tokenCount: 3}],
                lineMarginTop: 1,
                lineMarginBottom: 1,
            },
            {
                isGroup: false,
                tokenCount: 3,
                context: {sectionHeading: null},
                sentenceChunks: [{text: "99. 100", tokenCount: 3}],
                lineMarginTop: 1,
                lineMarginBottom: 1,
            },
            {
                isGroup: false,
                tokenCount: 3,
                context: {sectionHeading: null},
                sentenceChunks: [{text: "99. 101", tokenCount: 3}],
                lineMarginTop: 1,
                lineMarginBottom: 1,
            },
            {
                isGroup: false,
                tokenCount: 3,
                context: {sectionHeading: null},
                sentenceChunks: [{text: "99. 102", tokenCount: 3}],
                lineMarginTop: 1,
                lineMarginBottom: 1,
            },
            {
                isGroup: false,
                tokenCount: 3,
                context: {sectionHeading: null},
                sentenceChunks: [{text: "99. 103", tokenCount: 3}],
                lineMarginTop: 1,
                lineMarginBottom: 1,
            },
            {
                isGroup: false,
                tokenCount: 3,
                context: {sectionHeading: null},
                sentenceChunks: [{text: "99. 104", tokenCount: 3}],
                lineMarginTop: 1,
                lineMarginBottom: 1,
            },
            {
                isGroup: false,
                tokenCount: 3,
                context: {sectionHeading: null},
                sentenceChunks: [{text: "99. 105", tokenCount: 3}],
                lineMarginTop: 1,
                lineMarginBottom: 1,
            },
            {
                isGroup: false,
                tokenCount: 3,
                context: {sectionHeading: null},
                sentenceChunks: [{text: "99. 106", tokenCount: 3}],
                lineMarginTop: 1,
                lineMarginBottom: 1,
            },
            {
                isGroup: false,
                tokenCount: 3,
                context: {sectionHeading: null},
                sentenceChunks: [{text: "99. 107", tokenCount: 3}],
                lineMarginTop: 1,
                lineMarginBottom: 1,
            },
            {
                isGroup: false,
                tokenCount: 3,
                context: {sectionHeading: null},
                sentenceChunks: [{text: "99. 108", tokenCount: 3}],
                lineMarginTop: 1,
                lineMarginBottom: 1,
            },
            {
                isGroup: false,
                tokenCount: 3,
                context: {sectionHeading: null},
                sentenceChunks: [{text: "99. 109", tokenCount: 3}],
                lineMarginTop: 1,
                lineMarginBottom: 1,
            },
            {
                isGroup: true,
                tokenCount: 9,
                context: {sectionHeading: null},
                childChunks: [
                    {
                        isGroup: false,
                        tokenCount: 3,
                        context: {sectionHeading: null},
                        sentenceChunks: [{text: "99. 110", tokenCount: 3}],
                        lineMarginTop: 1,
                        lineMarginBottom: 1,
                    },
                    {
                        isGroup: false,
                        tokenCount: 3,
                        context: {sectionHeading: null},
                        sentenceChunks: [{text: "    1. a", tokenCount: 3}],
                        lineMarginTop: 1,
                        lineMarginBottom: 1,
                    },
                    {
                        isGroup: false,
                        tokenCount: 3,
                        context: {sectionHeading: null},
                        sentenceChunks: [{text: "    2. b", tokenCount: 3}],
                        lineMarginTop: 1,
                        lineMarginBottom: 1,
                    },
                ],
            },
        ],
    });
});

test("discovers paragraph introduction structure", async () => {
    const tokenizer = await CohereEmbedEnglishV3LanguageTokenizer.get();
    const getAccountIfExists = () => null;
    const getSearchEntityIfExists = () => null;

    expect(
        testGetFullSearchContentChunk(
            schema.node("doc", {}, [
                schema.node("paragraph", {}, [schema.text("This is a paragraph.")]),
                schema.node("paragraph", {}, [
                    schema.text("This is a paragraph introducing the next bulleted list:"),
                ]),
                schema.node("unorderedListItem", {indent: 0}, [
                    schema.node("paragraph", {}, [schema.text("Item 1")]),
                ]),
                schema.node("unorderedListItem", {indent: 0}, [
                    schema.node("paragraph", {}, [schema.text("Item 2")]),
                ]),
                schema.node("unorderedListItem", {indent: 0}, [
                    schema.node("paragraph", {}, [schema.text("Item 3")]),
                ]),
                schema.node("paragraph", {}, [schema.text("This is another paragraph.")]),
            ]),
            {tokenizer, getAccountIfExists, getSearchEntityIfExists},
        ),
    ).toEqual({
        text: `\
This is a paragraph.

This is a paragraph introducing the next bulleted list:

- Item 1
- Item 2
- Item 3

This is another paragraph.`,
        isGroup: true,
        context: {sectionHeading: null},
        tokenCount: 30,
        childChunks: [
            {
                isGroup: false,
                tokenCount: 5,
                context: {sectionHeading: null},
                sentenceChunks: [{text: "This is a paragraph.", tokenCount: 5}],
                lineMarginTop: 2,
                lineMarginBottom: 2,
            },
            {
                isGroup: true,
                context: {sectionHeading: null},
                tokenCount: 20,
                childChunks: [
                    {
                        isGroup: false,
                        tokenCount: 11,
                        context: {sectionHeading: null},
                        sentenceChunks: [
                            {
                                text: "This is a paragraph introducing the next bulleted list:",
                                tokenCount: 11,
                            },
                        ],
                        lineMarginTop: 2,
                        lineMarginBottom: 2,
                    },
                    {
                        isGroup: true,
                        context: {sectionHeading: null},
                        tokenCount: 9,
                        childChunks: [
                            {
                                isGroup: false,
                                tokenCount: 3,
                                context: {sectionHeading: null},
                                sentenceChunks: [{text: "- Item 1", tokenCount: 3}],
                                lineMarginTop: 1,
                                lineMarginBottom: 1,
                            },
                            {
                                isGroup: false,
                                tokenCount: 3,
                                context: {sectionHeading: null},
                                sentenceChunks: [{text: "- Item 2", tokenCount: 3}],
                                lineMarginTop: 1,
                                lineMarginBottom: 1,
                            },
                            {
                                isGroup: false,
                                tokenCount: 3,
                                context: {sectionHeading: null},
                                sentenceChunks: [{text: "- Item 3", tokenCount: 3}],
                                lineMarginTop: 1,
                                lineMarginBottom: 1,
                            },
                        ],
                    },
                ],
            },
            {
                isGroup: false,
                tokenCount: 5,
                context: {sectionHeading: null},
                sentenceChunks: [{text: "This is another paragraph.", tokenCount: 5}],
                lineMarginTop: 2,
                lineMarginBottom: 2,
            },
        ],
    });
});

test("discovers quote block structure", async () => {
    const tokenizer = await CohereEmbedEnglishV3LanguageTokenizer.get();
    const getAccountIfExists = () => null;
    const getSearchEntityIfExists = () => null;

    expect(
        testGetFullSearchContentChunk(
            schema.node("doc", {}, [
                schema.node("paragraph", {}, [
                    schema.text(
                        "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Pellentesque facilisis consectetur felis, sed dapibus felis suscipit ac. Proin non condimentum orci, a consequat ex. In hac habitasse platea dictumst. In feugiat libero interdum dolor vestibulum, sit amet pulvinar sem commodo. Integer in tortor cursus, venenatis justo sed, euismod risus. Proin hendrerit facilisis mauris ut sollicitudin. Vivamus dapibus commodo urna, vitae cursus metus sodales sed. Nullam mollis imperdiet tincidunt. Nam at enim dui.",
                    ),
                ]),
                schema.node("quoteBlock", {}, [
                    schema.node("paragraph", {}, [
                        schema.text(
                            "Ut suscipit sit amet libero sit amet volutpat. Integer dignissim nec nisl sed faucibus. Duis faucibus porttitor justo a elementum. Etiam pellentesque ligula ac hendrerit elementum. Fusce vitae bibendum erat, vel tristique ante.",
                        ),
                    ]),
                    schema.node("orderedListItem", {indent: 0}, [
                        schema.node("paragraph", {}, [
                            schema.text("Donec et lectus vitae lectus vestibulum vestibulum."),
                        ]),
                    ]),
                    schema.node("orderedListItem", {indent: 0}, [
                        schema.node("paragraph", {}, [
                            schema.text(
                                "Etiam arcu metus, placerat quis gravida commodo, ultricies eget enim.",
                            ),
                        ]),
                    ]),
                    schema.node("orderedListItem", {indent: 0}, [
                        schema.node("paragraph", {}, [
                            schema.text("Praesent convallis neque id convallis dictum."),
                        ]),
                    ]),
                    schema.node("paragraph", {}, [
                        schema.text(
                            "Donec sodales varius malesuada. Sed at pellentesque tellus. Orci varius natoque penatibus et magnis dis parturient montes, nascetur ridiculus mus. Nulla ut turpis commodo, luctus mi malesuada, venenatis purus. Aliquam erat volutpat. Proin quis bibendum augue. Praesent in lacinia dui.",
                        ),
                    ]),
                    schema.node("paragraph", {}, [
                        schema.text(
                            "Nulla luctus purus venenatis lacus molestie, vitae pulvinar purus accumsan. Ut diam magna, pretium ac lectus at, condimentum porttitor ligula. Praesent in dignissim turpis,",
                        ),
                        schema.node("break"),
                        schema.text(
                            "eget scelerisque massa. Donec nunc tellus, finibus quis nisl quis, pharetra mollis elit. In vel auctor eros. Nulla ac quam mi. Pellentesque a arcu eros. Cras felis ligula, vestibulum nec pulvinar quis, efficitur sit amet sapien. Etiam vestibulum id sem eget mollis.",
                        ),
                    ]),
                ]),
            ]),
            {tokenizer, getAccountIfExists, getSearchEntityIfExists},
        ),
    ).toEqual({
        text: `\
Lorem ipsum dolor sit amet, consectetur adipiscing elit. Pellentesque facilisis consectetur felis, sed dapibus felis suscipit ac. Proin non condimentum orci, a consequat ex. In hac habitasse platea dictumst. In feugiat libero interdum dolor vestibulum, sit amet pulvinar sem commodo. Integer in tortor cursus, venenatis justo sed, euismod risus. Proin hendrerit facilisis mauris ut sollicitudin. Vivamus dapibus commodo urna, vitae cursus metus sodales sed. Nullam mollis imperdiet tincidunt. Nam at enim dui.

> Ut suscipit sit amet libero sit amet volutpat. Integer dignissim nec nisl sed faucibus. Duis faucibus porttitor justo a elementum. Etiam pellentesque ligula ac hendrerit elementum. Fusce vitae bibendum erat, vel tristique ante.
>
> 1. Donec et lectus vitae lectus vestibulum vestibulum.
> 2. Etiam arcu metus, placerat quis gravida commodo, ultricies eget enim.
> 3. Praesent convallis neque id convallis dictum.
>
> Donec sodales varius malesuada. Sed at pellentesque tellus. Orci varius natoque penatibus et magnis dis parturient montes, nascetur ridiculus mus. Nulla ut turpis commodo, luctus mi malesuada, venenatis purus. Aliquam erat volutpat. Proin quis bibendum augue. Praesent in lacinia dui.
>
> Nulla luctus purus venenatis lacus molestie, vitae pulvinar purus accumsan. Ut diam magna, pretium ac lectus at, condimentum porttitor ligula. Praesent in dignissim turpis,\\
> eget scelerisque massa. Donec nunc tellus, finibus quis nisl quis, pharetra mollis elit. In vel auctor eros. Nulla ac quam mi. Pellentesque a arcu eros. Cras felis ligula, vestibulum nec pulvinar quis, efficitur sit amet sapien. Etiam vestibulum id sem eget mollis.`,
        isGroup: true,
        tokenCount: 620,
        context: {sectionHeading: null},
        childChunks: [
            {
                isGroup: false,
                tokenCount: 192,
                context: {sectionHeading: null},
                sentenceChunks: [
                    {
                        text: "Lorem ipsum dolor sit amet, consectetur adipiscing elit.",
                        tokenCount: 21,
                    },
                    {
                        text: "Pellentesque facilisis consectetur felis, sed dapibus felis suscipit ac.",
                        tokenCount: 29,
                    },
                    {
                        text: "Proin non condimentum orci, a consequat ex. In hac habitasse platea dictumst.",
                        tokenCount: 27,
                    },
                    {
                        text: "In feugiat libero interdum dolor vestibulum, sit amet pulvinar sem commodo.",
                        tokenCount: 30,
                    },
                    {
                        text: "Integer in tortor cursus, venenatis justo sed, euismod risus.",
                        tokenCount: 23,
                    },
                    {text: "Proin hendrerit facilisis mauris ut sollicitudin.", tokenCount: 19},
                    {
                        text: "Vivamus dapibus commodo urna, vitae cursus metus sodales sed.",
                        tokenCount: 23,
                    },
                    {text: "Nullam mollis imperdiet tincidunt.", tokenCount: 13},
                    {text: "Nam at enim dui.", tokenCount: 7},
                ],
                lineMarginTop: 2,
                lineMarginBottom: 2,
            },
            {
                isGroup: false,
                tokenCount: 428,
                context: {sectionHeading: null},
                sentenceChunks: [
                    {text: "> Ut suscipit sit amet libero sit amet volutpat.", tokenCount: 20},
                    {text: "Integer dignissim nec nisl sed faucibus.", tokenCount: 15},
                    {text: "Duis faucibus porttitor justo a elementum.", tokenCount: 15},
                    {text: "Etiam pellentesque ligula ac hendrerit elementum.", tokenCount: 16},
                    {text: "Fusce vitae bibendum erat, vel tristique ante.", tokenCount: 20},
                    {
                        text: "\n>\n> 1. Donec et lectus vitae lectus vestibulum vestibulum.",
                        tokenCount: 20,
                    },
                    {
                        text: "\n> 2. Etiam arcu metus, placerat quis gravida commodo, ultricies eget enim.",
                        tokenCount: 29,
                    },
                    {
                        text: "\n> 3. Praesent convallis neque id convallis dictum.",
                        tokenCount: 19,
                    },
                    {text: "\n>\n> Donec sodales varius malesuada.", tokenCount: 12},
                    {text: "Sed at pellentesque tellus.", tokenCount: 10},
                    {
                        text: "Orci varius natoque penatibus et magnis dis parturient montes, nascetur ridiculus mus.",
                        tokenCount: 29,
                    },
                    {
                        text: "Nulla ut turpis commodo, luctus mi malesuada, venenatis purus.",
                        tokenCount: 24,
                    },
                    {text: "Aliquam erat volutpat.", tokenCount: 10},
                    {text: "Proin quis bibendum augue.", tokenCount: 11},
                    {text: "Praesent in lacinia dui.", tokenCount: 10},
                    {
                        text: "\n>\n> Nulla luctus purus venenatis lacus molestie, vitae pulvinar purus accumsan.",
                        tokenCount: 30,
                    },
                    {
                        text: "Ut diam magna, pretium ac lectus at, condimentum porttitor ligula.",
                        tokenCount: 22,
                    },
                    {text: "Praesent in dignissim turpis,\\", tokenCount: 14},
                    {text: "\n>", tokenCount: 1},
                    {text: "eget scelerisque massa.", tokenCount: 9},
                    {
                        text: "Donec nunc tellus, finibus quis nisl quis, pharetra mollis elit.",
                        tokenCount: 25,
                    },
                    {text: "In vel auctor eros.", tokenCount: 8},
                    {text: "Nulla ac quam mi. Pellentesque a arcu eros.", tokenCount: 17},
                    {
                        text: "Cras felis ligula, vestibulum nec pulvinar quis, efficitur sit amet sapien.",
                        tokenCount: 29,
                    },
                    {text: "Etiam vestibulum id sem eget mollis.", tokenCount: 13},
                ],
                lineMarginTop: 2,
                lineMarginBottom: 2,
            },
        ],
    });
});

test("empty quote blocks and list items", async () => {
    const tokenizer = await CohereEmbedEnglishV3LanguageTokenizer.get();
    const getAccountIfExists = () => null;
    const getSearchEntityIfExists = () => null;

    expect(
        testGetFullSearchContentChunk(
            schema.node("doc", {}, [
                schema.node("paragraph", {}, [schema.text("Test 1:")]),
                schema.node("quoteBlock", {}, [schema.node("paragraph", {}, [])]),
                schema.node("paragraph", {}, [schema.text("Test 2:")]),
                schema.node("unorderedListItem", {}, [schema.node("paragraph", {}, [])]),
                schema.node("paragraph", {}, [schema.text("Test 3:")]),
                schema.node("orderedListItem", {}, [schema.node("paragraph", {}, [])]),
                schema.node("paragraph", {}, [schema.text("Test 4:")]),
                schema.node("orderedListItem", {}, [
                    schema.node("paragraph", {}, [schema.text("a")]),
                ]),
                schema.node("orderedListItem", {}, [schema.node("paragraph", {}, [])]),
                schema.node("orderedListItem", {}, [
                    schema.node("paragraph", {}, [schema.text("b")]),
                ]),
            ]),
            {tokenizer, getAccountIfExists, getSearchEntityIfExists},
        ),
    ).toEqual({
        text: `\
Test 1:

>

Test 2:

-

Test 3:

1.

Test 4:

1. a
2.
3. b`,
        isGroup: true,
        context: {sectionHeading: null},
        tokenCount: 24,
        childChunks: [
            {
                isGroup: true,
                context: {sectionHeading: null},
                tokenCount: 4,
                childChunks: [
                    {
                        isGroup: false,
                        tokenCount: 3,
                        context: {sectionHeading: null},
                        sentenceChunks: [{text: "Test 1:", tokenCount: 3}],
                        lineMarginTop: 2,
                        lineMarginBottom: 2,
                    },
                    {
                        isGroup: false,
                        tokenCount: 1,
                        context: {sectionHeading: null},
                        sentenceChunks: [{text: ">", tokenCount: 1}],
                        lineMarginTop: 2,
                        lineMarginBottom: 2,
                    },
                ],
            },
            {
                isGroup: true,
                context: {sectionHeading: null},
                tokenCount: 4,
                childChunks: [
                    {
                        isGroup: false,
                        tokenCount: 3,
                        context: {sectionHeading: null},
                        sentenceChunks: [{text: "Test 2:", tokenCount: 3}],
                        lineMarginTop: 2,
                        lineMarginBottom: 2,
                    },
                    {
                        isGroup: false,
                        tokenCount: 1,
                        context: {sectionHeading: null},
                        sentenceChunks: [{text: "-", tokenCount: 1}],
                        lineMarginTop: 1,
                        lineMarginBottom: 1,
                    },
                ],
            },
            {
                isGroup: true,
                context: {sectionHeading: null},
                tokenCount: 5,
                childChunks: [
                    {
                        isGroup: false,
                        tokenCount: 3,
                        context: {sectionHeading: null},
                        sentenceChunks: [{text: "Test 3:", tokenCount: 3}],
                        lineMarginTop: 2,
                        lineMarginBottom: 2,
                    },
                    {
                        isGroup: false,
                        tokenCount: 2,
                        context: {sectionHeading: null},
                        sentenceChunks: [{text: "1.", tokenCount: 2}],
                        lineMarginTop: 1,
                        lineMarginBottom: 1,
                    },
                ],
            },
            {
                isGroup: true,
                context: {sectionHeading: null},
                tokenCount: 11,
                childChunks: [
                    {
                        isGroup: false,
                        tokenCount: 3,
                        context: {sectionHeading: null},
                        sentenceChunks: [{text: "Test 4:", tokenCount: 3}],
                        lineMarginTop: 2,
                        lineMarginBottom: 2,
                    },
                    {
                        isGroup: true,
                        context: {sectionHeading: null},
                        tokenCount: 8,
                        childChunks: [
                            {
                                isGroup: false,
                                tokenCount: 3,
                                context: {sectionHeading: null},
                                sentenceChunks: [{text: "1. a", tokenCount: 3}],
                                lineMarginTop: 1,
                                lineMarginBottom: 1,
                            },
                            {
                                isGroup: false,
                                tokenCount: 2,
                                context: {sectionHeading: null},
                                sentenceChunks: [{text: "2.", tokenCount: 2}],
                                lineMarginTop: 1,
                                lineMarginBottom: 1,
                            },
                            {
                                isGroup: false,
                                tokenCount: 3,
                                context: {sectionHeading: null},
                                sentenceChunks: [{text: "3. b", tokenCount: 3}],
                                lineMarginTop: 1,
                                lineMarginBottom: 1,
                            },
                        ],
                    },
                ],
            },
        ],
    });
});

test("discovers code block structure", async () => {
    const tokenizer = await CohereEmbedEnglishV3LanguageTokenizer.get();
    const getAccountIfExists = () => null;
    const getSearchEntityIfExists = () => null;

    expect(
        testGetFullSearchContentChunk(
            schema.node("doc", {}, [
                schema.node("paragraph", {}, [
                    schema.text(
                        "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Pellentesque facilisis consectetur felis, sed dapibus felis suscipit ac. Proin non condimentum orci, a consequat ex. In hac habitasse platea dictumst. In feugiat libero interdum dolor vestibulum, sit amet pulvinar sem commodo. Integer in tortor cursus, venenatis justo sed, euismod risus. Proin hendrerit facilisis mauris ut sollicitudin. Vivamus dapibus commodo urna, vitae cursus metus sodales sed. Nullam mollis imperdiet tincidunt. Nam at enim dui.",
                    ),
                ]),
                schema.node("codeBlock", {}, [
                    schema.node("codeBlockLine", [], [schema.text("let a = 1;")]),
                    schema.node("codeBlockLine", [], [schema.text("let b = 1;")]),
                    schema.node("codeBlockLine", [], [schema.text("let c = a + b;")]),
                    schema.node("codeBlockLine", [], []),
                    schema.node("codeBlockLine", [], [schema.text("console.log(c);")]),
                ]),
                schema.node("codeBlock", {}, [
                    schema.node(
                        "codeBlockLine",
                        [],
                        [schema.text("// Code that ends with a newline")],
                    ),
                    schema.node("codeBlockLine", [], [schema.text("return;")]),
                    schema.node("codeBlockLine", [], []),
                ]),
                schema.node("codeBlock", {}, [
                    schema.node("codeBlockLine", [], []),
                    schema.node(
                        "codeBlockLine",
                        [],
                        [schema.text("// Code that starts with a newline")],
                    ),
                    schema.node("codeBlockLine", [], [schema.text("return;")]),
                ]),
            ]),
            {tokenizer, getAccountIfExists, getSearchEntityIfExists},
        ),
    ).toEqual({
        text: `\
Lorem ipsum dolor sit amet, consectetur adipiscing elit. Pellentesque facilisis consectetur felis, sed dapibus felis suscipit ac. Proin non condimentum orci, a consequat ex. In hac habitasse platea dictumst. In feugiat libero interdum dolor vestibulum, sit amet pulvinar sem commodo. Integer in tortor cursus, venenatis justo sed, euismod risus. Proin hendrerit facilisis mauris ut sollicitudin. Vivamus dapibus commodo urna, vitae cursus metus sodales sed. Nullam mollis imperdiet tincidunt. Nam at enim dui.

\`\`\`
let a = 1;
let b = 1;
let c = a + b;

console.log(c);
\`\`\`

\`\`\`
// Code that ends with a newline
return;

\`\`\`

\`\`\`

// Code that starts with a newline
return;
\`\`\``,
        isGroup: true,
        context: {sectionHeading: null},
        tokenCount: 256,
        childChunks: [
            {
                isGroup: false,
                tokenCount: 192,
                context: {sectionHeading: null},
                sentenceChunks: [
                    {
                        text: "Lorem ipsum dolor sit amet, consectetur adipiscing elit.",
                        tokenCount: 21,
                    },
                    {
                        text: "Pellentesque facilisis consectetur felis, sed dapibus felis suscipit ac.",
                        tokenCount: 29,
                    },
                    {
                        text: "Proin non condimentum orci, a consequat ex. In hac habitasse platea dictumst.",
                        tokenCount: 27,
                    },
                    {
                        text: "In feugiat libero interdum dolor vestibulum, sit amet pulvinar sem commodo.",
                        tokenCount: 30,
                    },
                    {
                        text: "Integer in tortor cursus, venenatis justo sed, euismod risus.",
                        tokenCount: 23,
                    },
                    {text: "Proin hendrerit facilisis mauris ut sollicitudin.", tokenCount: 19},
                    {
                        text: "Vivamus dapibus commodo urna, vitae cursus metus sodales sed.",
                        tokenCount: 23,
                    },
                    {text: "Nullam mollis imperdiet tincidunt.", tokenCount: 13},
                    {text: "Nam at enim dui.", tokenCount: 7},
                ],
                lineMarginTop: 2,
                lineMarginBottom: 2,
            },
            {
                isGroup: false,
                tokenCount: 30,
                context: {sectionHeading: null},
                sentenceChunks: [
                    {text: "```\n", tokenCount: 3},
                    {text: "let a = 1;\n", tokenCount: 5},
                    {text: "let b = 1;\n", tokenCount: 5},
                    {text: "let c = a + b;\n", tokenCount: 7},
                    {text: "\n", tokenCount: 0},
                    {text: "console.log(c);\n", tokenCount: 7},
                    {text: "```", tokenCount: 3},
                ],
                lineMarginTop: 2,
                lineMarginBottom: 2,
            },
            {
                isGroup: false,
                tokenCount: 17,
                context: {sectionHeading: null},
                sentenceChunks: [
                    {text: "```\n", tokenCount: 3},
                    {text: "// Code that ends with a newline\n", tokenCount: 9},
                    {text: "return;\n", tokenCount: 2},
                    {text: "\n", tokenCount: 0},
                    {text: "```", tokenCount: 3},
                ],
                lineMarginTop: 2,
                lineMarginBottom: 2,
            },
            {
                isGroup: false,
                tokenCount: 17,
                context: {sectionHeading: null},
                sentenceChunks: [
                    {text: "```\n", tokenCount: 3},
                    {text: "\n", tokenCount: 0},
                    {text: "// Code that starts with a newline\n", tokenCount: 9},
                    {text: "return;\n", tokenCount: 2},
                    {text: "```", tokenCount: 3},
                ],
                lineMarginTop: 2,
                lineMarginBottom: 2,
            },
        ],
    });
});

test("prints a list item with line breaks", async () => {
    const tokenizer = await CohereEmbedEnglishV3LanguageTokenizer.get();
    const getAccountIfExists = () => null;
    const getSearchEntityIfExists = () => null;

    expect(
        testGetFullSearchContentChunk(
            schema.node("doc", {}, [
                schema.node("checkListItem", {indent: 0, checked: true}, [
                    schema.node("paragraph", {}, [
                        schema.text(
                            "Nulla luctus purus venenatis lacus molestie, vitae pulvinar purus accumsan. Ut diam magna, pretium ac lectus at, condimentum porttitor ligula. Praesent in dignissim turpis,",
                        ),
                        schema.node("break"),
                        schema.text(
                            "eget scelerisque massa. Donec nunc tellus, finibus quis nisl quis, pharetra mollis elit. In vel auctor eros. Nulla ac quam mi. Pellentesque a arcu eros. Cras felis ligula, vestibulum nec pulvinar quis, efficitur sit amet sapien. Etiam vestibulum id sem eget mollis.",
                        ),
                    ]),
                ]),
            ]),
            {tokenizer, getAccountIfExists, getSearchEntityIfExists},
        ),
    ).toEqual({
        text: `\
- Nulla luctus purus venenatis lacus molestie, vitae pulvinar purus accumsan. Ut diam magna, pretium ac lectus at, condimentum porttitor ligula. Praesent in dignissim turpis,\\
  eget scelerisque massa. Donec nunc tellus, finibus quis nisl quis, pharetra mollis elit. In vel auctor eros. Nulla ac quam mi. Pellentesque a arcu eros. Cras felis ligula, vestibulum nec pulvinar quis, efficitur sit amet sapien. Etiam vestibulum id sem eget mollis.`,
        isGroup: false,
        tokenCount: 166,
        context: {sectionHeading: null},
        sentenceChunks: [
            {
                text: "- Nulla luctus purus venenatis lacus molestie, vitae pulvinar purus accumsan.",
                tokenCount: 29,
            },
            {
                text: "Ut diam magna, pretium ac lectus at, condimentum porttitor ligula.",
                tokenCount: 22,
            },
            {text: "Praesent in dignissim turpis,\\", tokenCount: 14},
            {text: "\n  ", tokenCount: 0},
            {text: "eget scelerisque massa.", tokenCount: 9},
            {
                text: "Donec nunc tellus, finibus quis nisl quis, pharetra mollis elit.",
                tokenCount: 25,
            },
            {text: "In vel auctor eros.", tokenCount: 8},
            {text: "Nulla ac quam mi. Pellentesque a arcu eros.", tokenCount: 17},
            {
                text: "Cras felis ligula, vestibulum nec pulvinar quis, efficitur sit amet sapien.",
                tokenCount: 29,
            },
            {text: "Etiam vestibulum id sem eget mollis.", tokenCount: 13},
        ],
        lineMarginTop: 1,
        lineMarginBottom: 1,
    });

    expect(
        testGetFullSearchContentChunk(
            schema.node("doc", {}, [
                schema.node("checkListItem", {indent: 0, checked: true}, [
                    schema.node("paragraph", {}, [
                        schema.text(
                            "Nulla luctus purus venenatis lacus molestie, vitae pulvinar purus accumsan. Ut diam magna, pretium ac lectus at, condimentum porttitor ligula. Praesent in dignissim turpis,",
                        ),
                        schema.node("break"),
                        schema.node("break"),
                        schema.text(
                            "eget scelerisque massa. Donec nunc tellus, finibus quis nisl quis, pharetra mollis elit. In vel auctor eros. Nulla ac quam mi. Pellentesque a arcu eros. Cras felis ligula, vestibulum nec pulvinar quis, efficitur sit amet sapien. Etiam vestibulum id sem eget mollis.",
                        ),
                    ]),
                ]),
            ]),
            {tokenizer, getAccountIfExists, getSearchEntityIfExists},
        ),
    ).toEqual({
        text: `\
- Nulla luctus purus venenatis lacus molestie, vitae pulvinar purus accumsan. Ut diam magna, pretium ac lectus at, condimentum porttitor ligula. Praesent in dignissim turpis,\\
  \\
  eget scelerisque massa. Donec nunc tellus, finibus quis nisl quis, pharetra mollis elit. In vel auctor eros. Nulla ac quam mi. Pellentesque a arcu eros. Cras felis ligula, vestibulum nec pulvinar quis, efficitur sit amet sapien. Etiam vestibulum id sem eget mollis.`,
        isGroup: false,
        tokenCount: 167,
        context: {sectionHeading: null},
        sentenceChunks: [
            {
                text: "- Nulla luctus purus venenatis lacus molestie, vitae pulvinar purus accumsan.",
                tokenCount: 29,
            },
            {
                text: "Ut diam magna, pretium ac lectus at, condimentum porttitor ligula.",
                tokenCount: 22,
            },
            {text: "Praesent in dignissim turpis,\\", tokenCount: 14},
            {text: "\n  ", tokenCount: 0},
            {text: "\\", tokenCount: 1},
            {text: "\n  ", tokenCount: 0},
            {text: "eget scelerisque massa.", tokenCount: 9},
            {
                text: "Donec nunc tellus, finibus quis nisl quis, pharetra mollis elit.",
                tokenCount: 25,
            },
            {text: "In vel auctor eros.", tokenCount: 8},
            {text: "Nulla ac quam mi. Pellentesque a arcu eros.", tokenCount: 17},
            {
                text: "Cras felis ligula, vestibulum nec pulvinar quis, efficitur sit amet sapien.",
                tokenCount: 29,
            },
            {text: "Etiam vestibulum id sem eget mollis.", tokenCount: 13},
        ],
        lineMarginTop: 1,
        lineMarginBottom: 1,
    });
});

test("prints a heading with line breaks", async () => {
    const tokenizer = await CohereEmbedEnglishV3LanguageTokenizer.get();
    const getAccountIfExists = () => null;
    const getSearchEntityIfExists = () => null;

    expect(
        testGetFullSearchContentChunk(
            schema.node("doc", {}, [
                schema.node("heading", {level: 3}, [
                    schema.text(
                        "Nulla luctus purus venenatis lacus molestie, vitae pulvinar purus accumsan. Ut diam magna, pretium ac lectus at, condimentum porttitor ligula. Praesent in dignissim turpis,",
                    ),
                    schema.node("break"),
                    schema.text(
                        "eget scelerisque massa. Donec nunc tellus, finibus quis nisl quis, pharetra mollis elit. In vel auctor eros. Nulla ac quam mi. Pellentesque a arcu eros. Cras felis ligula, vestibulum nec pulvinar quis, efficitur sit amet sapien. Etiam vestibulum id sem eget mollis.",
                    ),
                ]),
            ]),
            {tokenizer, getAccountIfExists, getSearchEntityIfExists},
        ),
    ).toEqual({
        text: `\
#### Nulla luctus purus venenatis lacus molestie, vitae pulvinar purus accumsan. Ut diam magna, pretium ac lectus at, condimentum porttitor ligula. Praesent in dignissim turpis,<br/>eget scelerisque massa. Donec nunc tellus, finibus quis nisl quis, pharetra mollis elit. In vel auctor eros. Nulla ac quam mi. Pellentesque a arcu eros. Cras felis ligula, vestibulum nec pulvinar quis, efficitur sit amet sapien. Etiam vestibulum id sem eget mollis.`,
        isGroup: false,
        tokenCount: 172,
        context: {sectionHeading: null},
        sentenceChunks: [
            {
                text: "#### Nulla luctus purus venenatis lacus molestie, vitae pulvinar purus accumsan.",
                tokenCount: 32,
            },
            {
                text: "Ut diam magna, pretium ac lectus at, condimentum porttitor ligula.",
                tokenCount: 22,
            },
            {text: "Praesent in dignissim turpis,<br/>eget scelerisque massa.", tokenCount: 26},
            {
                text: "Donec nunc tellus, finibus quis nisl quis, pharetra mollis elit.",
                tokenCount: 25,
            },
            {text: "In vel auctor eros.", tokenCount: 8},
            {text: "Nulla ac quam mi. Pellentesque a arcu eros.", tokenCount: 17},
            {
                text: "Cras felis ligula, vestibulum nec pulvinar quis, efficitur sit amet sapien.",
                tokenCount: 29,
            },
            {text: "Etiam vestibulum id sem eget mollis.", tokenCount: 13},
        ],
        lineMarginTop: 2,
        lineMarginBottom: 2,
    });

    expect(
        testGetFullSearchContentChunk(
            schema.node("doc", {}, [
                schema.node("heading", {level: 3}, [
                    schema.text(
                        "Nulla luctus purus venenatis lacus molestie, vitae pulvinar purus accumsan. Ut diam magna, pretium ac lectus at, condimentum porttitor ligula. Praesent in dignissim turpis,",
                    ),
                    schema.node("break"),
                    schema.node("break"),
                    schema.text(
                        "eget scelerisque massa. Donec nunc tellus, finibus quis nisl quis, pharetra mollis elit. In vel auctor eros. Nulla ac quam mi. Pellentesque a arcu eros. Cras felis ligula, vestibulum nec pulvinar quis, efficitur sit amet sapien. Etiam vestibulum id sem eget mollis.",
                    ),
                ]),
            ]),
            {tokenizer, getAccountIfExists, getSearchEntityIfExists},
        ),
    ).toEqual({
        text: `\
#### Nulla luctus purus venenatis lacus molestie, vitae pulvinar purus accumsan. Ut diam magna, pretium ac lectus at, condimentum porttitor ligula. Praesent in dignissim turpis,<br/><br/>eget scelerisque massa. Donec nunc tellus, finibus quis nisl quis, pharetra mollis elit. In vel auctor eros. Nulla ac quam mi. Pellentesque a arcu eros. Cras felis ligula, vestibulum nec pulvinar quis, efficitur sit amet sapien. Etiam vestibulum id sem eget mollis.`,
        isGroup: false,
        tokenCount: 176,
        context: {sectionHeading: null},
        sentenceChunks: [
            {
                text: "#### Nulla luctus purus venenatis lacus molestie, vitae pulvinar purus accumsan.",
                tokenCount: 32,
            },
            {
                text: "Ut diam magna, pretium ac lectus at, condimentum porttitor ligula.",
                tokenCount: 22,
            },
            {
                text: "Praesent in dignissim turpis,<br/><br/>eget scelerisque massa.",
                tokenCount: 30,
            },
            {
                text: "Donec nunc tellus, finibus quis nisl quis, pharetra mollis elit.",
                tokenCount: 25,
            },
            {text: "In vel auctor eros.", tokenCount: 8},
            {text: "Nulla ac quam mi. Pellentesque a arcu eros.", tokenCount: 17},
            {
                text: "Cras felis ligula, vestibulum nec pulvinar quis, efficitur sit amet sapien.",
                tokenCount: 29,
            },
            {text: "Etiam vestibulum id sem eget mollis.", tokenCount: 13},
        ],
        lineMarginTop: 2,
        lineMarginBottom: 2,
    });
});

test("prints chunk text with inline styles", async () => {
    const tokenizer = await CohereEmbedEnglishV3LanguageTokenizer.get();
    const getAccountIfExists = () => null;
    const getSearchEntityIfExists = () => null;

    expect(
        testGetFullSearchContentChunk(
            schema.node("doc", {}, [
                schema.node("paragraph", {}, [
                    schema.text("test1 "),
                    schema.text("test2", [schema.mark("bold")]),
                    schema.text(" "),
                    schema.text("test3", [schema.mark("italic")]),
                    schema.text(" "),
                    schema.text("test4", [schema.mark("bold"), schema.mark("italic")]),
                    schema.text(" "),
                    schema.text("test5", [schema.mark("code")]),
                    schema.text(" "),
                    schema.text("test6", [schema.mark("code"), schema.mark("bold")]),
                    schema.text(" "),
                    schema.text("test7", [schema.mark("code"), schema.mark("italic")]),
                    schema.text(" "),
                    schema.text("test7.1", [schema.mark("italic"), schema.mark("code")]),
                    schema.text(" "),
                    schema.text("test7.2", [
                        schema.mark("italic"),
                        schema.mark("code"),
                        schema.mark("bold"),
                    ]),
                    schema.text(" "),
                    schema.text("test8", [schema.mark("strike")]),
                    schema.text(" "),
                    schema.text("test9", [schema.mark("strike"), schema.mark("bold")]),
                    schema.text(" *test10* "),
                    schema.text("test", [schema.mark("code")]),
                    schema.text("test", [schema.mark("code"), schema.mark("bold")]),
                    schema.text("test", [schema.mark("code")]),
                    schema.text(" "),
                    schema.text("test", [schema.mark("bold")]),
                    schema.text("test", [schema.mark("bold"), schema.mark("italic")]),
                    schema.text("test", [schema.mark("bold")]),
                    schema.text(" "),
                    schema.text("foo", [schema.mark("code")]),
                    schema.text("bar", [
                        schema.mark("code"),
                        schema.mark("link", {url: "https://alpine.inc"}),
                    ]),
                    schema.text("qux", [schema.mark("code")]),
                    schema.text(" "),
                    schema.text("foo", [schema.mark("code")]),
                    schema.text("bar", [schema.mark("code"), schema.mark("italic")]),
                    schema.text("qux", [schema.mark("code")]),
                    schema.text(" "),
                    schema.text("foo", [schema.mark("code")]),
                    schema.text("bar", [schema.mark("code"), schema.mark("bold")]),
                    schema.text("qux", [schema.mark("code")]),
                    schema.text(" "),
                    schema.text("fo", [schema.mark("code")]),
                    schema.text("o", [schema.mark("code"), schema.mark("bold")]),
                    schema.text("b", [
                        schema.mark("code"),
                        schema.mark("link", {url: "https://alpine.inc"}),
                        schema.mark("bold"),
                    ]),
                    schema.text("ar", [
                        schema.mark("code"),
                        schema.mark("link", {url: "https://alpine.inc"}),
                    ]),
                    schema.text("qux", [schema.mark("code")]),
                ]),
            ]),
            {tokenizer, getAccountIfExists, getSearchEntityIfExists},
        ),
    ).toEqual({
        text: "test1 **test2** *test3* ***test4*** `test5` **`test6`** *`test7`* *`test7.1`* ***`test7.2`*** ~~test8~~ **~~test9~~** \\*test10\\* `test`**`test`**`test` **test*****test*****test** `foobarqux` `foo`*`bar`*`qux` `foo`**`bar`**`qux` `fo`**`ob`**`arqux`",
        isGroup: false,
        tokenCount: 158,
        context: {sectionHeading: null},
        sentenceChunks: [
            {
                text: "test1 **test2** *test3* ***test4*** `test5` **`test6`** *`test7`* *`test7.1`* ***`test7.2`*** ~~test8~~ **~~test9~~** \\*test10\\* `test`**`test`**`test` **test*****test*****test** `foobarqux` `foo`*`bar`*`qux` `foo`**`bar`**`qux` `fo`**`ob`**`arqux`",
                tokenCount: 158,
            },
        ],
        lineMarginTop: 2,
        lineMarginBottom: 2,
    });

    expect(
        testGetFullSearchContentChunk(
            schema.node("doc", {}, [
                schema.node("paragraph", {}, [
                    schema.text("test", [schema.mark("italic")]),
                    schema.text("test", [schema.mark("italic"), schema.mark("bold")]),
                    schema.text("test", [schema.mark("italic")]),
                ]),
            ]),
            {
                tokenizer,
                getAccountIfExists,
                getSearchEntityIfExists,
                // TODO(calebmer): There's a bug in our Markdown parser which means we can't
                // correctly handle this case. We should get the Markdown parser fixed.
                //
                // See:
                // - https://github.com/orgs/unifiedjs/discussions/160
                // - https://github.com/syntax-tree/mdast-util-from-markdown/issues/15
                skipParseCorrectnessTests: true,
            },
        ),
    ).toEqual({
        text: "*test****test****test*",
        isGroup: false,
        tokenCount: 13,
        context: {sectionHeading: null},
        sentenceChunks: [
            {
                text: "*test****test****test*",
                tokenCount: 13,
            },
        ],
        lineMarginTop: 2,
        lineMarginBottom: 2,
    });
});

test("escapes markdown characters", async () => {
    const tokenizer = await CohereEmbedEnglishV3LanguageTokenizer.get();
    const getAccountIfExists = () => null;
    const getSearchEntityIfExists = () => null;

    expect(
        testGetFullSearchContentChunk(
            schema.node("doc", {}, [
                schema.node("paragraph", {}, [
                    schema.text("multiple  spaces   between      words"),
                ]),
                schema.node("paragraph", {}, [
                    schema.text("    space at the beginning of paragraph"),
                ]),
                schema.node("paragraph", {}, [schema.text("space at the end of paragraph    ")]),
                schema.node("quoteBlock", {}, [
                    schema.node("paragraph", {}, [
                        schema.text("    space at the beginning of paragraph"),
                    ]),
                    schema.node("paragraph", {}, [
                        schema.text("space at the end of paragraph    "),
                    ]),
                ]),
                schema.node("paragraph", {}, [
                    schema.text("spaces before break    "),
                    schema.node("break"),
                    schema.text("wow next"),
                    schema.node("break"),
                    schema.text("    spaces after break"),
                ]),
                schema.node("paragraph", {}, [schema.text("space at the end of paragraph    ")]),
                schema.node("paragraph", {}, [schema.text("This is a literal asterisk: *")]),
                schema.node("paragraph", {}, [schema.text("This is a literal underscore: _")]),
                schema.node("paragraph", {}, [schema.text("This is a literal dash: -")]),
                schema.node("paragraph", {}, [schema.text("This is a literal pound: #")]),
                schema.node("paragraph", {}, [schema.text("This is a literal squiggle: ~")]),
                schema.node("paragraph", {}, [schema.text("This is a literal backtick: `")]),
                schema.node("paragraph", {}, [schema.text("This is multiple backticks: ```")]),
                schema.node("paragraph", {}, [
                    schema.text("This is backticks surrounding text: `code?`"),
                ]),
                schema.node("paragraph", {}, [schema.text("Here’s a math expression: 2 + 4 > 5")]),
                schema.node("paragraph", {}, [schema.text("Here’s some braces: [INTERNAL]")]),
                schema.node("paragraph", {}, [
                    schema.text("Here’s some braces that look like a checkbox: [x]"),
                ]),
                schema.node("paragraph", {}, [
                    schema.text(
                        "Here’s some braces that look like a link: [Google](https://google.com)",
                    ),
                ]),
                schema.node("paragraph", {}, [
                    schema.text("[x] this checked checkbox starts the line"),
                ]),
                schema.node("paragraph", {}, [
                    schema.text("[ ] this unchecked checkbox starts the line"),
                ]),
                schema.node("paragraph", {}, [
                    schema.text("1. this number item looks like it starts a line"),
                ]),
                schema.node("paragraph", {}, [
                    schema.text("1. this number item also looks like it starts a line"),
                ]),
                schema.node("paragraph", {}, [schema.text("- this dash starts the line")]),
                schema.node("paragraph", {}, [
                    schema.text("  - this dash has some spaces before it starts the line"),
                ]),
                schema.node("paragraph", {}, [schema.text("* this asterisk starts the line")]),
                schema.node("paragraph", {}, [schema.text("# this pound starts the line")]),
                schema.node("paragraph", {}, [
                    schema.text(
                        "This <em>looks</em> like a paragraph <strong>with</strong> some HTML, this is < em >weird< /em >",
                    ),
                ]),
            ]),
            {tokenizer, getAccountIfExists, getSearchEntityIfExists},
        ),
    ).toEqual({
        text: `\
multiple  spaces   between      words

&#x0020;   space at the beginning of paragraph

space at the end of paragraph   &#x0020;

> &#x0020;   space at the beginning of paragraph
>
> space at the end of paragraph   &#x0020;

spaces before break    \\
wow next\\
&#x0020;   spaces after break

space at the end of paragraph   &#x0020;

This is a literal asterisk: \\*

This is a literal underscore: \\_

This is a literal dash: -

This is a literal pound: #

This is a literal squiggle: \\~

This is a literal backtick: \\\`

This is multiple backticks: \\\`\\\`\\\`

This is backticks surrounding text: \\\`code?\\\`

Here’s a math expression: 2 + 4 > 5

Here’s some braces: [INTERNAL]

Here’s some braces that look like a checkbox: [x]

Here’s some braces that look like a link: [Google\\](https://google.com)

[x] this checked checkbox starts the line

[ ] this unchecked checkbox starts the line

1\\. this number item looks like it starts a line

1\\. this number item also looks like it starts a line

\\- this dash starts the line

&#x0020; \\- this dash has some spaces before it starts the line

\\* this asterisk starts the line

\\# this pound starts the line

This \\<em>looks\\</em> like a paragraph \\<strong>with\\</strong> some HTML, this is < em >weird< /em >`,
        isGroup: true,
        context: {sectionHeading: null},
        tokenCount: 326,
        childChunks: [
            {
                isGroup: false,
                tokenCount: 4,
                context: {sectionHeading: null},
                sentenceChunks: [{text: "multiple  spaces   between      words", tokenCount: 4}],
                lineMarginTop: 2,
                lineMarginBottom: 2,
            },
            {
                isGroup: false,
                tokenCount: 12,
                context: {sectionHeading: null},
                sentenceChunks: [
                    {text: "&#x0020;   space at the beginning of paragraph", tokenCount: 12},
                ],
                lineMarginTop: 2,
                lineMarginBottom: 2,
            },
            {
                isGroup: false,
                tokenCount: 6,
                context: {sectionHeading: null},
                sentenceChunks: [{text: "space at the end of paragraph    ", tokenCount: 6}],
                lineMarginTop: 2,
                lineMarginBottom: 2,
            },
            {
                isGroup: false,
                tokenCount: 21,
                context: {sectionHeading: null},
                sentenceChunks: [
                    {text: "> &#x0020;   space at the beginning of paragraph", tokenCount: 13},
                    {text: "\n>\n> space at the end of paragraph    ", tokenCount: 8},
                ],
                lineMarginTop: 2,
                lineMarginBottom: 2,
            },
            {
                isGroup: false,
                tokenCount: 16,
                context: {sectionHeading: null},
                sentenceChunks: [
                    {text: "spaces before break    \\", tokenCount: 4},
                    {text: "\n", tokenCount: 0},
                    {text: "wow next\\", tokenCount: 3},
                    {text: "\n", tokenCount: 0},
                    {text: "&#x0020;   spaces after break", tokenCount: 9},
                ],
                lineMarginTop: 2,
                lineMarginBottom: 2,
            },
            {
                isGroup: false,
                tokenCount: 6,
                context: {sectionHeading: null},
                sentenceChunks: [{text: "space at the end of paragraph    ", tokenCount: 6}],
                lineMarginTop: 2,
                lineMarginBottom: 2,
            },
            {
                isGroup: false,
                tokenCount: 10,
                context: {sectionHeading: null},
                sentenceChunks: [{text: "This is a literal asterisk: \\*", tokenCount: 10}],
                lineMarginTop: 2,
                lineMarginBottom: 2,
            },
            {
                isGroup: false,
                tokenCount: 10,
                context: {sectionHeading: null},
                sentenceChunks: [{text: "This is a literal underscore: \\_", tokenCount: 10}],
                lineMarginTop: 2,
                lineMarginBottom: 2,
            },
            {
                isGroup: false,
                tokenCount: 7,
                context: {sectionHeading: null},
                sentenceChunks: [{text: "This is a literal dash: -", tokenCount: 7}],
                lineMarginTop: 2,
                lineMarginBottom: 2,
            },
            {
                isGroup: false,
                tokenCount: 7,
                context: {sectionHeading: null},
                sentenceChunks: [{text: "This is a literal pound: #", tokenCount: 7}],
                lineMarginTop: 2,
                lineMarginBottom: 2,
            },
            {
                isGroup: false,
                tokenCount: 10,
                context: {sectionHeading: null},
                sentenceChunks: [{text: "This is a literal squiggle: \\~", tokenCount: 10}],
                lineMarginTop: 2,
                lineMarginBottom: 2,
            },
            {
                isGroup: false,
                tokenCount: 9,
                context: {sectionHeading: null},
                sentenceChunks: [{text: "This is a literal backtick: \\`", tokenCount: 9}],
                lineMarginTop: 2,
                lineMarginBottom: 2,
            },
            {
                isGroup: false,
                tokenCount: 13,
                context: {sectionHeading: null},
                sentenceChunks: [{text: "This is multiple backticks: \\`\\`\\`", tokenCount: 13}],
                lineMarginTop: 2,
                lineMarginBottom: 2,
            },
            {
                isGroup: false,
                tokenCount: 14,
                context: {sectionHeading: null},
                sentenceChunks: [
                    {text: "This is backticks surrounding text: \\`code?\\`", tokenCount: 14},
                ],
                lineMarginTop: 2,
                lineMarginBottom: 2,
            },
            {
                isGroup: false,
                tokenCount: 12,
                context: {sectionHeading: null},
                sentenceChunks: [{text: "Here’s a math expression: 2 + 4 > 5", tokenCount: 12}],
                lineMarginTop: 2,
                lineMarginBottom: 2,
            },
            {
                isGroup: false,
                tokenCount: 10,
                context: {sectionHeading: null},
                sentenceChunks: [{text: "Here’s some braces: [INTERNAL]", tokenCount: 10}],
                lineMarginTop: 2,
                lineMarginBottom: 2,
            },
            {
                isGroup: false,
                tokenCount: 16,
                context: {sectionHeading: null},
                sentenceChunks: [
                    {text: "Here’s some braces that look like a checkbox: [x]", tokenCount: 16},
                ],
                lineMarginTop: 2,
                lineMarginBottom: 2,
            },
            {
                isGroup: false,
                tokenCount: 25,
                context: {sectionHeading: null},
                sentenceChunks: [
                    {
                        text: "Here’s some braces that look like a link: [Google\\](https://google.com)",
                        tokenCount: 25,
                    },
                ],
                lineMarginTop: 2,
                lineMarginBottom: 2,
            },
            {
                isGroup: false,
                tokenCount: 10,
                context: {sectionHeading: null},
                sentenceChunks: [
                    {text: "[x] this checked checkbox starts the line", tokenCount: 10},
                ],
                lineMarginTop: 2,
                lineMarginBottom: 2,
            },
            {
                isGroup: false,
                tokenCount: 11,
                context: {sectionHeading: null},
                sentenceChunks: [
                    {text: "[ ] this unchecked checkbox starts the line", tokenCount: 11},
                ],
                lineMarginTop: 2,
                lineMarginBottom: 2,
            },
            {
                isGroup: false,
                tokenCount: 12,
                context: {sectionHeading: null},
                sentenceChunks: [
                    {text: "1\\. this number item looks like it starts a line", tokenCount: 12},
                ],
                lineMarginTop: 2,
                lineMarginBottom: 2,
            },
            {
                isGroup: false,
                tokenCount: 13,
                context: {sectionHeading: null},
                sentenceChunks: [
                    {
                        text: "1\\. this number item also looks like it starts a line",
                        tokenCount: 13,
                    },
                ],
                lineMarginTop: 2,
                lineMarginBottom: 2,
            },
            {
                isGroup: false,
                tokenCount: 7,
                context: {sectionHeading: null},
                sentenceChunks: [{text: "\\- this dash starts the line", tokenCount: 7}],
                lineMarginTop: 2,
                lineMarginBottom: 2,
            },
            {
                isGroup: false,
                tokenCount: 12,
                context: {sectionHeading: null},
                sentenceChunks: [
                    {
                        text: "  \\- this dash has some spaces before it starts the line",
                        tokenCount: 12,
                    },
                ],
                lineMarginTop: 2,
                lineMarginBottom: 2,
            },
            {
                isGroup: false,
                tokenCount: 9,
                context: {sectionHeading: null},
                sentenceChunks: [{text: "\\* this asterisk starts the line", tokenCount: 9}],
                lineMarginTop: 2,
                lineMarginBottom: 2,
            },
            {
                isGroup: false,
                tokenCount: 7,
                context: {sectionHeading: null},
                sentenceChunks: [{text: "\\# this pound starts the line", tokenCount: 7}],
                lineMarginTop: 2,
                lineMarginBottom: 2,
            },
            {
                isGroup: false,
                tokenCount: 37,
                context: {sectionHeading: null},
                sentenceChunks: [
                    {
                        text: "This \\<em>looks\\</em> like a paragraph \\<strong>with\\</strong> some HTML, this is < em >weird< /em >",
                        tokenCount: 37,
                    },
                ],
                lineMarginTop: 2,
                lineMarginBottom: 2,
            },
        ],
    });
});

test("escapes 4 spaces which would create a code block", async () => {
    const tokenizer = await CohereEmbedEnglishV3LanguageTokenizer.get();
    const getAccountIfExists = () => null;
    const getSearchEntityIfExists = () => null;

    expect(
        testGetFullSearchContentChunk(
            schema.node("doc", {}, [
                schema.node("paragraph", {}, [schema.text("    this isn’t a code block")]),
                schema.node("quoteBlock", {}, [
                    schema.node("paragraph", {}, [schema.text("    this also isn’t a code block")]),
                ]),
                schema.node("unorderedListItem", {}, [
                    schema.node("paragraph", {}, [
                        schema.text("    this unordered list item isn’t a code block"),
                    ]),
                ]),
                schema.node("orderedListItem", {}, [
                    schema.node("paragraph", {}, [
                        schema.text("    this ordered list item isn’t a code block"),
                    ]),
                ]),
                schema.node("paragraph", {}, [schema.text(">     similarly, not a code block")]),
                schema.node("paragraph", {}, [schema.text("-     nor is this a code block")]),
                schema.node("paragraph", {}, [
                    schema.text("1.     finally, this isn’t a code block"),
                ]),
            ]),
            {tokenizer, getAccountIfExists, getSearchEntityIfExists},
        ),
    ).toEqual({
        text: `\
&#x0020;   this isn’t a code block

> &#x0020;   this also isn’t a code block

- &#x0020;   this unordered list item isn’t a code block
1. &#x0020;   this ordered list item isn’t a code block

\\> &#x0020;   similarly, not a code block

\\- &#x0020;   nor is this a code block

1\\. &#x0020;   finally, this isn’t a code block`,
        isGroup: true,
        tokenCount: 111,
        context: {sectionHeading: null},
        childChunks: [
            {
                isGroup: false,
                tokenCount: 13,
                context: {sectionHeading: null},
                sentenceChunks: [{text: "&#x0020;   this isn’t a code block", tokenCount: 13}],
                lineMarginTop: 2,
                lineMarginBottom: 2,
            },
            {
                isGroup: false,
                tokenCount: 15,
                context: {sectionHeading: null},
                sentenceChunks: [
                    {text: "> &#x0020;   this also isn’t a code block", tokenCount: 15},
                ],
                lineMarginTop: 2,
                lineMarginBottom: 2,
            },
            {
                isGroup: true,
                tokenCount: 37,
                context: {sectionHeading: null},
                childChunks: [
                    {
                        isGroup: false,
                        tokenCount: 19,
                        context: {sectionHeading: null},
                        sentenceChunks: [
                            {
                                text: "- &#x0020;   this unordered list item isn’t a code block",
                                tokenCount: 19,
                            },
                        ],
                        lineMarginTop: 1,
                        lineMarginBottom: 1,
                    },
                    {
                        isGroup: false,
                        tokenCount: 18,
                        context: {sectionHeading: null},
                        sentenceChunks: [
                            {
                                text: "1. &#x0020;   this ordered list item isn’t a code block",
                                tokenCount: 18,
                            },
                        ],
                        lineMarginTop: 1,
                        lineMarginBottom: 1,
                    },
                ],
            },
            {
                isGroup: false,
                tokenCount: 14,
                context: {sectionHeading: null},
                sentenceChunks: [
                    {text: "\\> &#x0020;   similarly, not a code block", tokenCount: 14},
                ],
                lineMarginTop: 2,
                lineMarginBottom: 2,
            },
            {
                isGroup: false,
                tokenCount: 14,
                context: {sectionHeading: null},
                sentenceChunks: [{text: "\\- &#x0020;   nor is this a code block", tokenCount: 14}],
                lineMarginTop: 2,
                lineMarginBottom: 2,
            },
            {
                isGroup: false,
                tokenCount: 18,
                context: {sectionHeading: null},
                sentenceChunks: [
                    {text: "1\\. &#x0020;   finally, this isn’t a code block", tokenCount: 18},
                ],
                lineMarginTop: 2,
                lineMarginBottom: 2,
            },
        ],
    });
});

for (const numSpaces of [1, 2, 3]) {
    // sanity checks for spaces that are not expected to make code blocks in CommonMark
    test(`escapes ${numSpaces} spaces which would not create a code block`, async () => {
        const tokenizer = await CohereEmbedEnglishV3LanguageTokenizer.get();
        const getAccountIfExists = () => null;
        const getSearchEntityIfExists = () => null;

        const spaces = " ".repeat(numSpaces);
        const chunkEscapedSpaces = "&#x0020;" + " ".repeat(numSpaces - 1);

        expect(
            testGetFullSearchContentChunk(
                schema.node("doc", {}, [
                    schema.node("paragraph", {}, [schema.text(`${spaces}this isn’t a code block`)]),
                    schema.node("quoteBlock", {}, [
                        schema.node("paragraph", {}, [
                            schema.text(`${spaces}this also isn’t a code block`),
                        ]),
                    ]),
                ]),
                {tokenizer, getAccountIfExists, getSearchEntityIfExists},
            ),
        ).toEqual({
            text: `\
${chunkEscapedSpaces}this isn’t a code block

> ${chunkEscapedSpaces}this also isn’t a code block`,
            isGroup: true,
            tokenCount: 16,
            context: {sectionHeading: null},
            childChunks: [
                {
                    isGroup: false,
                    tokenCount: 7,
                    context: {sectionHeading: null},
                    sentenceChunks: [{text: `${spaces}this isn’t a code block`, tokenCount: 7}],
                    lineMarginTop: 2,
                    lineMarginBottom: 2,
                },
                {
                    isGroup: false,
                    tokenCount: 9,
                    context: {sectionHeading: null},
                    sentenceChunks: [
                        {
                            text: `> ${spaces}this also isn’t a code block`,
                            tokenCount: 9,
                        },
                    ],
                    lineMarginTop: 2,
                    lineMarginBottom: 2,
                },
            ],
        });
    });
}

test("prints mentions", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession({name: "Caleb Meredith"});

    const tokenizer = await CohereEmbedEnglishV3LanguageTokenizer.get();

    const account = await getAccountIfExists(session.action(), space.id, session.account.id);

    expect(
        testGetFullSearchContentChunk(
            schema.node("doc", {}, [
                schema.node("paragraph", {}, [
                    schema.text("hello "),
                    schema.node("mention", {
                        mention: cast<ContentMention>({
                            type: "Account",
                            accountId: session.account.id,
                            isShort: false,
                        }),
                    }),
                ]),
                schema.node("paragraph", {}, [
                    schema.text("hello "),
                    schema.node("mention", {
                        mention: cast<ContentMention>({
                            type: "Account",
                            accountId: session.account.id,
                            isShort: true,
                        }),
                    }),
                ]),
                schema.node("paragraph", {}, [
                    schema.text("hello "),
                    schema.node("mention", {
                        mention: cast<ContentMention>({
                            type: "Account",
                            accountId: generateId(),
                            isShort: false,
                        }),
                    }),
                ]),
            ]),
            {
                tokenizer,
                getAccountIfExists: accountId => {
                    if (accountId === account?.id) return account.initialData;
                    return null;
                },
                getSearchEntityIfExists: () => null,
            },
        ),
    ).toEqual({
        text: `\
hello Caleb Meredith

hello Caleb

hello Unknown`,
        isGroup: true,
        tokenCount: 7,
        context: {sectionHeading: null},
        childChunks: [
            {
                isGroup: false,
                tokenCount: 3,
                context: {sectionHeading: null},
                sentenceChunks: [{text: "hello Caleb Meredith", tokenCount: 3}],
                lineMarginTop: 2,
                lineMarginBottom: 2,
            },
            {
                isGroup: false,
                tokenCount: 2,
                context: {sectionHeading: null},
                sentenceChunks: [{text: "hello Caleb", tokenCount: 2}],
                lineMarginTop: 2,
                lineMarginBottom: 2,
            },
            {
                isGroup: false,
                tokenCount: 2,
                context: {sectionHeading: null},
                sentenceChunks: [{text: "hello Unknown", tokenCount: 2}],
                lineMarginTop: 2,
                lineMarginBottom: 2,
            },
        ],
    });
});

test("correctly chunks document content", async () => {
    const tokenizer = await CohereEmbedEnglishV3LanguageTokenizer.get();
    const getAccountIfExists = () => null;
    const getSearchEntityIfExists = () => null;

    expect(
        chunkDocumentSearchContent(
            DocumentContentProsemirrorSchema.nodeFromJSON({
                type: "doc",
                content: [
                    {type: "title", content: [{type: "text", text: "Product vision and strategy"}]},
                    {
                        type: "paragraph",
                        content: [
                            {
                                type: "text",
                                text: "This document is a part of our packet introducing Cyberworlds (code name, will change when we go to market). ",
                            },
                            {
                                type: "text",
                                marks: [
                                    {
                                        type: "link",
                                        attrs: {
                                            url: "https://cyberworlds.dev/s/111hc413nfdxa6vwspnhm3ejsc/documents/9rfgay7czbxcbzvgarpyb1ycz8",
                                        },
                                    },
                                ],
                                text: "See all documents in this packet",
                            },
                        ],
                    },
                    {
                        type: "heading",
                        attrs: {level: 1},
                        content: [{type: "text", text: "Vision"}],
                    },
                    {
                        type: "paragraph",
                        content: [
                            {type: "text", text: "Our product’s mission is: "},
                            {
                                type: "text",
                                marks: [{type: "bold"}],
                                text: "Help people work together",
                            },
                        ],
                    },
                    {
                        type: "paragraph",
                        content: [
                            {
                                type: "text",
                                text: "People can build great things when they work together. We aim to improve the productivity of our customers so they can build even more great things.",
                            },
                        ],
                    },
                    {
                        type: "paragraph",
                        content: [
                            {
                                type: "text",
                                text: "Cyberworlds will streamline work collaboration by bringing together the top productivity tools (chat, documents, tasks, video conferencing, calendaring, email, sheets, slides) into one deeply integrated product. Some things we believe:",
                            },
                        ],
                    },
                    {
                        type: "unorderedListItem",
                        attrs: {indent: 0},
                        content: [
                            {
                                type: "paragraph",
                                content: [
                                    {
                                        type: "text",
                                        marks: [{type: "bold"}],
                                        text: "Our tools are fragmented.",
                                    },
                                    {
                                        type: "text",
                                        text: " Bringing a project to completion shouldn’t involve jumping between tools and losing track of where things are happening. Instead it should feel like a continuous experience from idea to execution.",
                                    },
                                ],
                            },
                        ],
                    },
                    {
                        type: "unorderedListItem",
                        attrs: {indent: 0},
                        content: [
                            {
                                type: "paragraph",
                                content: [
                                    {
                                        type: "text",
                                        marks: [{type: "bold"}],
                                        text: "Conversations are core to collaboration.",
                                    },
                                    {
                                        type: "text",
                                        text: " We plan to unify conversations across the product experience. Never lose track of what’s happening and pick up the conversation where you left off.",
                                    },
                                ],
                            },
                        ],
                    },
                    {
                        type: "unorderedListItem",
                        attrs: {indent: 0},
                        content: [
                            {
                                type: "paragraph",
                                content: [
                                    {
                                        type: "text",
                                        marks: [{type: "bold"}],
                                        text: "All-in-one is the new norm.",
                                    },
                                    {
                                        type: "text",
                                        text: " Work collaboration tools are being commoditized and the value proposition is increasingly moving to the integration of features. Enterprise buyers don’t want to pay for tools that do the same thing. By shipping a bundle we build a defensible enterprise business.",
                                    },
                                ],
                            },
                        ],
                    },
                    {
                        type: "unorderedListItem",
                        attrs: {indent: 0},
                        content: [
                            {
                                type: "paragraph",
                                content: [
                                    {
                                        type: "text",
                                        marks: [{type: "bold"}],
                                        text: "Quality is hard to find.",
                                    },
                                    {
                                        type: "text",
                                        text: " Growth hacks, design drift, lack of conviction, and tech debt have taken a toll on the user experience of existing products. Users are frustrated and want something better. Today, buyers are facing tough decisions between best-in-class products and a bundle—we plan to build a best-in-class product bundle.",
                                    },
                                ],
                            },
                        ],
                    },
                    {
                        type: "unorderedListItem",
                        attrs: {indent: 0},
                        content: [
                            {
                                type: "paragraph",
                                content: [
                                    {
                                        type: "text",
                                        marks: [{type: "bold"}],
                                        text: "Dedicated to our craft.",
                                    },
                                    {
                                        type: "text",
                                        text: " We believe execution is the key to this opportunity. The innovation here is not the product but rather in designing a company that can build at the quality users deserve with meaningful momentum. By committing to these values we hope to attract top talent.",
                                    },
                                ],
                            },
                        ],
                    },
                    {
                        type: "unorderedListItem",
                        attrs: {indent: 0},
                        content: [
                            {
                                type: "paragraph",
                                content: [
                                    {
                                        type: "text",
                                        marks: [{type: "bold"}],
                                        text: "Stay focused and maintain work-life boundaries.",
                                    },
                                    {
                                        type: "text",
                                        text: " With all your conversations in one place, we can make sure they don’t reach you outside of work hours. We hope to help make work a more enjoyable and equitable place to be through our product’s design and get out of the way when you’re done for the day.",
                                    },
                                ],
                            },
                        ],
                    },
                    {
                        type: "heading",
                        attrs: {level: 2},
                        content: [{type: "text", text: "User journey"}],
                    },
                    {
                        type: "paragraph",
                        content: [
                            {
                                type: "text",
                                text: "When a customer uses Cyberworlds, the product should be a core part of their employee’s day-to-day roles. To help illustrate how we want the product to feel, here’s a journey of how a Cyberworlds user may go about their day:",
                            },
                        ],
                    },
                    {
                        type: "unorderedListItem",
                        attrs: {indent: 0},
                        content: [
                            {
                                type: "paragraph",
                                content: [
                                    {
                                        type: "text",
                                        text: "“When I start my day, I check my Cyberworlds inbox. I see my manager mentioned me in a document with a question. Next, my inbox shows me a summary of projects I am subscribed and tagged in. One of the projects has a task assigned to me I completed yesterday. I set the status to “done” without leaving my inbox.”",
                                    },
                                ],
                            },
                        ],
                    },
                    {
                        type: "unorderedListItem",
                        attrs: {indent: 0},
                        content: [
                            {
                                type: "paragraph",
                                content: [
                                    {
                                        type: "text",
                                        text: "“Once I’ve responded to everyone that needs my attention and skimmed subscriptions I’m casually interested in, I go to my personal task list. Cyberworlds recommends I work on a task due tomorrow. I mark the task as “in progress” which helps me organize my tasks and helps my manager see the project as a whole is on track.”",
                                    },
                                ],
                            },
                        ],
                    },
                    {
                        type: "unorderedListItem",
                        attrs: {indent: 0},
                        content: [
                            {
                                type: "paragraph",
                                content: [
                                    {
                                        type: "text",
                                        text: "“While I’m working on the task, I get a message from someone on a different team asking for advice using a tool my team owns. I remember a co-worker on my team wrote a guide for this tool last week. I hit a keyboard shortcut, type a quick search, find the document in seconds, and send it all without leaving the Cyberworlds chat.”",
                                    },
                                ],
                            },
                        ],
                    },
                    {
                        type: "unorderedListItem",
                        attrs: {indent: 0},
                        content: [
                            {
                                type: "paragraph",
                                content: [
                                    {
                                        type: "text",
                                        text: "“At the end of the day, I get a calendar notification from Cyberworlds for a work happy hour. I pack up and leave knowing I won’t get a single work notification until tomorrow morning.”",
                                    },
                                ],
                            },
                        ],
                    },
                    {
                        type: "unorderedListItem",
                        attrs: {indent: 0},
                        content: [
                            {
                                type: "paragraph",
                                content: [
                                    {
                                        type: "text",
                                        text: "“The next day when I sit down with my coffee before work, I casually browse my Cyberworlds feed instead of reading the news. Here’s a post of my co-worker’s cute dog, here’s a meme a younger colleague shared, here’s a post from a senior designer talking about color theory. I open Cyberworlds instead of reading the news because it brings me joy and brings me closer to my team.”",
                                    },
                                ],
                            },
                        ],
                    },
                    {
                        type: "heading",
                        attrs: {level: 1},
                        content: [{type: "text", text: "Strategy"}],
                    },
                    {
                        type: "paragraph",
                        content: [
                            {
                                type: "text",
                                text: "In order to reach our vision, it’s not enough to build a great product. We need to build the team and company that can make this product a reality. We care just as much about building a strong, independent, company as we care about delivering this product. We believe only an independent company can deliver a product at the quality level workers deserve.",
                            },
                        ],
                    },
                    {
                        type: "paragraph",
                        content: [
                            {type: "text", text: "Workplace productivity is an "},
                            {type: "text", marks: [{type: "italic"}], text: "incredibly"},
                            {
                                type: "text",
                                text: " crowded space and workplace productivity suites have taken decades to get to where we currently are. There’s certainly hubris in believing we can build a product of that scope and win the space. Here’s our plan:",
                            },
                        ],
                    },
                    {
                        type: "paragraph",
                        content: [
                            {type: "text", text: "We spend 1–2 years building a product that…"},
                        ],
                    },
                    {
                        type: "orderedListItem",
                        attrs: {indent: 0},
                        content: [
                            {
                                type: "paragraph",
                                content: [
                                    {
                                        type: "text",
                                        text: "Customers can adopt, pay for, and start to use for internal communication",
                                    },
                                ],
                            },
                        ],
                    },
                    {
                        type: "orderedListItem",
                        attrs: {indent: 0},
                        content: [
                            {
                                type: "paragraph",
                                content: [
                                    {
                                        type: "text",
                                        text: "Demonstrates our product vision to the market",
                                    },
                                ],
                            },
                        ],
                    },
                    {
                        type: "paragraph",
                        content: [
                            {
                                type: "text",
                                text: "We won’t start with one product. Instead we will start with:",
                            },
                        ],
                    },
                    {
                        type: "unorderedListItem",
                        attrs: {indent: 0},
                        content: [
                            {
                                type: "paragraph",
                                content: [
                                    {type: "text", marks: [{type: "bold"}], text: "Documents:"},
                                    {
                                        type: "text",
                                        text: " You are in our documents product now. Documents are an unstructured canvas customers can use to communicate longer form content.",
                                    },
                                ],
                            },
                        ],
                    },
                    {
                        type: "unorderedListItem",
                        attrs: {indent: 0},
                        content: [
                            {
                                type: "paragraph",
                                content: [
                                    {type: "text", marks: [{type: "bold"}], text: "Chat:"},
                                    {
                                        type: "text",
                                        text: " Person-to-person (or small group), live, synchronous communication. Similar to Slack our product will have the ability for person-to-person messaging and group chats. The forum product will be preferred for broadcast style communication and structured discussions.",
                                    },
                                ],
                            },
                        ],
                    },
                    {
                        type: "unorderedListItem",
                        attrs: {indent: 0},
                        content: [
                            {
                                type: "paragraph",
                                content: [
                                    {type: "text", marks: [{type: "bold"}], text: "Forum:"},
                                    {
                                        type: "text",
                                        text: " Asynchronous, threaded communication among large groups of people. Posts are organized into topics and ranked by an algorithmic feed. The best parts of email combined with the best parts of realtime chat.",
                                    },
                                ],
                            },
                        ],
                    },
                    {
                        type: "unorderedListItem",
                        attrs: {indent: 0},
                        content: [
                            {
                                type: "paragraph",
                                content: [
                                    {type: "text", marks: [{type: "bold"}], text: "Tasks:"},
                                    {
                                        type: "text",
                                        text: " Every person gets a best-in-class personalized task product and the data ladders up into a larger project management system managers can use to plan and track work across teams. Project management solutions don’t work if the end-user isn’t in the habit of contributing data.",
                                    },
                                ],
                            },
                        ],
                    },
                    {
                        type: "paragraph",
                        content: [
                            {
                                type: "text",
                                text: "We hope to make each product 10–20% higher quality than competitive solutions in core workflows and will fill out feature gaps over time.",
                            },
                        ],
                    },
                    {
                        type: "paragraph",
                        content: [
                            {
                                type: "text",
                                text: "We believe what will truly differentiate our solution and make it 10x better than what’s out there is deep integration across products. The meta features we will have at launch are:",
                            },
                        ],
                    },
                    {
                        type: "unorderedListItem",
                        attrs: {indent: 0},
                        content: [
                            {
                                type: "paragraph",
                                content: [
                                    {type: "text", marks: [{type: "bold"}], text: "Search:"},
                                    {
                                        type: "text",
                                        text: " Rich search capability accessible from anywhere that gets a user to their destination from a simple text input in seconds. As usage grows we want to improve search ranking with natural language processing (“documents by Caleb”), knowledge of the content link graph (PageRank anyone?), and knowledge of the social graph (prioritize content from my teammates).",
                                    },
                                ],
                            },
                        ],
                    },
                    {
                        type: "unorderedListItem",
                        attrs: {indent: 0},
                        content: [
                            {
                                type: "paragraph",
                                content: [
                                    {type: "text", marks: [{type: "bold"}], text: "Inbox:"},
                                    {
                                        type: "text",
                                        text: " All of your mentions and subscriptions in one, organized, place. With intelligent prioritization of notifications and better handling of resolved/unresolved states than read/unread.",
                                    },
                                ],
                            },
                        ],
                    },
                    {
                        type: "unorderedListItem",
                        attrs: {indent: 0},
                        content: [
                            {
                                type: "paragraph",
                                content: [
                                    {type: "text", marks: [{type: "bold"}], text: "Mobile:"},
                                    {
                                        type: "text",
                                        text: " We want to meet people wherever they work. Many people spend a good chunk of time working from their phones. We aim to have a feature compatible and high quality mobile app. We have a technical strategy that will get us to feature compatible in 1–2 years. Meeting our quality bar is a risk but we can iterate over time.",
                                    },
                                ],
                            },
                        ],
                    },
                    {
                        type: "unorderedListItem",
                        attrs: {indent: 0},
                        content: [
                            {
                                type: "paragraph",
                                content: [
                                    {type: "text", marks: [{type: "bold"}], text: "Feed:"},
                                    {
                                        type: "text",
                                        text: " The home page will be an algorithmically ranked feed showing you interesting content from across your organization. This helps people feel more connected to and learn from their colleagues. In addition to being a growth lever as people see how their co-workers use the product. Feed is where watercooler style soft work happens. Unlike inbox which is a part of a user’s core workflow.",
                                    },
                                ],
                            },
                        ],
                    },
                    {
                        type: "heading",
                        attrs: {level: 2},
                        content: [{type: "text", text: "What quality means to us"}],
                    },
                    {
                        type: "paragraph",
                        content: [
                            {
                                type: "text",
                                text: "We want the product to feel well made and trustworthy. We recognize that people can’t perceive every marginal quality improvement but on the whole we know how different a well built product can ",
                            },
                            {type: "text", marks: [{type: "italic"}], text: "feel"},
                            {
                                type: "text",
                                text: ". In a world where most software doesn’t feel amazing, people will want to share our software which does.",
                            },
                        ],
                    },
                    {
                        type: "unorderedListItem",
                        attrs: {indent: 0},
                        content: [
                            {
                                type: "paragraph",
                                content: [
                                    {
                                        type: "text",
                                        marks: [{type: "bold"}],
                                        text: "Speed of thought:",
                                    },
                                    {
                                        type: "text",
                                        text: " Users perceive the product as responding immediately to any of their commands. The product doesn’t slow down as usage across their company increases. When the user wants to “write something down real quick” they open Cyberworlds.",
                                    },
                                ],
                            },
                        ],
                    },
                    {
                        type: "unorderedListItem",
                        attrs: {indent: 0},
                        content: [
                            {
                                type: "paragraph",
                                content: [
                                    {type: "text", marks: [{type: "bold"}], text: "Zero glitches:"},
                                    {
                                        type: "text",
                                        text: " When the user expects something to happen, it happens. It is exceedingly rare to see an error message or UI in a broken state. The product feels reliable for even the customer’s most critical work.",
                                    },
                                ],
                            },
                        ],
                    },
                    {
                        type: "unorderedListItem",
                        attrs: {indent: 0},
                        content: [
                            {
                                type: "paragraph",
                                content: [
                                    {
                                        type: "text",
                                        marks: [{type: "bold"}],
                                        text: "Design excellence:",
                                    },
                                    {
                                        type: "text",
                                        text: " We practice and expect design excellence across the product and organization. Our product will be meticulously crafted in every pixel and interaction. Interaction design excellence includes making sure the product is accessible by keyboard and by touch.",
                                    },
                                ],
                            },
                        ],
                    },
                    {
                        type: "heading",
                        attrs: {level: 2},
                        content: [
                            {type: "text", text: "Differentiation, go to market, and pricing"},
                        ],
                    },
                    {
                        type: "paragraph",
                        content: [
                            {
                                type: "text",
                                text: "Our initial customer base will be product, design, and engineering teams. These teams are more likely to appreciate a product with an intense focus on craft. If we are successful at building a high quality product we will have marketing material for these teams. We show how much thought we put into the product, share our techniques, and in turn get teams excited to try our product for themselves. (This also has a side effect of attracting talent to come work with us.)",
                            },
                        ],
                    },
                    {
                        type: "paragraph",
                        content: [
                            {
                                type: "text",
                                text: "These teams are also more likely to be using the “",
                            },
                            {type: "text", marks: [{type: "bold"}], text: "Slack stack"},
                            {
                                type: "text",
                                text: ".” The Slack stack is what we call a hand-rolled collaboration suite using Slack and other point solution products like Zoom, Quip, Asana, Atlassian, Notion, and Google Workspace on the side (for email and calendar). We believe that if we can build the products and features in the previous section we will be in striking distance of a 10x improvement compared to cobbling together equivalent tools in the Slack stack.",
                            },
                        ],
                    },
                    {
                        type: "paragraph",
                        content: [
                            {
                                type: "text",
                                text: "Our product led growth motion will be: insist on email sign in using a company email address. Strongly discouraging, maybe even disallowing (without extra friction), signing up with free email domains like @gmail.com. When the user verifies their email address we automatically add them to the company workspace. (This is why we sent you one-time password to your email when you signed in. We verify your email and get you in at the same time.)",
                            },
                        ],
                    },
                    {
                        type: "paragraph",
                        content: [
                            {
                                type: "text",
                                text: "We will give SSO away for free to start building good will with IT and encourage centralized IT management.",
                            },
                        ],
                    },
                    {
                        type: "paragraph",
                        content: [
                            {type: "text", text: "Our pricing tokenizer will be "},
                            {type: "text", marks: [{type: "bold"}], text: "usage based pricing"},
                            {type: "text", text: ". "},
                            {
                                type: "text",
                                marks: [{type: "italic"}],
                                text: "Every single employee in an organization should be able to sign into their company workspace for $0",
                            },
                            {
                                type: "text",
                                text: ". Only as employees actually start to use the product do we start to charge. This also means as we launch new products and usage goes up—we make more revenue without new pricing models to learn.",
                            },
                        ],
                    },
                    {
                        type: "paragraph",
                        content: [
                            {
                                type: "text",
                                text: "Right now, the plan is to charge by hours using the product in increments of ~100 hours/week. Tracking time is a unified way to measure usage across all products. It is simple to understand and so easy for finance teams to estimate. We charge in increments of 100 hours/week so that individual behavior does not change the bill. Increased usage from at least two or three users is needed for the bill to increase (say usage from individual users fluctuates between 5–20 hours/week).",
                            },
                        ],
                    },
                    {
                        type: "paragraph",
                        content: [
                            {
                                type: "text",
                                text: "Of course we can provide custom enterprise plans that lock in a price for stability.",
                            },
                        ],
                    },
                    {
                        type: "paragraph",
                        content: [
                            {
                                type: "text",
                                text: "While this pricing tokenizer can get expensive when Cyberworlds is fully adopted in an organization, it will be less expensive than paying for each of these tools individually. So we can make a consolidation and cost saving argument to IT as the product gains adoption within an organization.",
                            },
                        ],
                    },
                    {
                        type: "heading",
                        attrs: {level: 2},
                        content: [
                            {
                                type: "text",
                                text: "Example scenario of the product led growth motion",
                            },
                        ],
                    },
                    {
                        type: "paragraph",
                        content: [
                            {
                                type: "text",
                                text: "Sara is a designer at a company which uses the Slack stack. She has seen design tips from Cyberworlds on Twitter and TikTok. She needs to write a document and thinks highly of the Cyberworlds document editor so signs in with her company email (automatically creating a workspace for the company). She shares the document link with her team and when they sign in with their company emails they are automatically added to the workspace and can see her document.",
                            },
                        ],
                    },
                    {
                        type: "paragraph",
                        content: [
                            {
                                type: "text",
                                text: "Joe is a product manager reading Sara’s document. He notices Cyberworlds has a personal task list so he adds some personal tasks there since it’s convenient and has the features he needs. As he starts to add more tasks he notices the timeline feature. So for the next project his team is building he creates a work timeline in Cyberworlds. He shares this with his team and manager who all start to sign in. Organically his team and the other teams they are working with start to prefer using Cyberworlds to other tools bought by their organization because they are high quality and deeply integrated with each other.",
                            },
                        ],
                    },
                    {
                        type: "paragraph",
                        content: [
                            {
                                type: "text",
                                text: "The bill grows at a measured pace as more and more folks within the organization adopt the product. At first it starts as a small cost which can be easily justified and expensed. Over time the bill attracts the attention of IT.",
                            },
                        ],
                    },
                    {
                        type: "paragraph",
                        content: [
                            {
                                type: "text",
                                text: "Eventually our sales team makes contact with IT. We make the argument that the company will pay ",
                            },
                            {type: "text", marks: [{type: "italic"}], text: "less"},
                            {
                                type: "text",
                                text: " money than the Slack stack if they switch to Cyberworlds and end-users will have a better experience making them more productive.",
                            },
                        ],
                    },
                    {type: "divider"},
                    {
                        type: "paragraph",
                        content: [
                            {
                                type: "text",
                                text: "This is only a strategy for how we beat the Slack stack in product teams. Eventually we want to compete against Microsoft. If we can land in product teams, start to eat market share from the Slack stack, from there we can start to build out the full product suite. Email, calendar, video conferencing, white boarding, slides, sheets, etc.",
                            },
                        ],
                    },
                    {
                        type: "paragraph",
                        content: [
                            {
                                type: "text",
                                text: "Each product we launch is more revenue from the customers we already have because they’ll use the product more. And expands the aperture of companies we can credibly say “replace your existing tools with Cyberworlds.”",
                            },
                        ],
                    },
                    {
                        type: "paragraph",
                        content: [
                            {
                                type: "text",
                                text: "In the first 3–4 years we will likely be very focused on beating the Slack stack in product teams. Once we are in a position of strength there, we will update our strategy.",
                            },
                        ],
                    },
                    {
                        type: "paragraph",
                        content: [
                            {
                                type: "text",
                                text: "To learn how we plan to build this product read our ",
                            },
                            {
                                type: "text",
                                marks: [
                                    {
                                        type: "link",
                                        attrs: {
                                            url: "https://cyberworlds.dev/s/111hc413nfdxa6vwspnhm3ejsc/documents/w1675bxd15e10cf0mhrmdcgq24",
                                        },
                                    },
                                ],
                                text: "1–2 year execution plan",
                            },
                            {type: "text", text: ". Want to invest? Learn more about our "},
                            {
                                type: "text",
                                marks: [
                                    {
                                        type: "link",
                                        attrs: {
                                            url: "https://cyberworlds.dev/s/111hc413nfdxa6vwspnhm3ejsc/documents/947dbjnmhvv1h2txwxkycmp320",
                                        },
                                    },
                                ],
                                text: "friends and family",
                            },
                            {
                                type: "text",
                                text: " round. To go back to the page with all our full document packet click ",
                            },
                            {
                                type: "text",
                                marks: [
                                    {
                                        type: "link",
                                        attrs: {
                                            url: "https://cyberworlds.dev/s/111hc413nfdxa6vwspnhm3ejsc/documents/9rfgay7czbxcbzvgarpyb1ycz8",
                                        },
                                    },
                                ],
                                text: "here",
                            },
                            {type: "text", text: "."},
                        ],
                    },
                ],
            }) as DocumentContent,
            {tokenizer, getAccountIfExists, getSearchEntityIfExists},
        ).getEmbeddingChunks(),
    ).toEqual([
        // Chunk 1:
        {
            preambleEndIndex: 31,
            tokenCountWithoutPreamble: 481,
            text: `\
# Product vision and strategy

This document is a part of our packet introducing Cyberworlds (code name, will change when we go to market). See all documents in this packet

## Vision

Our product’s mission is: **Help people work together**

People can build great things when they work together. We aim to improve the productivity of our customers so they can build even more great things.

Cyberworlds will streamline work collaboration by bringing together the top productivity tools (chat, documents, tasks, video conferencing, calendaring, email, sheets, slides) into one deeply integrated product. Some things we believe:

- **Our tools are fragmented.** Bringing a project to completion shouldn’t involve jumping between tools and losing track of where things are happening. Instead it should feel like a continuous experience from idea to execution.
- **Conversations are core to collaboration.** We plan to unify conversations across the product experience. Never lose track of what’s happening and pick up the conversation where you left off.
- **All-in-one is the new norm.** Work collaboration tools are being commoditized and the value proposition is increasingly moving to the integration of features. Enterprise buyers don’t want to pay for tools that do the same thing. By shipping a bundle we build a defensible enterprise business.
- **Quality is hard to find.** Growth hacks, design drift, lack of conviction, and tech debt have taken a toll on the user experience of existing products. Users are frustrated and want something better. Today, buyers are facing tough decisions between best-in-class products and a bundle—we plan to build a best-in-class product bundle.
- **Dedicated to our craft.** We believe execution is the key to this opportunity. The innovation here is not the product but rather in designing a company that can build at the quality users deserve with meaningful momentum. By committing to these values we hope to attract top talent.
- **Stay focused and maintain work-life boundaries.** With all your conversations in one place, we can make sure they don’t reach you outside of work hours. We hope to help make work a more enjoyable and equitable place to be through our product’s design and get out of the way when you’re done for the day.`,
        },

        // Chunk 2:
        {
            preambleEndIndex: 58,
            tokenCountWithoutPreamble: 432,
            text: `\
This is from the “Product vision and strategy” document:

### User journey

When a customer uses Cyberworlds, the product should be a core part of their employee’s day-to-day roles. To help illustrate how we want the product to feel, here’s a journey of how a Cyberworlds user may go about their day:

- “When I start my day, I check my Cyberworlds inbox. I see my manager mentioned me in a document with a question. Next, my inbox shows me a summary of projects I am subscribed and tagged in. One of the projects has a task assigned to me I completed yesterday. I set the status to “done” without leaving my inbox.”
- “Once I’ve responded to everyone that needs my attention and skimmed subscriptions I’m casually interested in, I go to my personal task list. Cyberworlds recommends I work on a task due tomorrow. I mark the task as “in progress” which helps me organize my tasks and helps my manager see the project as a whole is on track.”
- “While I’m working on the task, I get a message from someone on a different team asking for advice using a tool my team owns. I remember a co-worker on my team wrote a guide for this tool last week. I hit a keyboard shortcut, type a quick search, find the document in seconds, and send it all without leaving the Cyberworlds chat.”
- “At the end of the day, I get a calendar notification from Cyberworlds for a work happy hour. I pack up and leave knowing I won’t get a single work notification until tomorrow morning.”
- “The next day when I sit down with my coffee before work, I casually browse my Cyberworlds feed instead of reading the news. Here’s a post of my co-worker’s cute dog, here’s a meme a younger colleague shared, here’s a post from a senior designer talking about color theory. I open Cyberworlds instead of reading the news because it brings me joy and brings me closer to my team.”`,
        },

        // Chunk 3:
        {
            preambleEndIndex: 58,
            tokenCountWithoutPreamble: 412,
            text: `\
This is from the “Product vision and strategy” document:

## Strategy

In order to reach our vision, it’s not enough to build a great product. We need to build the team and company that can make this product a reality. We care just as much about building a strong, independent, company as we care about delivering this product. We believe only an independent company can deliver a product at the quality level workers deserve.

Workplace productivity is an *incredibly* crowded space and workplace productivity suites have taken decades to get to where we currently are. There’s certainly hubris in believing we can build a product of that scope and win the space. Here’s our plan:

We spend 1–2 years building a product that…

1. Customers can adopt, pay for, and start to use for internal communication
2. Demonstrates our product vision to the market

We won’t start with one product. Instead we will start with:

- **Documents:** You are in our documents product now. Documents are an unstructured canvas customers can use to communicate longer form content.
- **Chat:** Person-to-person (or small group), live, synchronous communication. Similar to Slack our product will have the ability for person-to-person messaging and group chats. The forum product will be preferred for broadcast style communication and structured discussions.
- **Forum:** Asynchronous, threaded communication among large groups of people. Posts are organized into topics and ranked by an algorithmic feed. The best parts of email combined with the best parts of realtime chat.
- **Tasks:** Every person gets a best-in-class personalized task product and the data ladders up into a larger project management system managers can use to plan and track work across teams. Project management solutions don’t work if the end-user isn’t in the habit of contributing data.

We hope to make each product 10–20% higher quality than competitive solutions in core workflows and will fill out feature gaps over time.`,
        },

        // Chunk 4:
        {
            preambleEndIndex: 84,
            tokenCountWithoutPreamble: 322,
            text: `\
This is from the “Product vision and strategy” document in the “Strategy” section:

We believe what will truly differentiate our solution and make it 10x better than what’s out there is deep integration across products. The meta features we will have at launch are:

- **Search:** Rich search capability accessible from anywhere that gets a user to their destination from a simple text input in seconds. As usage grows we want to improve search ranking with natural language processing (“documents by Caleb”), knowledge of the content link graph (PageRank anyone?), and knowledge of the social graph (prioritize content from my teammates).
- **Inbox:** All of your mentions and subscriptions in one, organized, place. With intelligent prioritization of notifications and better handling of resolved/unresolved states than read/unread.
- **Mobile:** We want to meet people wherever they work. Many people spend a good chunk of time working from their phones. We aim to have a feature compatible and high quality mobile app. We have a technical strategy that will get us to feature compatible in 1–2 years. Meeting our quality bar is a risk but we can iterate over time.
- **Feed:** The home page will be an algorithmically ranked feed showing you interesting content from across your organization. This helps people feel more connected to and learn from their colleagues. In addition to being a growth lever as people see how their co-workers use the product. Feed is where watercooler style soft work happens. Unlike inbox which is a part of a user’s core workflow.`,
        },

        // Chunk 5:
        {
            preambleEndIndex: 58,
            tokenCountWithoutPreamble: 227,
            text: `\
This is from the “Product vision and strategy” document:

### What quality means to us

We want the product to feel well made and trustworthy. We recognize that people can’t perceive every marginal quality improvement but on the whole we know how different a well built product can *feel*. In a world where most software doesn’t feel amazing, people will want to share our software which does.

- **Speed of thought:** Users perceive the product as responding immediately to any of their commands. The product doesn’t slow down as usage across their company increases. When the user wants to “write something down real quick” they open Cyberworlds.
- **Zero glitches:** When the user expects something to happen, it happens. It is exceedingly rare to see an error message or UI in a broken state. The product feels reliable for even the customer’s most critical work.
- **Design excellence:** We practice and expect design excellence across the product and organization. Our product will be meticulously crafted in every pixel and interaction. Interaction design excellence includes making sure the product is accessible by keyboard and by touch.`,
        },

        // Chunk 6:
        {
            preambleEndIndex: 58,
            tokenCountWithoutPreamble: 407,
            text: `\
This is from the “Product vision and strategy” document:

### Differentiation, go to market, and pricing

Our initial customer base will be product, design, and engineering teams. These teams are more likely to appreciate a product with an intense focus on craft. If we are successful at building a high quality product we will have marketing material for these teams. We show how much thought we put into the product, share our techniques, and in turn get teams excited to try our product for themselves. (This also has a side effect of attracting talent to come work with us.)

These teams are also more likely to be using the “**Slack stack**.” The Slack stack is what we call a hand-rolled collaboration suite using Slack and other point solution products like Zoom, Quip, Asana, Atlassian, Notion, and Google Workspace on the side (for email and calendar). We believe that if we can build the products and features in the previous section we will be in striking distance of a 10x improvement compared to cobbling together equivalent tools in the Slack stack.

Our product led growth motion will be: insist on email sign in using a company email address. Strongly discouraging, maybe even disallowing (without extra friction), signing up with free email domains like @gmail.com. When the user verifies their email address we automatically add them to the company workspace. (This is why we sent you one-time password to your email when you signed in. We verify your email and get you in at the same time.)

We will give SSO away for free to start building good will with IT and encourage centralized IT management.

Our pricing tokenizer will be **usage based pricing**. *Every single employee in an organization should be able to sign into their company workspace for $0*. Only as employees actually start to use the product do we start to charge. This also means as we launch new products and usage goes up—we make more revenue without new pricing models to learn.`,
        },

        // Chunk 7:
        {
            preambleEndIndex: 118,
            tokenCountWithoutPreamble: 178,
            text: `\
This is from the “Product vision and strategy” document in the “Differentiation, go to market, and pricing” section:

Right now, the plan is to charge by hours using the product in increments of \\~100 hours/week. Tracking time is a unified way to measure usage across all products. It is simple to understand and so easy for finance teams to estimate. We charge in increments of 100 hours/week so that individual behavior does not change the bill. Increased usage from at least two or three users is needed for the bill to increase (say usage from individual users fluctuates between 5–20 hours/week).

Of course we can provide custom enterprise plans that lock in a price for stability.

While this pricing tokenizer can get expensive when Cyberworlds is fully adopted in an organization, it will be less expensive than paying for each of these tools individually. So we can make a consolidation and cost saving argument to IT as the product gains adoption within an organization.`,
        },

        // Chunk 8:
        {
            preambleEndIndex: 58,
            tokenCountWithoutPreamble: 323,
            text: `\
This is from the “Product vision and strategy” document:

### Example scenario of the product led growth motion

Sara is a designer at a company which uses the Slack stack. She has seen design tips from Cyberworlds on Twitter and TikTok. She needs to write a document and thinks highly of the Cyberworlds document editor so signs in with her company email (automatically creating a workspace for the company). She shares the document link with her team and when they sign in with their company emails they are automatically added to the workspace and can see her document.

Joe is a product manager reading Sara’s document. He notices Cyberworlds has a personal task list so he adds some personal tasks there since it’s convenient and has the features he needs. As he starts to add more tasks he notices the timeline feature. So for the next project his team is building he creates a work timeline in Cyberworlds. He shares this with his team and manager who all start to sign in. Organically his team and the other teams they are working with start to prefer using Cyberworlds to other tools bought by their organization because they are high quality and deeply integrated with each other.

The bill grows at a measured pace as more and more folks within the organization adopt the product. At first it starts as a small cost which can be easily justified and expensed. Over time the bill attracts the attention of IT.

Eventually our sales team makes contact with IT. We make the argument that the company will pay *less* money than the Slack stack if they switch to Cyberworlds and end-users will have a better experience making them more productive.`,
        },

        // Chunk 9:
        {
            preambleEndIndex: 58,
            tokenCountWithoutPreamble: 206,
            text: `\
This is from the “Product vision and strategy” document:

---

This is only a strategy for how we beat the Slack stack in product teams. Eventually we want to compete against Microsoft. If we can land in product teams, start to eat market share from the Slack stack, from there we can start to build out the full product suite. Email, calendar, video conferencing, white boarding, slides, sheets, etc.

Each product we launch is more revenue from the customers we already have because they’ll use the product more. And expands the aperture of companies we can credibly say “replace your existing tools with Cyberworlds.”

In the first 3–4 years we will likely be very focused on beating the Slack stack in product teams. Once we are in a position of strength there, we will update our strategy.

To learn how we plan to build this product read our 1–2 year execution plan. Want to invest? Learn more about our friends and family round. To go back to the page with all our full document packet click here.`,
        },
    ]);
});

test("correctly chunks long document content by sentences", async () => {
    const tokenizer = await CohereEmbedEnglishV3LanguageTokenizer.get();
    const getAccountIfExists = () => null;
    const getSearchEntityIfExists = () => null;

    expect(
        chunkDocumentSearchContent(
            DocumentContentProsemirrorSchema.nodeFromJSON({
                type: "doc",
                content: [
                    {type: "title", content: [{type: "text", text: "Lorem Ipsum"}]},
                    {
                        type: "paragraph",
                        content: [
                            {
                                type: "text",
                                text: "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Nunc tristique eleifend vulputate. Aliquam sed diam dictum, pharetra orci non, vehicula lacus. In velit diam, ullamcorper ut ultrices at, rutrum a mi. Aliquam placerat eget est eu iaculis. Cras orci sem, rhoncus vel diam et, imperdiet porta arcu. Praesent lobortis odio vitae nulla vehicula, vel vestibulum nunc ullamcorper. Nunc suscipit tristique dui, id ullamcorper risus interdum vel. Maecenas semper feugiat metus, lacinia auctor urna laoreet egestas. Pellentesque ut gravida eros. Pellentesque non nisi elementum, egestas sapien nec, dictum nulla. Pellentesque accumsan pretium velit eget convallis. Aenean tincidunt, elit vitae iaculis sagittis, arcu velit vestibulum ante, in porttitor massa sapien porta nibh. Aenean et magna in est maximus luctus. Sed ultrices finibus elit, ac viverra felis. Duis commodo justo et aliquet vehicula. Mauris ut ornare erat. Suspendisse imperdiet euismod eros non dapibus. In ut consectetur massa. Nunc maximus at odio nec porta. Nullam eget dolor ac ante scelerisque finibus vel eu dui. Mauris sed sapien at tellus pellentesque tincidunt nec luctus nulla. Nullam finibus mauris at sodales bibendum. Sed interdum, eros ac dictum auctor, odio mi venenatis tortor, vitae euismod arcu purus sit amet nunc. Vestibulum eleifend maximus magna, quis luctus elit scelerisque sit amet. Integer pretium augue non tortor tempus, dapibus fermentum mi egestas. Nullam aliquet, nibh semper aliquam ornare, quam mi vehicula felis, ac eleifend nisi metus sed lorem. Maecenas pellentesque orci nulla, vel tincidunt ipsum dignissim ac. Cras elementum venenatis ultricies. Sed efficitur interdum sem, ac vulputate nibh tincidunt non. Vivamus vitae euismod quam, nec vehicula massa. Sed tortor erat, dictum eget sem in, pretium placerat arcu. Mauris ut vulputate ipsum, quis porttitor lacus. Fusce consequat nulla in gravida ultricies. Morbi venenatis, odio a congue aliquam, arcu mi molestie quam, ac porttitor massa nibh ut velit. Pellentesque habitant morbi tristique senectus et netus et malesuada fames ac turpis egestas. Sed magna ligula, porttitor in augue ut, rutrum rutrum erat. Fusce vehicula augue tincidunt eleifend maximus. Curabitur vel ullamcorper ligula. Fusce velit nibh, posuere at suscipit venenatis, vehicula mattis mi. Integer at erat commodo, dictum nunc id, egestas ex. Maecenas aliquet lacus vel urna ornare condimentum. Nullam nec laoreet felis. Vestibulum eget tincidunt enim. Sed dictum mi tellus, ut efficitur nunc hendrerit ac. In a ipsum neque. Proin id nibh eu leo placerat sagittis. Vivamus vitae iaculis turpis. Sed vulputate quis sapien eu ornare. Donec eleifend semper est, malesuada tincidunt risus iaculis at. Aliquam ultricies vitae mauris nec malesuada. Curabitur dolor lectus, rhoncus eget lobortis et, ullamcorper vitae elit. Maecenas finibus tortor sed tincidunt lobortis. Phasellus facilisis est vitae neque porttitor, vitae blandit ipsum placerat. Nunc et tincidunt urna. Nunc aliquam odio ullamcorper justo suscipit sollicitudin. Pellentesque habitant morbi tristique senectus et netus et malesuada fames ac turpis egestas. Mauris ac lorem tempor, tempus magna euismod, convallis felis. Integer ac ex diam. Nunc lacinia vestibulum erat, sed placerat nisi molestie et.",
                            },
                        ],
                    },
                ],
            }) as DocumentContent,
            {tokenizer, getAccountIfExists, getSearchEntityIfExists},
        ).getEmbeddingChunks(),
    ).toEqual([
        {
            preambleEndIndex: 15,
            tokenCountWithoutPreamble: 502,
            text: "# Lorem Ipsum\n\nLorem ipsum dolor sit amet, consectetur adipiscing elit. Nunc tristique eleifend vulputate. Aliquam sed diam dictum, pharetra orci non, vehicula lacus. In velit diam, ullamcorper ut ultrices at, rutrum a mi. Aliquam placerat eget est eu iaculis. Cras orci sem, rhoncus vel diam et, imperdiet porta arcu. Praesent lobortis odio vitae nulla vehicula, vel vestibulum nunc ullamcorper. Nunc suscipit tristique dui, id ullamcorper risus interdum vel. Maecenas semper feugiat metus, lacinia auctor urna laoreet egestas. Pellentesque ut gravida eros. Pellentesque non nisi elementum, egestas sapien nec, dictum nulla. Pellentesque accumsan pretium velit eget convallis. Aenean tincidunt, elit vitae iaculis sagittis, arcu velit vestibulum ante, in porttitor massa sapien porta nibh. Aenean et magna in est maximus luctus. Sed ultrices finibus elit, ac viverra felis. Duis commodo justo et aliquet vehicula. Mauris ut ornare erat. Suspendisse imperdiet euismod eros non dapibus. In ut consectetur massa. Nunc maximus at odio nec porta. Nullam eget dolor ac ante scelerisque finibus vel eu dui. Mauris sed sapien at tellus pellentesque tincidunt nec luctus nulla. Nullam finibus mauris at sodales bibendum. Sed interdum, eros ac dictum auctor, odio mi venenatis tortor, vitae euismod arcu purus sit amet nunc. Vestibulum eleifend maximus magna, quis luctus elit scelerisque sit amet.",
        },
        {
            preambleEndIndex: 42,
            tokenCountWithoutPreamble: 498,
            text: "This is from the “Lorem Ipsum” document:\n\nInteger pretium augue non tortor tempus, dapibus fermentum mi egestas. Nullam aliquet, nibh semper aliquam ornare, quam mi vehicula felis, ac eleifend nisi metus sed lorem. Maecenas pellentesque orci nulla, vel tincidunt ipsum dignissim ac. Cras elementum venenatis ultricies. Sed efficitur interdum sem, ac vulputate nibh tincidunt non. Vivamus vitae euismod quam, nec vehicula massa. Sed tortor erat, dictum eget sem in, pretium placerat arcu. Mauris ut vulputate ipsum, quis porttitor lacus. Fusce consequat nulla in gravida ultricies. Morbi venenatis, odio a congue aliquam, arcu mi molestie quam, ac porttitor massa nibh ut velit. Pellentesque habitant morbi tristique senectus et netus et malesuada fames ac turpis egestas. Sed magna ligula, porttitor in augue ut, rutrum rutrum erat. Fusce vehicula augue tincidunt eleifend maximus. Curabitur vel ullamcorper ligula. Fusce velit nibh, posuere at suscipit venenatis, vehicula mattis mi. Integer at erat commodo, dictum nunc id, egestas ex. Maecenas aliquet lacus vel urna ornare condimentum. Nullam nec laoreet felis. Vestibulum eget tincidunt enim. Sed dictum mi tellus, ut efficitur nunc hendrerit ac. In a ipsum neque. Proin id nibh eu leo placerat sagittis. Vivamus vitae iaculis turpis. Sed vulputate quis sapien eu ornare. Donec eleifend semper est, malesuada tincidunt risus iaculis at.",
        },
        {
            preambleEndIndex: 42,
            tokenCountWithoutPreamble: 200,
            text: "This is from the “Lorem Ipsum” document:\n\nAliquam ultricies vitae mauris nec malesuada. Curabitur dolor lectus, rhoncus eget lobortis et, ullamcorper vitae elit. Maecenas finibus tortor sed tincidunt lobortis. Phasellus facilisis est vitae neque porttitor, vitae blandit ipsum placerat. Nunc et tincidunt urna. Nunc aliquam odio ullamcorper justo suscipit sollicitudin. Pellentesque habitant morbi tristique senectus et netus et malesuada fames ac turpis egestas. Mauris ac lorem tempor, tempus magna euismod, convallis felis. Integer ac ex diam. Nunc lacinia vestibulum erat, sed placerat nisi molestie et.",
        },
    ]);
});

test("correctly chunks mathematical looking content", async () => {
    const tokenizer = await CohereEmbedEnglishV3LanguageTokenizer.get();
    const getAccountIfExists = () => null;
    const getSearchEntityIfExists = () => null;

    expect(
        testGetFullSearchContentChunk(
            schema.nodeFromJSON({
                type: "doc",
                content: [
                    {
                        type: "paragraph",
                        content: [
                            {
                                type: "text",
                                text: "where 1 ≤ i ≤ m and 1 ≤ j ≤ p. For example, the underlined entry 2340 in the product is calculated as (2 × 1000) + (3 × 100) + (4 × 10) = 2340:",
                            },
                        ],
                    },
                    {
                        type: "paragraph",
                        content: [
                            {
                                type: "text",
                                text: "<math>",
                            },
                        ],
                    },
                    {
                        type: "paragraph",
                        content: [
                            {
                                type: "text",
                                text: "\\begin{align} \\begin{bmatrix} \\underline{2} & \\underline 3 & \\underline 4 \\\\ 1 & 0 & 0 \\\\ \\end{bmatrix}",
                            },
                        ],
                    },
                    {
                        type: "paragraph",
                        content: [
                            {
                                type: "text",
                                text: "\\begin{bmatrix} 0 & \\underline{1000} \\\\ 1 & \\underline{100} \\\\ 0 & \\underline{10} \\\\ \\end{bmatrix} &= \\begin{bmatrix} 3 & \\underline{2340} \\\\ 0 & 1000 \\\\ \\end{bmatrix}. \\end{align} </math>",
                            },
                        ],
                    },
                ],
            }),
            {tokenizer, getAccountIfExists, getSearchEntityIfExists},
        ),
    ).toEqual({
        text: `\
where 1 ≤ i ≤ m and 1 ≤ j ≤ p. For example, the underlined entry 2340 in the product is calculated as (2 × 1000) + (3 × 100) + (4 × 10) = 2340:

\\<math>

\\\\begin{align} \\\\begin{bmatrix} \\\\underline{2} & \\\\underline 3 & \\\\underline 4 \\\\\\\\ 1 & 0 & 0 \\\\\\\\ \\\\end{bmatrix}

\\\\begin{bmatrix} 0 & \\\\underline{1000} \\\\\\\\ 1 & \\\\underline{100} \\\\\\\\ 0 & \\\\underline{10} \\\\\\\\ \\\\end{bmatrix} &= \\\\begin{bmatrix} 3 & \\\\underline{2340} \\\\\\\\ 0 & 1000 \\\\\\\\ \\\\end{bmatrix}. \\\\end{align} \\</math>`,
        isGroup: true,
        context: {
            sectionHeading: null,
        },
        tokenCount: 213,
        childChunks: [
            {
                isGroup: true,
                context: {
                    sectionHeading: null,
                },
                tokenCount: 53,
                childChunks: [
                    {
                        isGroup: false,
                        tokenCount: 49,
                        context: {sectionHeading: null},
                        sentenceChunks: [
                            {
                                text: "where 1 ≤ i ≤ m and 1 ≤ j ≤ p. For example, the underlined entry 2340 in the product is calculated as (2 × 1000) + (3 × 100) + (4 × 10) = 2340:",
                                tokenCount: 49,
                            },
                        ],
                        lineMarginTop: 2,
                        lineMarginBottom: 2,
                    },
                    {
                        isGroup: false,
                        tokenCount: 4,
                        context: {sectionHeading: null},
                        sentenceChunks: [{text: "\\<math>", tokenCount: 4}],
                        lineMarginTop: 2,
                        lineMarginBottom: 2,
                    },
                ],
            },
            {
                isGroup: false,
                tokenCount: 54,
                context: {
                    sectionHeading: null,
                },
                sentenceChunks: [
                    {
                        text: "\\\\begin{align} \\\\begin{bmatrix} \\\\underline{2} & \\\\underline 3 & \\\\underline 4 \\\\\\\\ 1 & 0 & 0 \\\\\\\\ \\\\end{bmatrix}",
                        tokenCount: 54,
                    },
                ],
                lineMarginTop: 2,
                lineMarginBottom: 2,
            },
            {
                isGroup: false,
                tokenCount: 106,
                context: {
                    sectionHeading: null,
                },
                sentenceChunks: [
                    {
                        text: "\\\\begin{bmatrix} 0 & \\\\underline{1000} \\\\\\\\ 1 & \\\\underline{100} \\\\\\\\ 0 & \\\\underline{10} \\\\\\\\ \\\\end{bmatrix} &= \\\\begin{bmatrix} 3 & \\\\underline{2340} \\\\\\\\ 0 & 1000 \\\\\\\\ \\\\end{bmatrix}.",
                        tokenCount: 95,
                    },
                    {
                        text: "\\\\end{align} \\</math>",
                        tokenCount: 11,
                    },
                ],
                lineMarginTop: 2,
                lineMarginBottom: 2,
            },
        ],
    });
});

test("properly escapes the ampersand character", async () => {
    const tokenizer = await CohereEmbedEnglishV3LanguageTokenizer.get();
    const getAccountIfExists = () => null;
    const getSearchEntityIfExists = () => null;

    expect(
        testGetFullSearchContentChunk(
            schema.node("doc", {}, [
                schema.node("paragraph", {}, [
                    schema.text("a & b &amp; c &#38; d &#x0026; e"),
                    schema.text(" "),
                    schema.text("a & b &amp; c &#38; d &#x0026; e", [schema.mark("code")]),
                ]),
            ]),
            {tokenizer, getAccountIfExists, getSearchEntityIfExists},
        ),
    ).toEqual({
        text: "a & b \\&amp; c \\&#38; d \\&#x0026; e `a & b &amp; c &#38; d &#x0026; e`",
        isGroup: false,
        tokenCount: 43,
        context: {sectionHeading: null},
        sentenceChunks: [
            {
                text: "a & b \\&amp; c \\&#38; d \\&#x0026; e `a & b &amp; c &#38; d &#x0026; e`",
                tokenCount: 43,
            },
        ],
        lineMarginTop: 2,
        lineMarginBottom: 2,
    });
});

test("properly escapes content in inline code", async () => {
    const tokenizer = await CohereEmbedEnglishV3LanguageTokenizer.get();
    const getAccountIfExists = () => null;
    const getSearchEntityIfExists = () => null;

    expect(
        testGetFullSearchContentChunk(
            schema.node("doc", {}, [
                schema.node("paragraph", {}, [
                    schema.text("content_view.tsx", [schema.mark("code")]),
                    schema.text(" is the main entrypoint into the view-only code. It calls into "),
                    schema.text("renderContentFragmentToHtmlStore()", [schema.mark("code")]),
                    schema.text(" (in the file "),
                    schema.text("render_content_to_html.ts", [schema.mark("code")]),
                    schema.text(") which is actually generating the view-only HTML."),
                ]),
            ]),
            {tokenizer, getAccountIfExists, getSearchEntityIfExists},
        ),
    ).toEqual({
        text: "`content_view.tsx` is the main entrypoint into the view-only code. It calls into `renderContentFragmentToHtmlStore()` (in the file `render_content_to_html.ts`) which is actually generating the view-only HTML.",
        isGroup: false,
        tokenCount: 64,
        context: {sectionHeading: null},
        sentenceChunks: [
            {
                text: "`content_view.tsx` is the main entrypoint into the view-only code.",
                tokenCount: 20,
            },
            {
                text: "It calls into `renderContentFragmentToHtmlStore()` (in the file `render_content_to_html.ts`) which is actually generating the view-only HTML.",
                tokenCount: 44,
            },
        ],
        lineMarginTop: 2,
        lineMarginBottom: 2,
    });

    expect(
        testGetFullSearchContentChunk(
            schema.node("doc", {}, [
                schema.node("paragraph", {}, [
                    schema.text("_", [schema.mark("code")]),
                    schema.text(" "),
                    schema.text("*", [schema.mark("code")]),
                    schema.text(" "),
                    schema.text("`", [schema.mark("code")]),
                    schema.text(" "),
                    schema.text("``", [schema.mark("code")]),
                    schema.text(" "),
                    schema.text("```", [schema.mark("code")]),
                    schema.text(" "),
                    schema.text("\\", [schema.mark("code")]),
                    schema.text(" "),
                    schema.text("foo_bar", [schema.mark("code")]),
                    schema.text(" "),
                    schema.text("foo*bar", [schema.mark("code")]),
                    schema.text(" "),
                    schema.text("foo`bar", [schema.mark("code")]),
                    schema.text(" "),
                    schema.text("foo``bar", [schema.mark("code")]),
                    schema.text(" "),
                    schema.text("foo```bar", [schema.mark("code")]),
                    schema.text(" "),
                    schema.text("fo`o```b`ar", [schema.mark("code")]),
                    schema.text(" "),
                    schema.text("foo\\bar", [schema.mark("code")]),
                    schema.text(" "),
                    schema.text("[]()", [schema.mark("code")]),
                    schema.text(" "),
                    schema.text("[foo](bar)", [schema.mark("code")]),
                    schema.text(" "),
                    schema.text("foo[]()bar", [schema.mark("code")]),
                    schema.text(" "),
                    schema.text("foo[foo](bar)bar", [schema.mark("code")]),
                    schema.text(" "),
                    schema.text("<em>content</em>", [schema.mark("code")]),
                    schema.text(" "),
                    schema.text("<em>content</em>_view.tsx", [schema.mark("code")]),
                    schema.text(" "),
                    schema.text("<strong>content</strong>", [schema.mark("code")]),
                    schema.text(" "),
                    schema.text("<strong>content</strong>_view.tsx", [schema.mark("code")]),
                    schema.text(" "),
                    schema.text(" ", [schema.mark("code")]),
                    schema.text(" "),
                    schema.text(" starts with space", [schema.mark("code")]),
                    schema.text(" "),
                    schema.text("ends with space ", [schema.mark("code")]),
                    schema.text(" "),
                    schema.text("   starts with 3 spaces", [schema.mark("code")]),
                    schema.text(" "),
                    schema.text("ends with 3 spaces   ", [schema.mark("code")]),
                    schema.text(" "),
                    schema.text(" `starts with space`", [schema.mark("code")]),
                    schema.text(" "),
                    schema.text("`ends with space` ", [schema.mark("code")]),
                    schema.text(" "),
                    schema.text("   `starts with 3 spaces`", [schema.mark("code")]),
                    schema.text(" "),
                    schema.text("`ends with 3 spaces`   ", [schema.mark("code")]),
                ]),
            ]),
            {tokenizer, getAccountIfExists, getSearchEntityIfExists},
        ),
    ).toEqual({
        text: "`_` `*` `` ` `` ``` `` ``` ```` ``` ```` `\\` `foo_bar` `foo*bar` ``foo`bar`` ```foo``bar``` ````foo```bar```` ````fo`o```b`ar```` `foo\\bar` `[]()` `[foo](bar)` `foo[]()bar` `foo[foo](bar)bar` `\\<em>content\\</em>` `\\<em>content\\</em>_view.tsx` `<strong>content</strong>` `<strong>content</strong>_view.tsx` ` ` ` starts with space` `ends with space ` `   starts with 3 spaces` `ends with 3 spaces   ` ``  `starts with space` `` `` `ends with space`  `` ``    `starts with 3 spaces` `` `` `ends with 3 spaces`    ``",
        isGroup: false,
        tokenCount: 244,
        context: {sectionHeading: null},
        sentenceChunks: [
            {
                text: "`_` `*` `` ` `` ``` `` ``` ```` ``` ```` `\\` `foo_bar` `foo*bar` ``foo`bar`` ```foo``bar``` ````foo```bar```` ````fo`o```b`ar```` `foo\\bar` `[]()` `[foo](bar)` `foo[]()bar` `foo[foo](bar)bar` `\\<em>content\\</em>` `\\<em>content\\</em>_view.tsx` `<strong>content</strong>` `<strong>content</strong>_view.tsx` ` ` ` starts with space` `ends with space ` `   starts with 3 spaces` `ends with 3 spaces   ` ``  `starts with space` `` `` `ends with space`  `` ``    `starts with 3 spaces` `` `` `ends with 3 spaces`    ``",
                tokenCount: 244,
            },
        ],
        lineMarginTop: 2,
        lineMarginBottom: 2,
    });
});

test("ignores files in file rows", async () => {
    const tokenizer = await CohereEmbedEnglishV3LanguageTokenizer.get();
    const getAccountIfExists = () => null;
    const getSearchEntityIfExists = () => null;

    expect(
        testGetFullSearchContentChunk(
            schema.node("doc", {}, [
                schema.node("paragraph", {}, [schema.text("The quick brown")]),
                schema.node("fileRow", {}, [
                    schema.node("file", {fileId: generateChronologicalId<FileId>()}),
                ]),
                schema.node("paragraph", {}, [schema.text("fox jumps")]),
                schema.node("fileRow", {}, [
                    schema.node("file", {fileId: generateChronologicalId<FileId>()}),
                    schema.node("file", {fileId: generateChronologicalId<FileId>()}),
                    schema.node("file", {fileId: generateChronologicalId<FileId>()}),
                ]),
                schema.node("paragraph", {}, [schema.text("over the")]),
                schema.node("fileRow", {}, [schema.node("file", {fileId: null})]),
                schema.node("paragraph", {}, [schema.text("lazy dog")]),
                schema.node("fileRow", {}, [
                    schema.node("file", {fileId: generateChronologicalId<FileId>()}),
                    schema.node("file", {fileId: null}),
                ]),
            ]),
            {tokenizer, getAccountIfExists, getSearchEntityIfExists},
        ),
    ).toEqual({
        text: `\
The quick brown

fox jumps

over the

lazy dog`,
        isGroup: true,
        context: {sectionHeading: null},
        tokenCount: 9,
        childChunks: [
            {
                isGroup: false,
                tokenCount: 3,
                context: {sectionHeading: null},
                sentenceChunks: [{text: "The quick brown", tokenCount: 3}],
                lineMarginTop: 2,
                lineMarginBottom: 2,
            },
            {
                isGroup: false,
                tokenCount: 2,
                context: {sectionHeading: null},
                sentenceChunks: [{text: "fox jumps", tokenCount: 2}],
                lineMarginTop: 2,
                lineMarginBottom: 2,
            },
            {
                isGroup: false,
                tokenCount: 2,
                context: {sectionHeading: null},
                sentenceChunks: [{text: "over the", tokenCount: 2}],
                lineMarginTop: 2,
                lineMarginBottom: 2,
            },
            {
                isGroup: false,
                tokenCount: 2,
                context: {sectionHeading: null},
                sentenceChunks: [{text: "lazy dog", tokenCount: 2}],
                lineMarginTop: 2,
                lineMarginBottom: 2,
            },
        ],
    });
});

test("ignores files in file floats", async () => {
    const tokenizer = await CohereEmbedEnglishV3LanguageTokenizer.get();
    const getAccountIfExists = () => null;
    const getSearchEntityIfExists = () => null;

    expect(
        testGetFullSearchContentChunk(
            schema.node("doc", {}, [
                schema.node("paragraph", {}, [schema.text("The quick brown")]),
                schema.node("fileFloat", {direction: "right"}, [
                    schema.node("file", {fileId: generateChronologicalId<FileId>()}),
                ]),
                schema.node("paragraph", {}, [schema.text("fox jumps")]),
                schema.node("fileFloat", {direction: "left"}, [
                    schema.node("file", {fileId: generateChronologicalId<FileId>()}),
                ]),
                schema.node("fileFloat", {direction: "left"}, [
                    schema.node("file", {fileId: generateChronologicalId<FileId>()}),
                ]),
                schema.node("paragraph", {}, [schema.text("over the")]),
                schema.node("fileFloat", {direction: "right"}, [
                    schema.node("file", {fileId: null}),
                ]),
                schema.node("paragraph", {}, [schema.text("lazy dog")]),
                schema.node("fileFloat", {direction: "right"}, [
                    schema.node("file", {fileId: generateChronologicalId<FileId>()}),
                ]),
            ]),
            {tokenizer, getAccountIfExists, getSearchEntityIfExists},
        ),
    ).toEqual({
        text: `\
The quick brown

fox jumps

over the

lazy dog`,
        isGroup: true,
        context: {sectionHeading: null},
        tokenCount: 9,
        childChunks: [
            {
                isGroup: false,
                tokenCount: 3,
                context: {sectionHeading: null},
                sentenceChunks: [{text: "The quick brown", tokenCount: 3}],
                lineMarginTop: 2,
                lineMarginBottom: 2,
            },
            {
                isGroup: false,
                tokenCount: 2,
                context: {sectionHeading: null},
                sentenceChunks: [{text: "fox jumps", tokenCount: 2}],
                lineMarginTop: 2,
                lineMarginBottom: 2,
            },
            {
                isGroup: false,
                tokenCount: 2,
                context: {sectionHeading: null},
                sentenceChunks: [{text: "over the", tokenCount: 2}],
                lineMarginTop: 2,
                lineMarginBottom: 2,
            },
            {
                isGroup: false,
                tokenCount: 2,
                context: {sectionHeading: null},
                sentenceChunks: [{text: "lazy dog", tokenCount: 2}],
                lineMarginTop: 2,
                lineMarginBottom: 2,
            },
        ],
    });
});

test("chunks doc that is only files", async () => {
    const tokenizer = await CohereEmbedEnglishV3LanguageTokenizer.get();
    const getAccountIfExists = () => null;
    const getSearchEntityIfExists = () => null;

    expect(
        testGetFullSearchContentChunk(schema.node("doc", {}, [schema.node("paragraph", {}, [])]), {
            tokenizer,
            getAccountIfExists,
            getSearchEntityIfExists,
        }),
    ).toEqual({
        text: "",
        isGroup: false,
        tokenCount: 0,
        context: {sectionHeading: null},
        sentenceChunks: [],
        lineMarginTop: 2,
        lineMarginBottom: 2,
    });

    expect(
        testGetFullSearchContentChunk(
            schema.node("doc", {}, [
                schema.node("fileRow", {}, [
                    schema.node("file", {fileId: generateChronologicalId<FileId>()}),
                    schema.node("file", {fileId: generateChronologicalId<FileId>()}),
                ]),
                schema.node("fileRow", {}, [
                    schema.node("file", {fileId: generateChronologicalId<FileId>()}),
                    schema.node("file", {fileId: generateChronologicalId<FileId>()}),
                    schema.node("file", {fileId: generateChronologicalId<FileId>()}),
                ]),
            ]),
            {tokenizer, getAccountIfExists, getSearchEntityIfExists},
        ),
    ).toEqual({
        text: "",
        isGroup: false,
        tokenCount: 0,
        context: {sectionHeading: null},
        sentenceChunks: [],
        lineMarginTop: 0,
        lineMarginBottom: 0,
    });
});

test("ignores files in file rows when file row is in quote block or list item", async () => {
    const tokenizer = await CohereEmbedEnglishV3LanguageTokenizer.get();
    const getAccountIfExists = () => null;
    const getSearchEntityIfExists = () => null;

    expect(
        testGetFullSearchContentChunk(
            schema.node("doc", {}, [
                schema.node("paragraph", {}, [schema.text("The quick brown fox jumps")]),
                // NOTE(calebmer, 2024-09-23): Currently we don't allow file rows in quote
                // blocks in our content schema, but we still want to exercise the code for
                // this case since we may support this format someday.
                schema.nodes.quoteBlock.create({}, [
                    schema.node("fileRow", {}, [
                        schema.node("file", {fileId: generateChronologicalId<FileId>()}),
                        schema.node("file", {fileId: generateChronologicalId<FileId>()}),
                        schema.node("file", {fileId: generateChronologicalId<FileId>()}),
                    ]),
                ]),
                schema.node("paragraph", {}, [schema.text("over the")]),
                // NOTE(calebmer, 2024-09-23): Currently we don't allow file rows in list
                // items in our content schema, but we still want to exercise the code for
                // this case since we may support this format someday.
                schema.nodes.orderedListItem.create({}, [
                    schema.node("paragraph", {}, [schema.text("hi")]),
                    schema.node("fileRow", {}, [
                        schema.node("file", {fileId: generateChronologicalId<FileId>()}),
                        schema.node("file", {fileId: generateChronologicalId<FileId>()}),
                        schema.node("file", {fileId: generateChronologicalId<FileId>()}),
                    ]),
                ]),
                schema.node("paragraph", {}, [schema.text("lazy dog")]),
            ]),
            {tokenizer, getAccountIfExists, getSearchEntityIfExists},
        ),
    ).toEqual({
        text: `\
The quick brown fox jumps

>

over the

1. hi

lazy dog`,
        isGroup: true,
        context: {sectionHeading: null},
        tokenCount: 13,
        childChunks: [
            {
                isGroup: false,
                tokenCount: 5,
                context: {sectionHeading: null},
                sentenceChunks: [{text: "The quick brown fox jumps", tokenCount: 5}],
                lineMarginTop: 2,
                lineMarginBottom: 2,
            },
            {
                isGroup: false,
                tokenCount: 1,
                context: {sectionHeading: null},
                sentenceChunks: [{text: ">", tokenCount: 1}],
                lineMarginTop: 2,
                lineMarginBottom: 2,
            },
            {
                isGroup: false,
                tokenCount: 2,
                context: {sectionHeading: null},
                sentenceChunks: [{text: "over the", tokenCount: 2}],
                lineMarginTop: 2,
                lineMarginBottom: 2,
            },
            {
                isGroup: false,
                tokenCount: 3,
                context: {sectionHeading: null},
                sentenceChunks: [{text: "1. hi", tokenCount: 3}],
                lineMarginTop: 1,
                lineMarginBottom: 1,
            },
            {
                isGroup: false,
                tokenCount: 2,
                context: {sectionHeading: null},
                sentenceChunks: [{text: "lazy dog", tokenCount: 2}],
                lineMarginTop: 2,
                lineMarginBottom: 2,
            },
        ],
    });
});

test("drops inline formatting within a code block", async () => {
    const tokenizer = await CohereEmbedEnglishV3LanguageTokenizer.get();
    const getAccountIfExists = () => null;
    const getSearchEntityIfExists = () => null;

    expect(
        testGetFullSearchContentChunk(
            schema.nodeFromJSON({
                type: "doc",
                content: [
                    {
                        type: "codeBlock",
                        attrs: {language: "javascript"},
                        content: [
                            {
                                type: "codeBlockLine",
                                content: [
                                    {type: "text", text: "1. "},
                                    {
                                        type: "text",
                                        text: "bold",
                                        marks: [{type: "bold"}],
                                    },
                                ],
                            },
                            {
                                type: "codeBlockLine",
                                content: [
                                    {type: "text", text: "2. "},
                                    {
                                        type: "text",
                                        text: "italic",
                                        marks: [{type: "italic"}],
                                    },
                                ],
                            },
                            {
                                type: "codeBlockLine",
                                content: [
                                    {type: "text", text: "3. "},
                                    {
                                        type: "text",
                                        text: "italic & bold",
                                        marks: [{type: "italic"}, {type: "bold"}],
                                    },
                                ],
                            },
                            {
                                type: "codeBlockLine",
                                content: [
                                    {type: "text", text: "4. "},
                                    {
                                        type: "text",
                                        text: "strike",
                                        marks: [{type: "strike"}],
                                    },
                                ],
                            },
                            {
                                type: "codeBlockLine",
                                content: [
                                    {type: "text", text: "5. "},
                                    {
                                        type: "text",
                                        text: "comment",
                                        marks: [{type: "comment", commentThreadId: generateId()}],
                                    },
                                ],
                            },
                            {
                                type: "codeBlockLine",
                                content: [
                                    {type: "text", text: "6. "},
                                    {
                                        type: "text",
                                        text: "link",
                                        marks: [{type: "link", url: "https://example.com"}],
                                    },
                                ],
                            },
                        ],
                    },
                ],
            }),
            {tokenizer, getAccountIfExists, getSearchEntityIfExists},
        ),
    ).toEqual({
        text: `\
\`\`\`javascript
1. bold
2. italic
3. italic & bold
4. strike
5. comment
6. link
\`\`\``,
        isGroup: false,
        tokenCount: 30,
        context: {sectionHeading: null},
        sentenceChunks: [
            {text: "```javascript\n", tokenCount: 5},
            {text: "1. bold\n", tokenCount: 3},
            {text: "2. italic\n", tokenCount: 4},
            {text: "3. italic & bold\n", tokenCount: 6},
            {text: "4. strike\n", tokenCount: 3},
            {text: "5. comment\n", tokenCount: 3},
            {text: "6. link\n", tokenCount: 3},
            {text: "```", tokenCount: 3},
        ],
        lineMarginTop: 2,
        lineMarginBottom: 2,
    });

    expect(
        testGetFullSearchContentChunk(
            schema.nodeFromJSON({
                type: "doc",
                content: [
                    {
                        type: "paragraph",
                        content: [
                            {type: "text", text: "I added the ability to pass in paths to "},
                            {type: "text", marks: [{type: "code"}], text: "dev test"},
                            {type: "text", text: ". For example:"},
                        ],
                    },
                    {
                        type: "codeBlock",
                        attrs: {language: "shell"},
                        content: [
                            {
                                type: "codeBlockLine",
                                content: [
                                    {type: "text", text: "dev test "},
                                    {
                                        type: "text",
                                        marks: [{type: "bold"}],
                                        text: "server/documents/data/documents_table.test.ts",
                                    },
                                ],
                            },
                        ],
                    },
                    {
                        type: "paragraph",
                        content: [
                            {
                                type: "text",
                                text: "This means you won’t have to manually rewrite a test file path into a Bazel label! By passing in a file path, we’ll automatically figure out that the test label for ",
                            },
                            {
                                type: "text",
                                marks: [{type: "code"}],
                                text: "server/documents/data/documents_table.test.ts",
                            },
                            {type: "text", text: " is "},
                            {
                                type: "text",
                                marks: [{type: "code"}],
                                text: "//server/documents/data:documents_table_test",
                            },
                            {type: "text", text: " then we’ll run that test."},
                        ],
                    },
                ],
            }),
            {tokenizer, getAccountIfExists, getSearchEntityIfExists},
        ),
    ).toEqual({
        text: `\
I added the ability to pass in paths to \`dev test\`. For example:

\`\`\`shell
dev test server/documents/data/documents_table.test.ts
\`\`\`

This means you won’t have to manually rewrite a test file path into a Bazel label! By passing in a file path, we’ll automatically figure out that the test label for \`server/documents/data/documents_table.test.ts\` is \`//server/documents/data:documents_table_test\` then we’ll run that test.`,
        isGroup: true,
        context: {sectionHeading: null},
        tokenCount: 117,
        childChunks: [
            {
                isGroup: true,
                context: {sectionHeading: null},
                tokenCount: 39,
                childChunks: [
                    {
                        isGroup: false,
                        tokenCount: 17,
                        context: {sectionHeading: null},
                        sentenceChunks: [
                            {
                                text: "I added the ability to pass in paths to `dev test`.",
                                tokenCount: 14,
                            },
                            {text: "For example:", tokenCount: 3},
                        ],
                        lineMarginTop: 2,
                        lineMarginBottom: 2,
                    },
                    {
                        isGroup: false,
                        tokenCount: 22,
                        context: {sectionHeading: null},
                        sentenceChunks: [
                            {text: "```shell\n", tokenCount: 4},
                            {
                                text: "dev test server/documents/data/documents_table.test.ts\n",
                                tokenCount: 15,
                            },
                            {text: "```", tokenCount: 3},
                        ],
                        lineMarginTop: 2,
                        lineMarginBottom: 2,
                    },
                ],
            },
            {
                isGroup: false,
                tokenCount: 78,
                context: {sectionHeading: null},
                sentenceChunks: [
                    {
                        text: "This means you won’t have to manually rewrite a test file path into a Bazel label!",
                        tokenCount: 21,
                    },
                    {
                        text: "By passing in a file path, we’ll automatically figure out that the test label for `server/documents/data/documents_table.test.ts` is `//server/documents/data:documents_table_test` then we’ll run that test.",
                        tokenCount: 57,
                    },
                ],
                lineMarginTop: 2,
                lineMarginBottom: 2,
            },
        ],
    });
});

test("properly escapes text within inline code block", async () => {
    const tokenizer = await CohereEmbedEnglishV3LanguageTokenizer.get();
    const getAccountIfExists = () => null;
    const getSearchEntityIfExists = () => null;

    expect(
        testGetFullSearchContentChunk(
            schema.nodeFromJSON({
                type: "doc",
                content: [
                    {
                        type: "codeBlock",
                        attrs: {language: "javascript"},
                        content: [
                            {
                                type: "codeBlockLine",
                                content: [{type: "text", text: "test1 _test2_ test3"}],
                            },
                            {
                                type: "codeBlockLine",
                                content: [{type: "text", text: "test4 **test5** test6"}],
                            },
                            {
                                type: "codeBlockLine",
                                content: [{type: "text", text: "test7 <em>test8</em> test9"}],
                            },
                            {
                                type: "codeBlockLine",
                                content: [{type: "text", text: "test10 <em>test11 test12"}],
                            },
                            {
                                type: "codeBlockLine",
                                content: [{type: "text", text: "test13 test14</em> test15"}],
                            },
                        ],
                    },
                ],
            }),
            {tokenizer, getAccountIfExists, getSearchEntityIfExists},
        ),
    ).toEqual({
        text: `\
\`\`\`javascript
test1 _test2_ test3
test4 **test5** test6
test7 \\<em>test8\\</em> test9
test10 \\<em>test11 test12
test13 test14\\</em> test15
\`\`\``,
        isGroup: false,
        tokenCount: 62,
        context: {sectionHeading: null},
        sentenceChunks: [
            {text: "```javascript\n", tokenCount: 5},
            {text: "test1 _test2_ test3\n", tokenCount: 8},
            {text: "test4 **test5** test6\n", tokenCount: 10},
            {text: "test7 \\<em>test8\\</em> test9\n", tokenCount: 15},
            {text: "test10 \\<em>test11 test12\n", tokenCount: 10},
            {text: "test13 test14\\</em> test15\n", tokenCount: 11},
            {text: "```", tokenCount: 3},
        ],
        lineMarginTop: 2,
        lineMarginBottom: 2,
    });
});

test("can chunk a simple table", async () => {
    const tokenizer = await CohereEmbedEnglishV3LanguageTokenizer.get();
    const getAccountIfExists = () => null;
    const getSearchEntityIfExists = () => null;

    expect(
        testGetFullSearchContentChunk(
            schema.node("doc", {}, [
                schema.node("paragraph", {}, [schema.text("foo")]),
                schema.node("table", {}, [
                    schema.node("tableRow", {}, [
                        schema.node("tableCell", {}, [
                            schema.node("paragraph", {}, [schema.text("a1")]),
                        ]),
                        schema.node("tableCell", {}, [
                            schema.node("paragraph", {}, [schema.text("b1")]),
                        ]),
                        schema.node("tableCell", {}, [
                            schema.node("paragraph", {}, [schema.text("c1")]),
                        ]),
                    ]),
                    schema.node("tableRow", {}, [
                        schema.node("tableCell", {}, [
                            schema.node("paragraph", {}, [schema.text("a2")]),
                        ]),
                        schema.node("tableCell", {}, [
                            schema.node("paragraph", {}, [schema.text("b2")]),
                        ]),
                        schema.node("tableCell", {}, [
                            schema.node("paragraph", {}, [schema.text("c2")]),
                        ]),
                    ]),
                    schema.node("tableRow", {}, [
                        schema.node("tableCell", {}, [
                            schema.node("paragraph", {}, [schema.text("a3")]),
                        ]),
                        schema.node("tableCell", {}, [
                            schema.node("paragraph", {}, [schema.text("b3")]),
                        ]),
                        schema.node("tableCell", {}, [
                            schema.node("paragraph", {}, [schema.text("c3")]),
                        ]),
                    ]),
                ]),
                schema.node("paragraph", {}, [schema.text("bar")]),
            ]),
            {tokenizer, getAccountIfExists, getSearchEntityIfExists},
        ),
    ).toEqual({
        text: `\
foo

<table><tbody><tr><td>

a1

</td><td>

b1

</td><td>

c1

</td></tr><tr><td>

a2

</td><td>

b2

</td><td>

c2

</td></tr><tr><td>

a3

</td><td>

b3

</td><td>

c3

</td></tr></tbody></table>

bar`,
        isGroup: true,
        tokenCount: 117,
        context: {sectionHeading: null},
        childChunks: [
            {
                isGroup: false,
                tokenCount: 1,
                context: {sectionHeading: null},
                sentenceChunks: [{text: "foo", tokenCount: 1}],
                lineMarginTop: 2,
                lineMarginBottom: 2,
            },
            {
                isGroup: true,
                tokenCount: 115,
                context: {sectionHeading: null},
                childChunks: [
                    {
                        isGroup: false,
                        tokenCount: 8,
                        context: {sectionHeading: null},
                        sentenceChunks: [{text: "<table><tbody>", tokenCount: 8}],
                        lineMarginTop: 2,
                        lineMarginBottom: 0,
                    },
                    {
                        isGroup: true,
                        tokenCount: 31,
                        context: {sectionHeading: null},
                        childChunks: [
                            {
                                isGroup: false,
                                tokenCount: 3,
                                context: {sectionHeading: null},
                                sentenceChunks: [{text: "<tr>", tokenCount: 3}],
                                lineMarginTop: 0,
                                lineMarginBottom: 0,
                            },
                            {
                                isGroup: false,
                                tokenCount: 8,
                                context: {sectionHeading: null},
                                sentenceChunks: [
                                    {text: "<td>", tokenCount: 3},
                                    {text: "\n\na1", tokenCount: 1},
                                    {text: "\n\n</td>", tokenCount: 4},
                                ],
                                lineMarginTop: 0,
                                lineMarginBottom: 0,
                            },
                            {
                                isGroup: false,
                                tokenCount: 8,
                                context: {sectionHeading: null},
                                sentenceChunks: [
                                    {text: "<td>", tokenCount: 3},
                                    {text: "\n\nb1", tokenCount: 1},
                                    {text: "\n\n</td>", tokenCount: 4},
                                ],
                                lineMarginTop: 0,
                                lineMarginBottom: 0,
                            },
                            {
                                isGroup: false,
                                tokenCount: 8,
                                context: {sectionHeading: null},
                                sentenceChunks: [
                                    {text: "<td>", tokenCount: 3},
                                    {text: "\n\nc1", tokenCount: 1},
                                    {text: "\n\n</td>", tokenCount: 4},
                                ],
                                lineMarginTop: 0,
                                lineMarginBottom: 0,
                            },
                            {
                                isGroup: false,
                                tokenCount: 4,
                                context: {sectionHeading: null},
                                sentenceChunks: [{text: "</tr>", tokenCount: 4}],
                                lineMarginTop: 0,
                                lineMarginBottom: 0,
                            },
                        ],
                    },
                    {
                        isGroup: true,
                        tokenCount: 32,
                        context: {sectionHeading: null},
                        childChunks: [
                            {
                                isGroup: false,
                                tokenCount: 3,
                                context: {sectionHeading: null},
                                sentenceChunks: [{text: "<tr>", tokenCount: 3}],
                                lineMarginTop: 0,
                                lineMarginBottom: 0,
                            },
                            {
                                isGroup: false,
                                tokenCount: 8,
                                context: {sectionHeading: null},
                                sentenceChunks: [
                                    {text: "<td>", tokenCount: 3},
                                    {text: "\n\na2", tokenCount: 1},
                                    {text: "\n\n</td>", tokenCount: 4},
                                ],
                                lineMarginTop: 0,
                                lineMarginBottom: 0,
                            },
                            {
                                isGroup: false,
                                tokenCount: 9,
                                context: {sectionHeading: null},
                                sentenceChunks: [
                                    {text: "<td>", tokenCount: 3},
                                    {text: "\n\nb2", tokenCount: 2},
                                    {text: "\n\n</td>", tokenCount: 4},
                                ],
                                lineMarginTop: 0,
                                lineMarginBottom: 0,
                            },
                            {
                                isGroup: false,
                                tokenCount: 8,
                                context: {sectionHeading: null},
                                sentenceChunks: [
                                    {text: "<td>", tokenCount: 3},
                                    {text: "\n\nc2", tokenCount: 1},
                                    {text: "\n\n</td>", tokenCount: 4},
                                ],
                                lineMarginTop: 0,
                                lineMarginBottom: 0,
                            },
                            {
                                isGroup: false,
                                tokenCount: 4,
                                context: {sectionHeading: null},
                                sentenceChunks: [{text: "</tr>", tokenCount: 4}],
                                lineMarginTop: 0,
                                lineMarginBottom: 0,
                            },
                        ],
                    },
                    {
                        isGroup: true,
                        tokenCount: 34,
                        context: {sectionHeading: null},
                        childChunks: [
                            {
                                isGroup: false,
                                tokenCount: 3,
                                context: {sectionHeading: null},
                                sentenceChunks: [{text: "<tr>", tokenCount: 3}],
                                lineMarginTop: 0,
                                lineMarginBottom: 0,
                            },
                            {
                                isGroup: false,
                                tokenCount: 9,
                                context: {sectionHeading: null},
                                sentenceChunks: [
                                    {text: "<td>", tokenCount: 3},
                                    {text: "\n\na3", tokenCount: 2},
                                    {text: "\n\n</td>", tokenCount: 4},
                                ],
                                lineMarginTop: 0,
                                lineMarginBottom: 0,
                            },
                            {
                                isGroup: false,
                                tokenCount: 9,
                                context: {sectionHeading: null},
                                sentenceChunks: [
                                    {text: "<td>", tokenCount: 3},
                                    {text: "\n\nb3", tokenCount: 2},
                                    {text: "\n\n</td>", tokenCount: 4},
                                ],
                                lineMarginTop: 0,
                                lineMarginBottom: 0,
                            },
                            {
                                isGroup: false,
                                tokenCount: 9,
                                context: {sectionHeading: null},
                                sentenceChunks: [
                                    {text: "<td>", tokenCount: 3},
                                    {text: "\n\nc3", tokenCount: 2},
                                    {text: "\n\n</td>", tokenCount: 4},
                                ],
                                lineMarginTop: 0,
                                lineMarginBottom: 0,
                            },
                            {
                                isGroup: false,
                                tokenCount: 4,
                                context: {sectionHeading: null},
                                sentenceChunks: [{text: "</tr>", tokenCount: 4}],
                                lineMarginTop: 0,
                                lineMarginBottom: 0,
                            },
                        ],
                    },
                    {
                        isGroup: false,
                        tokenCount: 10,
                        context: {sectionHeading: null},
                        sentenceChunks: [{text: "</tbody></table>", tokenCount: 10}],
                        lineMarginTop: 0,
                        lineMarginBottom: 2,
                    },
                ],
            },
            {
                isGroup: false,
                tokenCount: 1,
                context: {sectionHeading: null},
                sentenceChunks: [{text: "bar", tokenCount: 1}],
                lineMarginTop: 2,
                lineMarginBottom: 2,
            },
        ],
    });
});

test("can chunk a simple table with an empty cell", async () => {
    const tokenizer = await CohereEmbedEnglishV3LanguageTokenizer.get();
    const getAccountIfExists = () => null;
    const getSearchEntityIfExists = () => null;

    expect(
        testGetFullSearchContentChunk(
            schema.node("doc", {}, [
                schema.node("paragraph", {}, [schema.text("foo")]),
                schema.node("table", {}, [
                    schema.node("tableRow", {}, [
                        schema.node("tableCell", {}, [
                            schema.node("paragraph", {}, [schema.text("a1")]),
                        ]),
                        schema.node("tableCell", {}, [
                            schema.node("paragraph", {}, [schema.text("b1")]),
                        ]),
                        schema.node("tableCell", {}, [
                            schema.node("paragraph", {}, [schema.text("c1")]),
                        ]),
                    ]),
                    schema.node("tableRow", {}, [
                        schema.node("tableCell", {}, [
                            schema.node("paragraph", {}, [schema.text("a2")]),
                        ]),
                        schema.node("tableCell", {}, [
                            schema.node("paragraph", {}, [schema.text("b2")]),
                        ]),
                        schema.node("tableCell", {}, [schema.node("paragraph", {}, [])]),
                    ]),
                    schema.node("tableRow", {}, [
                        schema.node("tableCell", {}, [
                            schema.node("paragraph", {}, [schema.text("a3")]),
                        ]),
                        schema.node("tableCell", {}, [
                            schema.node("paragraph", {}, [schema.text("b3")]),
                        ]),
                        schema.node("tableCell", {}, [
                            schema.node("paragraph", {}, [schema.text("c3")]),
                        ]),
                    ]),
                ]),
                schema.node("paragraph", {}, [schema.text("bar")]),
            ]),
            {tokenizer, getAccountIfExists, getSearchEntityIfExists},
        ),
    ).toEqual({
        text: `\
foo

<table><tbody><tr><td>

a1

</td><td>

b1

</td><td>

c1

</td></tr><tr><td>

a2

</td><td>

b2

</td><td>



</td></tr><tr><td>

a3

</td><td>

b3

</td><td>

c3

</td></tr></tbody></table>

bar`,
        isGroup: true,
        tokenCount: 116,
        context: {sectionHeading: null},
        childChunks: [
            {
                isGroup: false,
                tokenCount: 1,
                context: {sectionHeading: null},
                sentenceChunks: [{text: "foo", tokenCount: 1}],
                lineMarginTop: 2,
                lineMarginBottom: 2,
            },
            {
                isGroup: true,
                tokenCount: 114,
                context: {sectionHeading: null},
                childChunks: [
                    {
                        isGroup: false,
                        tokenCount: 8,
                        context: {sectionHeading: null},
                        sentenceChunks: [{text: "<table><tbody>", tokenCount: 8}],
                        lineMarginTop: 2,
                        lineMarginBottom: 0,
                    },
                    {
                        isGroup: true,
                        tokenCount: 31,
                        context: {sectionHeading: null},
                        childChunks: [
                            {
                                isGroup: false,
                                tokenCount: 3,
                                context: {sectionHeading: null},
                                sentenceChunks: [{text: "<tr>", tokenCount: 3}],
                                lineMarginTop: 0,
                                lineMarginBottom: 0,
                            },
                            {
                                isGroup: false,
                                tokenCount: 8,
                                context: {sectionHeading: null},
                                sentenceChunks: [
                                    {text: "<td>", tokenCount: 3},
                                    {text: "\n\na1", tokenCount: 1},
                                    {text: "\n\n</td>", tokenCount: 4},
                                ],
                                lineMarginTop: 0,
                                lineMarginBottom: 0,
                            },
                            {
                                isGroup: false,
                                tokenCount: 8,
                                context: {sectionHeading: null},
                                sentenceChunks: [
                                    {text: "<td>", tokenCount: 3},
                                    {text: "\n\nb1", tokenCount: 1},
                                    {text: "\n\n</td>", tokenCount: 4},
                                ],
                                lineMarginTop: 0,
                                lineMarginBottom: 0,
                            },
                            {
                                isGroup: false,
                                tokenCount: 8,
                                context: {sectionHeading: null},
                                sentenceChunks: [
                                    {text: "<td>", tokenCount: 3},
                                    {text: "\n\nc1", tokenCount: 1},
                                    {text: "\n\n</td>", tokenCount: 4},
                                ],
                                lineMarginTop: 0,
                                lineMarginBottom: 0,
                            },
                            {
                                isGroup: false,
                                tokenCount: 4,
                                context: {sectionHeading: null},
                                sentenceChunks: [{text: "</tr>", tokenCount: 4}],
                                lineMarginTop: 0,
                                lineMarginBottom: 0,
                            },
                        ],
                    },
                    {
                        isGroup: true,
                        tokenCount: 31,
                        context: {sectionHeading: null},
                        childChunks: [
                            {
                                isGroup: false,
                                tokenCount: 3,
                                context: {sectionHeading: null},
                                sentenceChunks: [{text: "<tr>", tokenCount: 3}],
                                lineMarginTop: 0,
                                lineMarginBottom: 0,
                            },
                            {
                                isGroup: false,
                                tokenCount: 8,
                                context: {sectionHeading: null},
                                sentenceChunks: [
                                    {text: "<td>", tokenCount: 3},
                                    {text: "\n\na2", tokenCount: 1},
                                    {text: "\n\n</td>", tokenCount: 4},
                                ],
                                lineMarginTop: 0,
                                lineMarginBottom: 0,
                            },
                            {
                                isGroup: false,
                                tokenCount: 9,
                                context: {sectionHeading: null},
                                sentenceChunks: [
                                    {text: "<td>", tokenCount: 3},
                                    {text: "\n\nb2", tokenCount: 2},
                                    {text: "\n\n</td>", tokenCount: 4},
                                ],
                                lineMarginTop: 0,
                                lineMarginBottom: 0,
                            },
                            {
                                isGroup: false,
                                tokenCount: 7,
                                context: {sectionHeading: null},
                                sentenceChunks: [
                                    {text: "<td>", tokenCount: 3},
                                    {text: "\n\n", tokenCount: 0},
                                    {text: "\n\n</td>", tokenCount: 4},
                                ],
                                lineMarginTop: 0,
                                lineMarginBottom: 0,
                            },
                            {
                                isGroup: false,
                                tokenCount: 4,
                                context: {sectionHeading: null},
                                sentenceChunks: [{text: "</tr>", tokenCount: 4}],
                                lineMarginTop: 0,
                                lineMarginBottom: 0,
                            },
                        ],
                    },
                    {
                        isGroup: true,
                        tokenCount: 34,
                        context: {sectionHeading: null},
                        childChunks: [
                            {
                                isGroup: false,
                                tokenCount: 3,
                                context: {sectionHeading: null},
                                sentenceChunks: [{text: "<tr>", tokenCount: 3}],
                                lineMarginTop: 0,
                                lineMarginBottom: 0,
                            },
                            {
                                isGroup: false,
                                tokenCount: 9,
                                context: {sectionHeading: null},
                                sentenceChunks: [
                                    {text: "<td>", tokenCount: 3},
                                    {text: "\n\na3", tokenCount: 2},
                                    {text: "\n\n</td>", tokenCount: 4},
                                ],
                                lineMarginTop: 0,
                                lineMarginBottom: 0,
                            },
                            {
                                isGroup: false,
                                tokenCount: 9,
                                context: {sectionHeading: null},
                                sentenceChunks: [
                                    {text: "<td>", tokenCount: 3},
                                    {text: "\n\nb3", tokenCount: 2},
                                    {text: "\n\n</td>", tokenCount: 4},
                                ],
                                lineMarginTop: 0,
                                lineMarginBottom: 0,
                            },
                            {
                                isGroup: false,
                                tokenCount: 9,
                                context: {sectionHeading: null},
                                sentenceChunks: [
                                    {text: "<td>", tokenCount: 3},
                                    {text: "\n\nc3", tokenCount: 2},
                                    {text: "\n\n</td>", tokenCount: 4},
                                ],
                                lineMarginTop: 0,
                                lineMarginBottom: 0,
                            },
                            {
                                isGroup: false,
                                tokenCount: 4,
                                context: {sectionHeading: null},
                                sentenceChunks: [{text: "</tr>", tokenCount: 4}],
                                lineMarginTop: 0,
                                lineMarginBottom: 0,
                            },
                        ],
                    },
                    {
                        isGroup: false,
                        tokenCount: 10,
                        context: {sectionHeading: null},
                        sentenceChunks: [{text: "</tbody></table>", tokenCount: 10}],
                        lineMarginTop: 0,
                        lineMarginBottom: 2,
                    },
                ],
            },
            {
                isGroup: false,
                tokenCount: 1,
                context: {sectionHeading: null},
                sentenceChunks: [{text: "bar", tokenCount: 1}],
                lineMarginTop: 2,
                lineMarginBottom: 2,
            },
        ],
    });
});

test("can chunk a complex table", async () => {
    const tokenizer = await CohereEmbedEnglishV3LanguageTokenizer.get();
    const getAccountIfExists = () => null;
    const getSearchEntityIfExists = () => null;

    expect(
        testGetFullSearchContentChunk(
            schema.node("doc", {}, [
                schema.node("table", {}, [
                    schema.node("tableRow", {}, [
                        schema.node("tableCell", {}, [
                            schema.node("paragraph", {}, [
                                schema.text(
                                    "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Pellentesque facilisis consectetur felis, sed dapibus felis suscipit ac. Proin non condimentum orci, a consequat ex. In hac habitasse platea dictumst. In feugiat libero interdum dolor vestibulum, sit amet pulvinar sem commodo. Integer in tortor cursus, venenatis justo sed, euismod risus. Proin hendrerit facilisis mauris ut sollicitudin. Vivamus dapibus commodo urna, vitae cursus metus sodales sed. Nullam mollis imperdiet tincidunt. Nam at enim dui.",
                                ),
                            ]),
                            schema.node("paragraph", {}, [
                                schema.text(
                                    "Ut suscipit sit amet libero sit amet volutpat. Integer dignissim nec nisl sed faucibus. Duis faucibus porttitor justo a elementum. Etiam pellentesque ligula ac hendrerit elementum. Fusce vitae bibendum erat, vel tristique ante. Donec et lectus vitae lectus vestibulum vestibulum. Etiam arcu metus, placerat quis gravida commodo, ultricies eget enim. Praesent convallis neque id convallis dictum. Donec sodales varius malesuada. Sed at pellentesque tellus. Orci varius natoque penatibus et magnis dis parturient montes, nascetur ridiculus mus. Nulla ut turpis commodo, luctus mi malesuada, venenatis purus. Aliquam erat volutpat. Proin quis bibendum augue. Praesent in lacinia dui.",
                                ),
                            ]),
                        ]),
                        schema.node("tableCell", {}, [
                            schema.node("quoteBlock", {}, [
                                schema.node("paragraph", {}, [
                                    schema.text(
                                        "Nulla luctus purus venenatis lacus molestie, vitae pulvinar purus accumsan. Ut diam magna, pretium ac lectus at, condimentum porttitor ligula. Praesent in dignissim turpis, eget scelerisque massa. Donec nunc tellus, finibus quis nisl quis, pharetra mollis elit. In vel auctor eros. Nulla ac quam mi. Pellentesque a arcu eros. Cras felis ligula, vestibulum nec pulvinar quis, efficitur sit amet sapien. Etiam vestibulum id sem eget mollis.",
                                    ),
                                ]),
                            ]),
                        ]),
                    ]),
                    schema.node("tableRow", {}, [
                        schema.node("tableCell", {}, [
                            schema.node("orderedListItem", {indent: 0}, [
                                schema.node("paragraph", {}, [schema.text("Soil Health:")]),
                            ]),
                            schema.node("orderedListItem", {indent: 1}, [
                                schema.node("paragraph", {}, [
                                    schema.text(
                                        "Preventing Erosion: Sustainable farming practices like crop rotation and cover cropping protect soil from erosion, preserving its fertility.",
                                    ),
                                ]),
                            ]),
                            schema.node("orderedListItem", {indent: 1}, [
                                schema.node("paragraph", {}, [
                                    schema.text(
                                        "Enhancing Soil Quality: Practices such as composting and reduced tillage improve soil structure and nutrient content.",
                                    ),
                                ]),
                            ]),
                        ]),
                        schema.node("tableCell", {}, [
                            schema.node("orderedListItem", {indent: 0}, [
                                schema.node("paragraph", {}, [schema.text("Cost Reduction:")]),
                            ]),
                            schema.node("orderedListItem", {indent: 1}, [
                                schema.node("paragraph", {}, [
                                    schema.text(
                                        "Lower Input Costs: Sustainable practices reduce the need for expensive fertilizers and pesticides, lowering production costs.",
                                    ),
                                ]),
                            ]),
                            schema.node("orderedListItem", {indent: 1}, [
                                schema.node("paragraph", {}, [
                                    schema.text(
                                        "Long-Term Viability: By preserving soil fertility and biodiversity, sustainable agriculture ensures long-term productivity and economic stability for farmers.",
                                    ),
                                ]),
                            ]),
                        ]),
                    ]),
                ]),
            ]),
            {tokenizer, getAccountIfExists, getSearchEntityIfExists},
        ),
    ).toEqual({
        text: `\
<table><tbody><tr><td>

Lorem ipsum dolor sit amet, consectetur adipiscing elit. Pellentesque facilisis consectetur felis, sed dapibus felis suscipit ac. Proin non condimentum orci, a consequat ex. In hac habitasse platea dictumst. In feugiat libero interdum dolor vestibulum, sit amet pulvinar sem commodo. Integer in tortor cursus, venenatis justo sed, euismod risus. Proin hendrerit facilisis mauris ut sollicitudin. Vivamus dapibus commodo urna, vitae cursus metus sodales sed. Nullam mollis imperdiet tincidunt. Nam at enim dui.

Ut suscipit sit amet libero sit amet volutpat. Integer dignissim nec nisl sed faucibus. Duis faucibus porttitor justo a elementum. Etiam pellentesque ligula ac hendrerit elementum. Fusce vitae bibendum erat, vel tristique ante. Donec et lectus vitae lectus vestibulum vestibulum. Etiam arcu metus, placerat quis gravida commodo, ultricies eget enim. Praesent convallis neque id convallis dictum. Donec sodales varius malesuada. Sed at pellentesque tellus. Orci varius natoque penatibus et magnis dis parturient montes, nascetur ridiculus mus. Nulla ut turpis commodo, luctus mi malesuada, venenatis purus. Aliquam erat volutpat. Proin quis bibendum augue. Praesent in lacinia dui.

</td><td>

> Nulla luctus purus venenatis lacus molestie, vitae pulvinar purus accumsan. Ut diam magna, pretium ac lectus at, condimentum porttitor ligula. Praesent in dignissim turpis, eget scelerisque massa. Donec nunc tellus, finibus quis nisl quis, pharetra mollis elit. In vel auctor eros. Nulla ac quam mi. Pellentesque a arcu eros. Cras felis ligula, vestibulum nec pulvinar quis, efficitur sit amet sapien. Etiam vestibulum id sem eget mollis.

</td></tr><tr><td>

1. Soil Health:
    1. Preventing Erosion: Sustainable farming practices like crop rotation and cover cropping protect soil from erosion, preserving its fertility.
    2. Enhancing Soil Quality: Practices such as composting and reduced tillage improve soil structure and nutrient content.

</td><td>

1. Cost Reduction:
    1. Lower Input Costs: Sustainable practices reduce the need for expensive fertilizers and pesticides, lowering production costs.
    2. Long-Term Viability: By preserving soil fertility and biodiversity, sustainable agriculture ensures long-term productivity and economic stability for farmers.

</td></tr></tbody></table>`,
        isGroup: true,
        tokenCount: 774,
        context: {sectionHeading: null},
        childChunks: [
            {
                isGroup: false,
                tokenCount: 8,
                context: {sectionHeading: null},
                sentenceChunks: [{text: "<table><tbody>", tokenCount: 8}],
                lineMarginTop: 2,
                lineMarginBottom: 0,
            },
            {
                isGroup: true,
                tokenCount: 625,
                context: {sectionHeading: null},
                childChunks: [
                    {
                        isGroup: false,
                        tokenCount: 3,
                        context: {sectionHeading: null},
                        sentenceChunks: [{text: "<tr>", tokenCount: 3}],
                        lineMarginTop: 0,
                        lineMarginBottom: 0,
                    },
                    {
                        isGroup: false,
                        tokenCount: 446,
                        context: {sectionHeading: null},
                        sentenceChunks: [
                            {text: "<td>", tokenCount: 3},
                            {
                                text: "\n\nLorem ipsum dolor sit amet, consectetur adipiscing elit.",
                                tokenCount: 21,
                            },
                            {
                                text: "Pellentesque facilisis consectetur felis, sed dapibus felis suscipit ac.",
                                tokenCount: 29,
                            },
                            {
                                text: "Proin non condimentum orci, a consequat ex. In hac habitasse platea dictumst.",
                                tokenCount: 27,
                            },
                            {
                                text: "In feugiat libero interdum dolor vestibulum, sit amet pulvinar sem commodo.",
                                tokenCount: 30,
                            },
                            {
                                text: "Integer in tortor cursus, venenatis justo sed, euismod risus.",
                                tokenCount: 23,
                            },
                            {
                                text: "Proin hendrerit facilisis mauris ut sollicitudin.",
                                tokenCount: 19,
                            },
                            {
                                text: "Vivamus dapibus commodo urna, vitae cursus metus sodales sed.",
                                tokenCount: 23,
                            },
                            {text: "Nullam mollis imperdiet tincidunt.", tokenCount: 13},
                            {text: "Nam at enim dui.", tokenCount: 7},
                            {
                                text: "\n\nUt suscipit sit amet libero sit amet volutpat.",
                                tokenCount: 19,
                            },
                            {text: "Integer dignissim nec nisl sed faucibus.", tokenCount: 15},
                            {text: "Duis faucibus porttitor justo a elementum.", tokenCount: 15},
                            {
                                text: "Etiam pellentesque ligula ac hendrerit elementum.",
                                tokenCount: 16,
                            },
                            {
                                text: "Fusce vitae bibendum erat, vel tristique ante.",
                                tokenCount: 20,
                            },
                            {
                                text: "Donec et lectus vitae lectus vestibulum vestibulum.",
                                tokenCount: 16,
                            },
                            {
                                text: "Etiam arcu metus, placerat quis gravida commodo, ultricies eget enim.",
                                tokenCount: 26,
                            },
                            {text: "Praesent convallis neque id convallis dictum.", tokenCount: 16},
                            {text: "Donec sodales varius malesuada.", tokenCount: 10},
                            {text: "Sed at pellentesque tellus.", tokenCount: 10},
                            {
                                text: "Orci varius natoque penatibus et magnis dis parturient montes, nascetur ridiculus mus.",
                                tokenCount: 29,
                            },
                            {
                                text: "Nulla ut turpis commodo, luctus mi malesuada, venenatis purus.",
                                tokenCount: 24,
                            },
                            {text: "Aliquam erat volutpat.", tokenCount: 10},
                            {text: "Proin quis bibendum augue.", tokenCount: 11},
                            {text: "Praesent in lacinia dui.", tokenCount: 10},
                            {text: "\n\n</td>", tokenCount: 4},
                        ],
                        lineMarginTop: 0,
                        lineMarginBottom: 0,
                    },
                    {
                        isGroup: false,
                        tokenCount: 172,
                        context: {sectionHeading: null},
                        sentenceChunks: [
                            {text: "<td>", tokenCount: 3},
                            {
                                text: "\n\n> Nulla luctus purus venenatis lacus molestie, vitae pulvinar purus accumsan.",
                                tokenCount: 29,
                            },
                            {
                                text: "Ut diam magna, pretium ac lectus at, condimentum porttitor ligula.",
                                tokenCount: 22,
                            },
                            {
                                text: "Praesent in dignissim turpis, eget scelerisque massa.",
                                tokenCount: 22,
                            },
                            {
                                text: "Donec nunc tellus, finibus quis nisl quis, pharetra mollis elit.",
                                tokenCount: 25,
                            },
                            {text: "In vel auctor eros.", tokenCount: 8},
                            {text: "Nulla ac quam mi. Pellentesque a arcu eros.", tokenCount: 17},
                            {
                                text: "Cras felis ligula, vestibulum nec pulvinar quis, efficitur sit amet sapien.",
                                tokenCount: 29,
                            },
                            {text: "Etiam vestibulum id sem eget mollis.", tokenCount: 13},
                            {text: "\n\n</td>", tokenCount: 4},
                        ],
                        lineMarginTop: 0,
                        lineMarginBottom: 0,
                    },
                    {
                        isGroup: false,
                        tokenCount: 4,
                        context: {sectionHeading: null},
                        sentenceChunks: [{text: "</tr>", tokenCount: 4}],
                        lineMarginTop: 0,
                        lineMarginBottom: 0,
                    },
                ],
            },
            {
                isGroup: true,
                tokenCount: 131,
                context: {sectionHeading: null},
                childChunks: [
                    {
                        isGroup: false,
                        tokenCount: 3,
                        context: {sectionHeading: null},
                        sentenceChunks: [{text: "<tr>", tokenCount: 3}],
                        lineMarginTop: 0,
                        lineMarginBottom: 0,
                    },
                    {
                        isGroup: false,
                        tokenCount: 59,
                        context: {sectionHeading: null},
                        sentenceChunks: [
                            {text: "<td>", tokenCount: 3},
                            {text: "\n\n1. Soil Health:", tokenCount: 5},
                            {
                                text: "\n    1. Preventing Erosion: Sustainable farming practices like crop rotation and cover cropping protect soil from erosion, preserving its fertility.",
                                tokenCount: 24,
                            },
                            {
                                text: "\n    2. Enhancing Soil Quality: Practices such as composting and reduced tillage improve soil structure and nutrient content.",
                                tokenCount: 23,
                            },
                            {text: "\n\n</td>", tokenCount: 4},
                        ],
                        lineMarginTop: 0,
                        lineMarginBottom: 0,
                    },
                    {
                        isGroup: false,
                        tokenCount: 65,
                        context: {sectionHeading: null},
                        sentenceChunks: [
                            {text: "<td>", tokenCount: 3},
                            {text: "\n\n1. Cost Reduction:", tokenCount: 5},
                            {
                                text: "\n    1. Lower Input Costs: Sustainable practices reduce the need for expensive fertilizers and pesticides, lowering production costs.",
                                tokenCount: 25,
                            },
                            {
                                text: "\n    2. Long-Term Viability: By preserving soil fertility and biodiversity, sustainable agriculture ensures long-term productivity and economic stability for farmers.",
                                tokenCount: 28,
                            },
                            {text: "\n\n</td>", tokenCount: 4},
                        ],
                        lineMarginTop: 0,
                        lineMarginBottom: 0,
                    },
                    {
                        isGroup: false,
                        tokenCount: 4,
                        context: {sectionHeading: null},
                        sentenceChunks: [{text: "</tr>", tokenCount: 4}],
                        lineMarginTop: 0,
                        lineMarginBottom: 0,
                    },
                ],
            },
            {
                isGroup: false,
                tokenCount: 10,
                context: {sectionHeading: null},
                sentenceChunks: [{text: "</tbody></table>", tokenCount: 10}],
                lineMarginTop: 0,
                lineMarginBottom: 2,
            },
        ],
    });
});

test("can chunk a table with list items", async () => {
    const tokenizer = await CohereEmbedEnglishV3LanguageTokenizer.get();
    const getAccountIfExists = () => null;
    const getSearchEntityIfExists = () => null;

    expect(
        testGetFullSearchContentChunk(
            schema.node("doc", {}, [
                schema.node("paragraph", {}, [schema.text("foo")]),
                schema.node("table", {}, [
                    schema.node("tableRow", {}, [
                        schema.node("tableCell", {}, [
                            schema.node("paragraph", {}, [schema.text("a1")]),
                        ]),
                        schema.node("tableCell", {}, [
                            schema.node("paragraph", {}, [schema.text("b1")]),
                        ]),
                        schema.node("tableCell", {}, [
                            schema.node("paragraph", {}, [schema.text("c1")]),
                        ]),
                    ]),
                    schema.node("tableRow", {}, [
                        schema.node("tableCell", {}, [
                            schema.node("paragraph", {}, [schema.text("a2")]),
                        ]),
                        schema.node("tableCell", {}, [
                            schema.node("paragraph", {}, [schema.text("b2")]),
                        ]),
                        schema.node("tableCell", {}, [
                            schema.node("paragraph", {}, [schema.text("foo")]),
                            schema.node("unorderedListItem", {indent: 0}, [
                                schema.node("paragraph", {}, [schema.text("1")]),
                            ]),
                            schema.node("unorderedListItem", {indent: 0}, [
                                schema.node("paragraph", {}, [schema.text("2")]),
                            ]),
                            schema.node("unorderedListItem", {indent: 1}, [
                                schema.node("paragraph", {}, [schema.text("2.1")]),
                            ]),
                            schema.node("unorderedListItem", {indent: 1}, [
                                schema.node("paragraph", {}, [schema.text("2.2")]),
                            ]),
                            schema.node("unorderedListItem", {indent: 2}, [
                                schema.node("paragraph", {}, [schema.text("2.2.1")]),
                            ]),
                            schema.node("unorderedListItem", {indent: 1}, [
                                schema.node("paragraph", {}, [schema.text("2.3")]),
                            ]),
                            schema.node("unorderedListItem", {indent: 0}, [
                                schema.node("paragraph", {}, [schema.text("3")]),
                            ]),
                            schema.node("unorderedListItem", {indent: 0}, [
                                schema.node("paragraph", {}, [schema.text("4")]),
                            ]),
                            schema.node("paragraph", {}, [schema.text("bar")]),
                        ]),
                    ]),
                    schema.node("tableRow", {}, [
                        schema.node("tableCell", {}, [
                            schema.node("paragraph", {}, [schema.text("a3")]),
                        ]),
                        schema.node("tableCell", {}, [
                            schema.node("paragraph", {}, [schema.text("b3")]),
                        ]),
                        schema.node("tableCell", {}, [
                            schema.node("paragraph", {}, [schema.text("c3")]),
                        ]),
                    ]),
                ]),
                schema.node("paragraph", {}, [schema.text("bar")]),
            ]),
            {tokenizer, getAccountIfExists, getSearchEntityIfExists},
        ),
    ).toEqual({
        text: `\
foo

<table><tbody><tr><td>

a1

</td><td>

b1

</td><td>

c1

</td></tr><tr><td>

a2

</td><td>

b2

</td><td>

foo

- 1
- 2
    - 2\\.1
    - 2\\.2
        - 2\\.2.1
    - 2\\.3
- 3
- 4

bar

</td></tr><tr><td>

a3

</td><td>

b3

</td><td>

c3

</td></tr></tbody></table>

bar`,
        isGroup: true,
        tokenCount: 148,
        context: {sectionHeading: null},
        childChunks: [
            {
                isGroup: false,
                tokenCount: 1,
                context: {sectionHeading: null},
                sentenceChunks: [{text: "foo", tokenCount: 1}],
                lineMarginTop: 2,
                lineMarginBottom: 2,
            },
            {
                isGroup: true,
                tokenCount: 146,
                context: {sectionHeading: null},
                childChunks: [
                    {
                        isGroup: false,
                        tokenCount: 8,
                        context: {sectionHeading: null},
                        sentenceChunks: [{text: "<table><tbody>", tokenCount: 8}],
                        lineMarginTop: 2,
                        lineMarginBottom: 0,
                    },
                    {
                        isGroup: true,
                        tokenCount: 31,
                        context: {sectionHeading: null},
                        childChunks: [
                            {
                                isGroup: false,
                                tokenCount: 3,
                                context: {sectionHeading: null},
                                sentenceChunks: [{text: "<tr>", tokenCount: 3}],
                                lineMarginTop: 0,
                                lineMarginBottom: 0,
                            },
                            {
                                isGroup: false,
                                tokenCount: 8,
                                context: {sectionHeading: null},
                                sentenceChunks: [
                                    {text: "<td>", tokenCount: 3},
                                    {text: "\n\na1", tokenCount: 1},
                                    {text: "\n\n</td>", tokenCount: 4},
                                ],
                                lineMarginTop: 0,
                                lineMarginBottom: 0,
                            },
                            {
                                isGroup: false,
                                tokenCount: 8,
                                context: {sectionHeading: null},
                                sentenceChunks: [
                                    {text: "<td>", tokenCount: 3},
                                    {text: "\n\nb1", tokenCount: 1},
                                    {text: "\n\n</td>", tokenCount: 4},
                                ],
                                lineMarginTop: 0,
                                lineMarginBottom: 0,
                            },
                            {
                                isGroup: false,
                                tokenCount: 8,
                                context: {sectionHeading: null},
                                sentenceChunks: [
                                    {text: "<td>", tokenCount: 3},
                                    {text: "\n\nc1", tokenCount: 1},
                                    {text: "\n\n</td>", tokenCount: 4},
                                ],
                                lineMarginTop: 0,
                                lineMarginBottom: 0,
                            },
                            {
                                isGroup: false,
                                tokenCount: 4,
                                context: {sectionHeading: null},
                                sentenceChunks: [{text: "</tr>", tokenCount: 4}],
                                lineMarginTop: 0,
                                lineMarginBottom: 0,
                            },
                        ],
                    },
                    {
                        isGroup: true,
                        tokenCount: 63,
                        context: {sectionHeading: null},
                        childChunks: [
                            {
                                isGroup: false,
                                tokenCount: 3,
                                context: {sectionHeading: null},
                                sentenceChunks: [{text: "<tr>", tokenCount: 3}],
                                lineMarginTop: 0,
                                lineMarginBottom: 0,
                            },
                            {
                                isGroup: false,
                                tokenCount: 8,
                                context: {sectionHeading: null},
                                sentenceChunks: [
                                    {text: "<td>", tokenCount: 3},
                                    {text: "\n\na2", tokenCount: 1},
                                    {text: "\n\n</td>", tokenCount: 4},
                                ],
                                lineMarginTop: 0,
                                lineMarginBottom: 0,
                            },
                            {
                                isGroup: false,
                                tokenCount: 9,
                                context: {sectionHeading: null},
                                sentenceChunks: [
                                    {text: "<td>", tokenCount: 3},
                                    {text: "\n\nb2", tokenCount: 2},
                                    {text: "\n\n</td>", tokenCount: 4},
                                ],
                                lineMarginTop: 0,
                                lineMarginBottom: 0,
                            },
                            {
                                isGroup: true,
                                tokenCount: 39,
                                context: {sectionHeading: null},
                                childChunks: [
                                    {
                                        isGroup: false,
                                        tokenCount: 4,
                                        context: {sectionHeading: null},
                                        sentenceChunks: [
                                            {text: "<td>", tokenCount: 3},
                                            {text: "\n\nfoo", tokenCount: 1},
                                        ],
                                        lineMarginTop: 0,
                                        lineMarginBottom: 2,
                                    },
                                    {
                                        isGroup: true,
                                        tokenCount: 30,
                                        context: {sectionHeading: null},
                                        childChunks: [
                                            {
                                                isGroup: false,
                                                tokenCount: 2,
                                                context: {sectionHeading: null},
                                                sentenceChunks: [{text: "- 1", tokenCount: 2}],
                                                lineMarginTop: 1,
                                                lineMarginBottom: 1,
                                            },
                                            {
                                                isGroup: true,
                                                tokenCount: 24,
                                                context: {sectionHeading: null},
                                                childChunks: [
                                                    {
                                                        isGroup: false,
                                                        tokenCount: 2,
                                                        context: {sectionHeading: null},
                                                        sentenceChunks: [
                                                            {text: "- 2", tokenCount: 2},
                                                        ],
                                                        lineMarginTop: 1,
                                                        lineMarginBottom: 1,
                                                    },
                                                    {
                                                        isGroup: false,
                                                        tokenCount: 5,
                                                        context: {sectionHeading: null},
                                                        sentenceChunks: [
                                                            {
                                                                text: "    - 2\\.1",
                                                                tokenCount: 5,
                                                            },
                                                        ],
                                                        lineMarginTop: 1,
                                                        lineMarginBottom: 1,
                                                    },
                                                    {
                                                        isGroup: true,
                                                        tokenCount: 12,
                                                        context: {sectionHeading: null},
                                                        childChunks: [
                                                            {
                                                                isGroup: false,
                                                                tokenCount: 5,
                                                                context: {
                                                                    sectionHeading: null,
                                                                },
                                                                sentenceChunks: [
                                                                    {
                                                                        text: "    - 2\\.2",
                                                                        tokenCount: 5,
                                                                    },
                                                                ],
                                                                lineMarginTop: 1,
                                                                lineMarginBottom: 1,
                                                            },
                                                            {
                                                                isGroup: false,
                                                                tokenCount: 7,
                                                                context: {
                                                                    sectionHeading: null,
                                                                },
                                                                sentenceChunks: [
                                                                    {
                                                                        text: "        - 2\\.2.1",
                                                                        tokenCount: 7,
                                                                    },
                                                                ],
                                                                lineMarginTop: 1,
                                                                lineMarginBottom: 1,
                                                            },
                                                        ],
                                                    },
                                                    {
                                                        isGroup: false,
                                                        tokenCount: 5,
                                                        context: {sectionHeading: null},
                                                        sentenceChunks: [
                                                            {
                                                                text: "    - 2\\.3",
                                                                tokenCount: 5,
                                                            },
                                                        ],
                                                        lineMarginTop: 1,
                                                        lineMarginBottom: 1,
                                                    },
                                                ],
                                            },
                                            {
                                                isGroup: false,
                                                tokenCount: 2,
                                                context: {sectionHeading: null},
                                                sentenceChunks: [{text: "- 3", tokenCount: 2}],
                                                lineMarginTop: 1,
                                                lineMarginBottom: 1,
                                            },
                                            {
                                                isGroup: false,
                                                tokenCount: 2,
                                                context: {sectionHeading: null},
                                                sentenceChunks: [{text: "- 4", tokenCount: 2}],
                                                lineMarginTop: 1,
                                                lineMarginBottom: 1,
                                            },
                                        ],
                                    },
                                    {
                                        isGroup: false,
                                        tokenCount: 5,
                                        context: {sectionHeading: null},
                                        sentenceChunks: [
                                            {text: "bar", tokenCount: 1},
                                            {text: "\n\n</td>", tokenCount: 4},
                                        ],
                                        lineMarginTop: 2,
                                        lineMarginBottom: 0,
                                    },
                                ],
                            },
                            {
                                isGroup: false,
                                tokenCount: 4,
                                context: {sectionHeading: null},
                                sentenceChunks: [{text: "</tr>", tokenCount: 4}],
                                lineMarginTop: 0,
                                lineMarginBottom: 0,
                            },
                        ],
                    },
                    {
                        isGroup: true,
                        tokenCount: 34,
                        context: {sectionHeading: null},
                        childChunks: [
                            {
                                isGroup: false,
                                tokenCount: 3,
                                context: {sectionHeading: null},
                                sentenceChunks: [{text: "<tr>", tokenCount: 3}],
                                lineMarginTop: 0,
                                lineMarginBottom: 0,
                            },
                            {
                                isGroup: false,
                                tokenCount: 9,
                                context: {sectionHeading: null},
                                sentenceChunks: [
                                    {text: "<td>", tokenCount: 3},
                                    {text: "\n\na3", tokenCount: 2},
                                    {text: "\n\n</td>", tokenCount: 4},
                                ],
                                lineMarginTop: 0,
                                lineMarginBottom: 0,
                            },
                            {
                                isGroup: false,
                                tokenCount: 9,
                                context: {sectionHeading: null},
                                sentenceChunks: [
                                    {text: "<td>", tokenCount: 3},
                                    {text: "\n\nb3", tokenCount: 2},
                                    {text: "\n\n</td>", tokenCount: 4},
                                ],
                                lineMarginTop: 0,
                                lineMarginBottom: 0,
                            },
                            {
                                isGroup: false,
                                tokenCount: 9,
                                context: {sectionHeading: null},
                                sentenceChunks: [
                                    {text: "<td>", tokenCount: 3},
                                    {text: "\n\nc3", tokenCount: 2},
                                    {text: "\n\n</td>", tokenCount: 4},
                                ],
                                lineMarginTop: 0,
                                lineMarginBottom: 0,
                            },
                            {
                                isGroup: false,
                                tokenCount: 4,
                                context: {sectionHeading: null},
                                sentenceChunks: [{text: "</tr>", tokenCount: 4}],
                                lineMarginTop: 0,
                                lineMarginBottom: 0,
                            },
                        ],
                    },
                    {
                        isGroup: false,
                        tokenCount: 10,
                        context: {sectionHeading: null},
                        sentenceChunks: [{text: "</tbody></table>", tokenCount: 10}],
                        lineMarginTop: 0,
                        lineMarginBottom: 2,
                    },
                ],
            },
            {
                isGroup: false,
                tokenCount: 1,
                context: {sectionHeading: null},
                sentenceChunks: [{text: "bar", tokenCount: 1}],
                lineMarginTop: 2,
                lineMarginBottom: 2,
            },
        ],
    });
});
