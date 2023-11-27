import {createTestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {getFullSearchContentChunk} from "~/server/search/index/internal/chunk_search_content.js";
import {CohereEnglishLightLanguageModel} from "~/server/search/index/internal/cohere_english_light_language_model.js";
import {chunkDocumentSearchContent} from "~/server/search/index/internal/index_search_entity.js";
import {getAccountIfExists} from "~/server/spaces/spaces_table.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {
    DocumentContent,
    DocumentContentProsemirrorSchema,
    DocumentWithoutTitleContentProsemirrorSchema,
} from "~/shared/documents/document_content_schema.js";
import {generateId} from "~/shared/id/id.js";

const schema = DocumentWithoutTitleContentProsemirrorSchema;

const context = createTestContext();

test("discovers paragraph and sentence structure", async () => {
    const model = await CohereEnglishLightLanguageModel.get();
    const getAccountIfExists = async () => null;

    expect(
        await getFullSearchContentChunk(
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
            {model, getAccountIfExists},
        ),
    ).toEqual({
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
                        text: "Proin non condimentum orci, a consequat ex.",
                        tokenCount: 16,
                    },
                    {text: "In hac habitasse platea dictumst.", tokenCount: 11},
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
                    {text: "Nulla ac quam mi.", tokenCount: 7},
                    {text: "Pellentesque a arcu eros.", tokenCount: 10},
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
    const model = await CohereEnglishLightLanguageModel.get();
    const getAccountIfExists = async () => null;

    expect(
        await getFullSearchContentChunk(
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
                        "Transitioning to renewable energy sources is not just an environmental imperative but an economic opportunity. Investments in renewable technologies drive innovation and create job opportunities, fostering economic growth. Moreover, the renewable energy sector demonstrates resilience, providing a stable and diverse energy supply that isn't as vulnerable to geopolitical tensions or market fluctuations as traditional energy sources. By diversifying energy portfolios, nations can enhance energy security and reduce dependence on finite resources.",
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
                        "To realize a sustainable future, a collective effort is necessary. Governments, industries, and individuals must collaborate to accelerate the transition towards renewable energy. Policymakers can implement supportive regulations and incentives to encourage renewable energy adoption, such as tax credits and subsidies for renewable projects. Industries can invest in research and development to enhance renewable technologies' efficiency and affordability. Individuals can contribute by adopting energy-efficient practices and supporting renewable energy initiatives in their communities. Together, this collective action can pave the way for a sustainable energy future, mitigating environmental impact and ensuring a resilient and thriving planet for generations to come.",
                    ),
                ]),
            ]),
            {model, getAccountIfExists},
        ),
    ).toEqual({
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
                                text: "Moreover, the renewable energy sector demonstrates resilience, providing a stable and diverse energy supply that isn't as vulnerable to geopolitical tensions or market fluctuations as traditional energy sources.",
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
                        sentenceChunks: [
                            {
                                text: "---",
                                tokenCount: 3,
                            },
                        ],
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
                                text: "Industries can invest in research and development to enhance renewable technologies' efficiency and affordability.",
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
    const model = await CohereEnglishLightLanguageModel.get();
    const getAccountIfExists = async () => null;

    expect(
        await getFullSearchContentChunk(
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
                ]),
                schema.node("unorderedListItem", {indent: 0}, [
                    schema.node("paragraph", {}, [
                        schema.text(
                            "Knowledge Sharing: Sustainable farming practices involve education and knowledge sharing within communities, empowering farmers with valuable skills.",
                        ),
                    ]),
                ]),
            ]),
            {model, getAccountIfExists},
        ),
    ).toEqual({
        isGroup: true,
        tokenCount: 314,
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
                                        text: "  1. Preventing Erosion: Sustainable farming practices like crop rotation and cover cropping protect soil from erosion, preserving its fertility.",
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
                                        text: "  2. Enhancing Soil Quality: Practices such as composting and reduced tillage improve soil structure and nutrient content.",
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
                                            {text: "  3. Water Conservation:", tokenCount: 5},
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
                                                text: "    - Reduced Water Usage: Sustainable methods like drip irrigation and rainwater harvesting minimize water waste in agriculture.",
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
                                                text: "    - Preserving Water Quality: Practices like buffer zones prevent agricultural runoff, preserving water quality in surrounding ecosystems.",
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
                                        text: "  1. Lower Input Costs: Sustainable practices reduce the need for expensive fertilizers and pesticides, lowering production costs.",
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
                                        text: "  2. Long-Term Viability: By preserving soil fertility and biodiversity, sustainable agriculture ensures long-term productivity and economic stability for farmers.",
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
                tokenCount: 65,
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
                        tokenCount: 23,
                        context: {
                            sectionHeading:
                                "Sustainable Agriculture: Nurturing the Earth and Communities",
                        },
                        sentenceChunks: [
                            {
                                text: "- Food Security: Diverse and sustainable farming methods contribute to food security, ensuring a more resilient food system.",
                                tokenCount: 23,
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

test("discovers paragraph introduction structure", async () => {
    const model = await CohereEnglishLightLanguageModel.get();
    const getAccountIfExists = async () => null;

    expect(
        await getFullSearchContentChunk(
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
            {model, getAccountIfExists},
        ),
    ).toEqual({
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
    const model = await CohereEnglishLightLanguageModel.get();
    const getAccountIfExists = async () => null;

    expect(
        await getFullSearchContentChunk(
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
            {model, getAccountIfExists},
        ),
    ).toEqual({
        isGroup: true,
        tokenCount: 619,
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
                    {text: "Proin non condimentum orci, a consequat ex.", tokenCount: 16},
                    {text: "In hac habitasse platea dictumst.", tokenCount: 11},
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
                tokenCount: 427,
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
                    {text: "Praesent in dignissim turpis,\n> eget scelerisque", tokenCount: 20},
                    {text: "massa.", tokenCount: 3},
                    {
                        text: "Donec nunc tellus, finibus quis nisl quis, pharetra mollis elit.",
                        tokenCount: 25,
                    },
                    {text: "In vel auctor eros.", tokenCount: 8},
                    {text: "Nulla ac quam mi.", tokenCount: 7},
                    {text: "Pellentesque a arcu eros.", tokenCount: 10},
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

test("discovers code block structure", async () => {
    const model = await CohereEnglishLightLanguageModel.get();
    const getAccountIfExists = async () => null;

    expect(
        await getFullSearchContentChunk(
            schema.node("doc", {}, [
                schema.node("paragraph", {}, [
                    schema.text(
                        "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Pellentesque facilisis consectetur felis, sed dapibus felis suscipit ac. Proin non condimentum orci, a consequat ex. In hac habitasse platea dictumst. In feugiat libero interdum dolor vestibulum, sit amet pulvinar sem commodo. Integer in tortor cursus, venenatis justo sed, euismod risus. Proin hendrerit facilisis mauris ut sollicitudin. Vivamus dapibus commodo urna, vitae cursus metus sodales sed. Nullam mollis imperdiet tincidunt. Nam at enim dui.",
                    ),
                ]),
                schema.node("codeBlock", {}, [
                    schema.text("let a = 1;\nlet b = 1;\nlet c = a + b;\nconsole.log(c);\n"),
                ]),
            ]),
            {model, getAccountIfExists},
        ),
    ).toEqual({
        isGroup: true,
        tokenCount: 215,
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
                    {text: "Proin non condimentum orci, a consequat ex.", tokenCount: 16},
                    {text: "In hac habitasse platea dictumst.", tokenCount: 11},
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
                tokenCount: 23,
                context: {sectionHeading: null},
                sentenceChunks: [
                    {text: "```\nlet a = 1;\nlet b = 1;\nlet c = a + b;\n```", tokenCount: 23},
                ],
                lineMarginTop: 2,
                lineMarginBottom: 2,
            },
        ],
    });
});

test("prints a list item with line breaks", async () => {
    const model = await CohereEnglishLightLanguageModel.get();
    const getAccountIfExists = async () => null;

    expect(
        await getFullSearchContentChunk(
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
            {model, getAccountIfExists},
        ),
    ).toEqual({
        isGroup: false,
        tokenCount: 167,
        context: {sectionHeading: null},
        sentenceChunks: [
            {
                text: "[x] Nulla luctus purus venenatis lacus molestie, vitae pulvinar purus accumsan.",
                tokenCount: 31,
            },
            {
                text: "Ut diam magna, pretium ac lectus at, condimentum porttitor ligula.",
                tokenCount: 22,
            },
            {text: "Praesent in dignissim turpis,\n    eget scelerisque", tokenCount: 19},
            {text: "massa.", tokenCount: 3},
            {
                text: "Donec nunc tellus, finibus quis nisl quis, pharetra mollis elit.",
                tokenCount: 25,
            },
            {text: "In vel auctor eros.", tokenCount: 8},
            {text: "Nulla ac quam mi.", tokenCount: 7},
            {text: "Pellentesque a arcu eros.", tokenCount: 10},
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
    const model = await CohereEnglishLightLanguageModel.get();
    const getAccountIfExists = async () => null;

    expect(
        await getFullSearchContentChunk(
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
            {model, getAccountIfExists},
        ),
    ).toEqual({
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
            {text: "Praesent in dignissim turpis,\n#### eget scelerisque", tokenCount: 23},
            {text: "massa.", tokenCount: 3},
            {
                text: "Donec nunc tellus, finibus quis nisl quis, pharetra mollis elit.",
                tokenCount: 25,
            },
            {text: "In vel auctor eros.", tokenCount: 8},
            {text: "Nulla ac quam mi.", tokenCount: 7},
            {text: "Pellentesque a arcu eros.", tokenCount: 10},
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
    const model = await CohereEnglishLightLanguageModel.get();
    const getAccountIfExists = async () => null;

    expect(
        await getFullSearchContentChunk(
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
                    schema.text("test8", [schema.mark("strike")]),
                    schema.text(" "),
                    schema.text("test9", [schema.mark("strike"), schema.mark("bold")]),
                    schema.text(" *test10*"),
                ]),
            ]),
            {model, getAccountIfExists},
        ),
    ).toEqual({
        isGroup: false,
        tokenCount: 60,
        context: {sectionHeading: null},
        sentenceChunks: [
            {
                text: "test1 **test2** *test3* ***test4*** `test5` `**test6**` `*test7*` ~~test8~~ **~~test9~~** \\*test10\\*",
                tokenCount: 60,
            },
        ],
        lineMarginTop: 2,
        lineMarginBottom: 2,
    });
});

test("prints mentions", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession({name: "Caleb Meredith"});

    const model = await CohereEnglishLightLanguageModel.get();

    expect(
        await getFullSearchContentChunk(
            schema.node("doc", {}, [
                schema.node("paragraph", {}, [
                    schema.text("hello "),
                    schema.node("mention", {
                        mention: {accountId: session.account.id, isShort: false},
                    }),
                ]),
                schema.node("paragraph", {}, [
                    schema.text("hello "),
                    schema.node("mention", {
                        mention: {accountId: session.account.id, isShort: true},
                    }),
                ]),
                schema.node("paragraph", {}, [
                    schema.text("hello "),
                    schema.node("mention", {
                        mention: {accountId: generateId(), isShort: false},
                    }),
                ]),
            ]),
            {
                model,
                getAccountIfExists: accountId =>
                    getAccountIfExists(session.action(), space.id, accountId),
            },
        ),
    ).toEqual({
        isGroup: true,
        tokenCount: 10,
        context: {sectionHeading: null},
        childChunks: [
            {
                isGroup: false,
                tokenCount: 4,
                context: {sectionHeading: null},
                sentenceChunks: [{text: "hello @Caleb Meredith", tokenCount: 4}],
                lineMarginTop: 2,
                lineMarginBottom: 2,
            },
            {
                isGroup: false,
                tokenCount: 3,
                context: {sectionHeading: null},
                sentenceChunks: [{text: "hello @Caleb", tokenCount: 3}],
                lineMarginTop: 2,
                lineMarginBottom: 2,
            },
            {
                isGroup: false,
                tokenCount: 3,
                context: {sectionHeading: null},
                sentenceChunks: [{text: "hello @Unknown", tokenCount: 3}],
                lineMarginTop: 2,
                lineMarginBottom: 2,
            },
        ],
    });
});

test("correctly chunks document content", async () => {
    const model = await CohereEnglishLightLanguageModel.get();
    const getAccountIfExists = async () => null;

    expect(
        await chunkDocumentSearchContent(
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
                                        text: " Bringing a project to completion shouldn't involve jumping between tools and losing track of where things are happening. Instead it should feel like a continuous experience from idea to execution.",
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
                            {type: "text", text: "Our pricing model will be "},
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
                                text: "While this pricing model can get expensive when Cyberworlds is fully adopted in an organization, it will be less expensive than paying for each of these tools individually. So we can make a consolidation and cost saving argument to IT as the product gains adoption within an organization.",
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
            {model, getAccountIfExists},
        ).then(({embeddingChunks}) => embeddingChunks),
    ).toEqual([
        // Chunk 1:
        {
            preambleEndIndex: 31,
            text: `\
# Product vision and strategy

This document is a part of our packet introducing Cyberworlds (code name, will change when we go to market). See all documents in this packet

## Vision

Our product’s mission is: **Help people work together**

People can build great things when they work together. We aim to improve the productivity of our customers so they can build even more great things.

Cyberworlds will streamline work collaboration by bringing together the top productivity tools (chat, documents, tasks, video conferencing, calendaring, email, sheets, slides) into one deeply integrated product. Some things we believe:

- **Our tools are fragmented.** Bringing a project to completion shouldn't involve jumping between tools and losing track of where things are happening. Instead it should feel like a continuous experience from idea to execution.
- **Conversations are core to collaboration.** We plan to unify conversations across the product experience. Never lose track of what’s happening and pick up the conversation where you left off.
- **All-in-one is the new norm.** Work collaboration tools are being commoditized and the value proposition is increasingly moving to the integration of features. Enterprise buyers don’t want to pay for tools that do the same thing. By shipping a bundle we build a defensible enterprise business.
- **Quality is hard to find.** Growth hacks, design drift, lack of conviction, and tech debt have taken a toll on the user experience of existing products. Users are frustrated and want something better. Today, buyers are facing tough decisions between best-in-class products and a bundle—we plan to build a best-in-class product bundle.
- **Dedicated to our craft.** We believe execution is the key to this opportunity. The innovation here is not the product but rather in designing a company that can build at the quality users deserve with meaningful momentum. By committing to these values we hope to attract top talent.
- **Stay focused and maintain work-life boundaries.** With all your conversations in one place, we can make sure they don’t reach you outside of work hours. We hope to help make work a more enjoyable and equitable place to be through our product’s design and get out of the way when you’re done for the day.`,
        },

        // Chunk 2:
        {
            preambleEndIndex: 58,
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

        // NOCOMMIT: Test the query "Why is our product different?" It should match
        // this chunk thanks to semantic search.

        // Chunk 4:
        {
            preambleEndIndex: 84,
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
            text: `\
This is from the “Product vision and strategy” document:

### Differentiation, go to market, and pricing

Our initial customer base will be product, design, and engineering teams. These teams are more likely to appreciate a product with an intense focus on craft. If we are successful at building a high quality product we will have marketing material for these teams. We show how much thought we put into the product, share our techniques, and in turn get teams excited to try our product for themselves. (This also has a side effect of attracting talent to come work with us.)

These teams are also more likely to be using the “**Slack stack**.” The Slack stack is what we call a hand-rolled collaboration suite using Slack and other point solution products like Zoom, Quip, Asana, Atlassian, Notion, and Google Workspace on the side (for email and calendar). We believe that if we can build the products and features in the previous section we will be in striking distance of a 10x improvement compared to cobbling together equivalent tools in the Slack stack.

Our product led growth motion will be: insist on email sign in using a company email address. Strongly discouraging, maybe even disallowing (without extra friction), signing up with free email domains like @gmail.com. When the user verifies their email address we automatically add them to the company workspace. (This is why we sent you one-time password to your email when you signed in. We verify your email and get you in at the same time.)

We will give SSO away for free to start building good will with IT and encourage centralized IT management.

Our pricing model will be **usage based pricing**. *Every single employee in an organization should be able to sign into their company workspace for $0*. Only as employees actually start to use the product do we start to charge. This also means as we launch new products and usage goes up—we make more revenue without new pricing models to learn.`,
        },

        // Chunk 7:
        {
            preambleEndIndex: 118,
            text: `\
This is from the “Product vision and strategy” document in the “Differentiation, go to market, and pricing” section:

Right now, the plan is to charge by hours using the product in increments of \\~100 hours/week. Tracking time is a unified way to measure usage across all products. It is simple to understand and so easy for finance teams to estimate. We charge in increments of 100 hours/week so that individual behavior does not change the bill. Increased usage from at least two or three users is needed for the bill to increase (say usage from individual users fluctuates between 5–20 hours/week).

Of course we can provide custom enterprise plans that lock in a price for stability.

While this pricing model can get expensive when Cyberworlds is fully adopted in an organization, it will be less expensive than paying for each of these tools individually. So we can make a consolidation and cost saving argument to IT as the product gains adoption within an organization.`,
        },

        // Chunk 8:
        {
            preambleEndIndex: 58,
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
