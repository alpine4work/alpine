import {createTestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {getFullSearchContentChunk} from "~/server/search/index/internal/chunk_search_content.js";
import {CohereEnglishLightTokenizer} from "~/server/search/index/internal/cohere_english_light_tokenizer.js";
import {getAccountIfExists} from "~/server/spaces/spaces_table.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {DocumentWithoutTitleContentProsemirrorSchema} from "~/shared/documents/document_content_schema.js";
import {generateId} from "~/shared/id/id.js";

const schema = DocumentWithoutTitleContentProsemirrorSchema;

const context = createTestContext();

test("discovers paragraph and sentence structure", async () => {
    const tokenizer = await CohereEnglishLightTokenizer.get();
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
            {tokenizer, getAccountIfExists},
        ),
    ).toEqual({
        isGroup: true,
        tokenCount: 603,
        childChunks: [
            {
                isGroup: false,
                tokenCount: 192,
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
    const tokenizer = await CohereEnglishLightTokenizer.get();
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
            {tokenizer, getAccountIfExists},
        ),
    ).toEqual({
        isGroup: true,
        tokenCount: 431,
        childChunks: [
            {
                isGroup: true,
                tokenCount: 201,
                childChunks: [
                    {
                        isGroup: false,
                        tokenCount: 11,
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
                        sentenceChunks: [
                            {text: "### Addressing Environmental Concerns", tokenCount: 6},
                        ],
                        lineMarginTop: 2,
                        lineMarginBottom: 2,
                    },
                    {
                        isGroup: false,
                        tokenCount: 95,
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
                childChunks: [
                    {
                        isGroup: false,
                        tokenCount: 10,
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
                childChunks: [
                    {
                        isGroup: false,
                        tokenCount: 3,
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
    const tokenizer = await CohereEnglishLightTokenizer.get();
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
            {tokenizer, getAccountIfExists},
        ),
    ).toEqual({
        isGroup: true,
        tokenCount: 314,
        childChunks: [
            {
                isGroup: false,
                tokenCount: 11,
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
                childChunks: [
                    {
                        isGroup: true,
                        tokenCount: 97,
                        childChunks: [
                            {
                                isGroup: false,
                                tokenCount: 5,
                                sentenceChunks: [{text: "1. Soil Health:", tokenCount: 5}],
                                lineMarginTop: 1,
                                lineMarginBottom: 1,
                            },
                            {
                                isGroup: false,
                                tokenCount: 24,
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
                                childChunks: [
                                    {
                                        isGroup: false,
                                        tokenCount: 5,
                                        sentenceChunks: [
                                            {text: "  3. Water Conservation:", tokenCount: 5},
                                        ],
                                        lineMarginTop: 1,
                                        lineMarginBottom: 1,
                                    },
                                    {
                                        isGroup: false,
                                        tokenCount: 20,
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
                        childChunks: [
                            {
                                isGroup: false,
                                tokenCount: 5,
                                sentenceChunks: [{text: "2. Cost Reduction:", tokenCount: 5}],
                                lineMarginTop: 1,
                                lineMarginBottom: 1,
                            },
                            {
                                isGroup: false,
                                tokenCount: 25,
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
                childChunks: [
                    {
                        isGroup: false,
                        tokenCount: 20,
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

test("discovers quote block structure", async () => {
    const tokenizer = await CohereEnglishLightTokenizer.get();
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
            {tokenizer, getAccountIfExists},
        ),
    ).toEqual({
        isGroup: true,
        tokenCount: 619,
        childChunks: [
            {
                isGroup: false,
                tokenCount: 192,
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
    const tokenizer = await CohereEnglishLightTokenizer.get();
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
            {tokenizer, getAccountIfExists},
        ),
    ).toEqual({
        isGroup: true,
        tokenCount: 215,
        childChunks: [
            {
                isGroup: false,
                tokenCount: 192,
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
    const tokenizer = await CohereEnglishLightTokenizer.get();
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
            {tokenizer, getAccountIfExists},
        ),
    ).toEqual({
        isGroup: false,
        tokenCount: 167,
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
    const tokenizer = await CohereEnglishLightTokenizer.get();
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
            {tokenizer, getAccountIfExists},
        ),
    ).toEqual({
        isGroup: false,
        tokenCount: 172,
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
    const tokenizer = await CohereEnglishLightTokenizer.get();
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
            {tokenizer, getAccountIfExists},
        ),
    ).toEqual({
        isGroup: false,
        tokenCount: 60,
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

    const tokenizer = await CohereEnglishLightTokenizer.get();

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
                tokenizer,
                getAccountIfExists: accountId =>
                    getAccountIfExists(session.action(), space.id, accountId),
            },
        ),
    ).toEqual({
        isGroup: true,
        tokenCount: 10,
        childChunks: [
            {
                isGroup: false,
                tokenCount: 4,
                sentenceChunks: [{text: "hello @Caleb Meredith", tokenCount: 4}],
                lineMarginTop: 2,
                lineMarginBottom: 2,
            },
            {
                isGroup: false,
                tokenCount: 3,
                sentenceChunks: [{text: "hello @Caleb", tokenCount: 3}],
                lineMarginTop: 2,
                lineMarginBottom: 2,
            },
            {
                isGroup: false,
                tokenCount: 3,
                sentenceChunks: [{text: "hello @Unknown", tokenCount: 3}],
                lineMarginTop: 2,
                lineMarginBottom: 2,
            },
        ],
    });
});
