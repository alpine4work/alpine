/* eslint-disable react/jsx-key */

import {
    VirtualizedScrollViewState,
    withRealVirtualizationWindowHeightForTest,
} from "~/client/web/virtualized/virtualized_scroll_view_state.js";
import {createArrayWithLength} from "~/shared/helpers/array/create_array_with_length.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {StableRandom} from "~/shared/helpers/number/stable_random.js";
import {omitObject} from "~/shared/helpers/object/omit_object.js";

function stableShuffleArray<Item>(
    stableRandom: StableRandom,
    keyString: string,
    array: Array<Item>,
): Array<Item> {
    let currentIndex = array.length;
    let randomIndex;

    while (currentIndex !== 0) {
        randomIndex = stableRandom.randomInteger(keyString, currentIndex, 0, currentIndex);
        currentIndex--;

        const randomItem = array[randomIndex]!;
        const currentItem = array[currentIndex]!;

        array[currentIndex] = randomItem;
        array[randomIndex] = currentItem;
    }

    return array;
}

test("can render an empty list", () => {
    const itemCount = 0;
    const getItem = (index: number) => ({
        key: index,
        minHeight: 10,
        render: ({offset}: {offset: number}) => <div style={{top: offset}}>{String(index)}</div>,
    });

    const state = VirtualizedScrollViewState.initializeFromTop({
        initialViewHeight: 100,
        bufferedItemHeight: 10,
        itemCount,
        getItem,
    });

    expect(
        omitObject(
            state.render({
                itemCount,
                getItem,
            }),
            ["state", "renderedRange"],
        ),
    ).toEqual({
        children: null,
        contentHeight: 0,
        bufferedHeightBeforeChildren: 0,
    });
});

test("can scroll from top", () => {
    const itemCount = 1_000;
    const getItem = (index: number) => ({
        key: index,
        minHeight: 10,
        render: ({offset}: {offset: number}) => <div style={{top: offset}}>{String(index)}</div>,
    });

    let state = VirtualizedScrollViewState.initializeFromTop({
        initialViewHeight: 100,
        bufferedItemHeight: 10,
        itemCount,
        getItem,
    });

    expect(
        omitObject(
            state.render({
                itemCount,
                getItem,
            }),
            ["state", "renderedRange"],
        ),
    ).toEqual({
        children: [
            <div style={{top: 0}}>0</div>,
            <div style={{top: 10}}>1</div>,
            <div style={{top: 20}}>2</div>,
            <div style={{top: 30}}>3</div>,
            <div style={{top: 40}}>4</div>,
            <div style={{top: 50}}>5</div>,
            <div style={{top: 60}}>6</div>,
            <div style={{top: 70}}>7</div>,
            <div style={{top: 80}}>8</div>,
            <div style={{top: 90}}>9</div>,
            <div style={{top: 100}}>10</div>,
            <div style={{top: 110}}>11</div>,
            <div style={{top: 120}}>12</div>,
            <div style={{top: 130}}>13</div>,
            <div style={{top: 140}}>14</div>,
            <div style={{top: 150}}>15</div>,
            <div style={{top: 160}}>16</div>,
            <div style={{top: 170}}>17</div>,
            <div style={{top: 180}}>18</div>,
            <div style={{top: 190}}>19</div>,
        ],
        contentHeight: 10_000,
        bufferedHeightBeforeChildren: 0,
    });

    state = state.updateRenderedRange({
        scrollOffset: 5,
        itemCount,
        getItem,
    });

    expect(
        omitObject(
            state.render({
                itemCount,
                getItem,
            }),
            ["state", "renderedRange"],
        ),
    ).toEqual({
        children: [
            <div style={{top: 0}}>0</div>,
            <div style={{top: 10}}>1</div>,
            <div style={{top: 20}}>2</div>,
            <div style={{top: 30}}>3</div>,
            <div style={{top: 40}}>4</div>,
            <div style={{top: 50}}>5</div>,
            <div style={{top: 60}}>6</div>,
            <div style={{top: 70}}>7</div>,
            <div style={{top: 80}}>8</div>,
            <div style={{top: 90}}>9</div>,
            <div style={{top: 100}}>10</div>,
            <div style={{top: 110}}>11</div>,
            <div style={{top: 120}}>12</div>,
            <div style={{top: 130}}>13</div>,
            <div style={{top: 140}}>14</div>,
            <div style={{top: 150}}>15</div>,
            <div style={{top: 160}}>16</div>,
            <div style={{top: 170}}>17</div>,
            <div style={{top: 180}}>18</div>,
            <div style={{top: 190}}>19</div>,
        ],
        contentHeight: 10_000,
        bufferedHeightBeforeChildren: 0,
    });

    state = state.updateRenderedRange({
        scrollOffset: 50,
        itemCount,
        getItem,
    });

    expect(
        omitObject(
            state.render({
                itemCount,
                getItem,
            }),
            ["state", "renderedRange"],
        ),
    ).toEqual({
        children: [
            <div style={{top: 0}}>0</div>,
            <div style={{top: 10}}>1</div>,
            <div style={{top: 20}}>2</div>,
            <div style={{top: 30}}>3</div>,
            <div style={{top: 40}}>4</div>,
            <div style={{top: 50}}>5</div>,
            <div style={{top: 60}}>6</div>,
            <div style={{top: 70}}>7</div>,
            <div style={{top: 80}}>8</div>,
            <div style={{top: 90}}>9</div>,
            <div style={{top: 100}}>10</div>,
            <div style={{top: 110}}>11</div>,
            <div style={{top: 120}}>12</div>,
            <div style={{top: 130}}>13</div>,
            <div style={{top: 140}}>14</div>,
            <div style={{top: 150}}>15</div>,
            <div style={{top: 160}}>16</div>,
            <div style={{top: 170}}>17</div>,
            <div style={{top: 180}}>18</div>,
            <div style={{top: 190}}>19</div>,
        ],
        contentHeight: 10_000,
        bufferedHeightBeforeChildren: 0,
    });

    state = state.updateRenderedRange({
        scrollOffset: 55,
        itemCount,
        getItem,
    });

    expect(
        omitObject(
            state.render({
                itemCount,
                getItem,
            }),
            ["state", "renderedRange"],
        ),
    ).toEqual({
        children: [
            <div style={{top: 0}}>0</div>,
            <div style={{top: 10}}>1</div>,
            <div style={{top: 20}}>2</div>,
            <div style={{top: 30}}>3</div>,
            <div style={{top: 40}}>4</div>,
            <div style={{top: 50}}>5</div>,
            <div style={{top: 60}}>6</div>,
            <div style={{top: 70}}>7</div>,
            <div style={{top: 80}}>8</div>,
            <div style={{top: 90}}>9</div>,
            <div style={{top: 100}}>10</div>,
            <div style={{top: 110}}>11</div>,
            <div style={{top: 120}}>12</div>,
            <div style={{top: 130}}>13</div>,
            <div style={{top: 140}}>14</div>,
            <div style={{top: 150}}>15</div>,
            <div style={{top: 160}}>16</div>,
            <div style={{top: 170}}>17</div>,
            <div style={{top: 180}}>18</div>,
            <div style={{top: 190}}>19</div>,
            <div style={{top: 200}}>20</div>,
        ],
        contentHeight: 10_000,
        bufferedHeightBeforeChildren: 0,
    });

    state = state.updateRenderedRange({
        scrollOffset: 60,
        itemCount,
        getItem,
    });

    expect(
        omitObject(
            state.render({
                itemCount,
                getItem,
            }),
            ["state", "renderedRange"],
        ),
    ).toEqual({
        children: [
            <div style={{top: 0}}>0</div>,
            <div style={{top: 10}}>1</div>,
            <div style={{top: 20}}>2</div>,
            <div style={{top: 30}}>3</div>,
            <div style={{top: 40}}>4</div>,
            <div style={{top: 50}}>5</div>,
            <div style={{top: 60}}>6</div>,
            <div style={{top: 70}}>7</div>,
            <div style={{top: 80}}>8</div>,
            <div style={{top: 90}}>9</div>,
            <div style={{top: 100}}>10</div>,
            <div style={{top: 110}}>11</div>,
            <div style={{top: 120}}>12</div>,
            <div style={{top: 130}}>13</div>,
            <div style={{top: 140}}>14</div>,
            <div style={{top: 150}}>15</div>,
            <div style={{top: 160}}>16</div>,
            <div style={{top: 170}}>17</div>,
            <div style={{top: 180}}>18</div>,
            <div style={{top: 190}}>19</div>,
            <div style={{top: 200}}>20</div>,
        ],
        contentHeight: 10_000,
        bufferedHeightBeforeChildren: 0,
    });

    state = state.updateRenderedRange({
        scrollOffset: 65,
        itemCount,
        getItem,
    });

    expect(
        omitObject(
            state.render({
                itemCount,
                getItem,
            }),
            ["state", "renderedRange"],
        ),
    ).toEqual({
        children: [
            <div style={{top: 10}}>1</div>,
            <div style={{top: 20}}>2</div>,
            <div style={{top: 30}}>3</div>,
            <div style={{top: 40}}>4</div>,
            <div style={{top: 50}}>5</div>,
            <div style={{top: 60}}>6</div>,
            <div style={{top: 70}}>7</div>,
            <div style={{top: 80}}>8</div>,
            <div style={{top: 90}}>9</div>,
            <div style={{top: 100}}>10</div>,
            <div style={{top: 110}}>11</div>,
            <div style={{top: 120}}>12</div>,
            <div style={{top: 130}}>13</div>,
            <div style={{top: 140}}>14</div>,
            <div style={{top: 150}}>15</div>,
            <div style={{top: 160}}>16</div>,
            <div style={{top: 170}}>17</div>,
            <div style={{top: 180}}>18</div>,
            <div style={{top: 190}}>19</div>,
            <div style={{top: 200}}>20</div>,
            <div style={{top: 210}}>21</div>,
        ],
        contentHeight: 10_000,
        bufferedHeightBeforeChildren: 10,
    });

    state = state.updateRenderedRange({
        scrollOffset: 200,
        itemCount,
        getItem,
    });

    expect(
        omitObject(
            state.render({
                itemCount,
                getItem,
            }),
            ["state", "renderedRange"],
        ),
    ).toEqual({
        children: [
            <div style={{top: 150}}>15</div>,
            <div style={{top: 160}}>16</div>,
            <div style={{top: 170}}>17</div>,
            <div style={{top: 180}}>18</div>,
            <div style={{top: 190}}>19</div>,
            <div style={{top: 200}}>20</div>,
            <div style={{top: 210}}>21</div>,
            <div style={{top: 220}}>22</div>,
            <div style={{top: 230}}>23</div>,
            <div style={{top: 240}}>24</div>,
            <div style={{top: 250}}>25</div>,
            <div style={{top: 260}}>26</div>,
            <div style={{top: 270}}>27</div>,
            <div style={{top: 280}}>28</div>,
            <div style={{top: 290}}>29</div>,
            <div style={{top: 300}}>30</div>,
            <div style={{top: 310}}>31</div>,
            <div style={{top: 320}}>32</div>,
            <div style={{top: 330}}>33</div>,
            <div style={{top: 340}}>34</div>,
        ],
        contentHeight: 10_000,
        bufferedHeightBeforeChildren: 150,
    });

    state = state.updateRenderedRange({
        scrollOffset: 0,
        itemCount,
        getItem,
    });

    expect(
        omitObject(
            state.render({
                itemCount,
                getItem,
            }),
            ["state", "renderedRange"],
        ),
    ).toEqual({
        children: [
            <div style={{top: 0}}>0</div>,
            <div style={{top: 10}}>1</div>,
            <div style={{top: 20}}>2</div>,
            <div style={{top: 30}}>3</div>,
            <div style={{top: 40}}>4</div>,
            <div style={{top: 50}}>5</div>,
            <div style={{top: 60}}>6</div>,
            <div style={{top: 70}}>7</div>,
            <div style={{top: 80}}>8</div>,
            <div style={{top: 90}}>9</div>,
            <div style={{top: 100}}>10</div>,
            <div style={{top: 110}}>11</div>,
            <div style={{top: 120}}>12</div>,
            <div style={{top: 130}}>13</div>,
            <div style={{top: 140}}>14</div>,
            <div style={{top: 150}}>15</div>,
        ],
        contentHeight: 10_000,
        bufferedHeightBeforeChildren: 0,
    });
});

test("can scroll from end", () => {
    const itemCount = 1_000;
    const getItem = (index: number) => ({
        key: index,
        minHeight: 10,
        render: ({offset}: {offset: number}) => <div style={{top: offset}}>{String(index)}</div>,
    });

    let state = VirtualizedScrollViewState.initializeFromBottom({
        initialViewHeight: 100,
        bufferedItemHeight: 10,
        itemCount,
        getItem,
    });

    expect(
        omitObject(
            state.render({
                itemCount,
                getItem,
            }),
            ["state", "renderedRange"],
        ),
    ).toEqual({
        children: [
            <div style={{top: 9800}}>980</div>,
            <div style={{top: 9810}}>981</div>,
            <div style={{top: 9820}}>982</div>,
            <div style={{top: 9830}}>983</div>,
            <div style={{top: 9840}}>984</div>,
            <div style={{top: 9850}}>985</div>,
            <div style={{top: 9860}}>986</div>,
            <div style={{top: 9870}}>987</div>,
            <div style={{top: 9880}}>988</div>,
            <div style={{top: 9890}}>989</div>,
            <div style={{top: 9900}}>990</div>,
            <div style={{top: 9910}}>991</div>,
            <div style={{top: 9920}}>992</div>,
            <div style={{top: 9930}}>993</div>,
            <div style={{top: 9940}}>994</div>,
            <div style={{top: 9950}}>995</div>,
            <div style={{top: 9960}}>996</div>,
            <div style={{top: 9970}}>997</div>,
            <div style={{top: 9980}}>998</div>,
            <div style={{top: 9990}}>999</div>,
        ],
        contentHeight: 10_000,
        bufferedHeightBeforeChildren: 9800,
    });

    const maxScrollOffset = 9_900;

    state = state.updateRenderedRange({
        scrollOffset: maxScrollOffset - 5,
        itemCount,
        getItem,
    });

    expect(
        omitObject(
            state.render({
                itemCount,
                getItem,
            }),
            ["state", "renderedRange"],
        ),
    ).toEqual({
        children: [
            <div style={{top: 9800}}>980</div>,
            <div style={{top: 9810}}>981</div>,
            <div style={{top: 9820}}>982</div>,
            <div style={{top: 9830}}>983</div>,
            <div style={{top: 9840}}>984</div>,
            <div style={{top: 9850}}>985</div>,
            <div style={{top: 9860}}>986</div>,
            <div style={{top: 9870}}>987</div>,
            <div style={{top: 9880}}>988</div>,
            <div style={{top: 9890}}>989</div>,
            <div style={{top: 9900}}>990</div>,
            <div style={{top: 9910}}>991</div>,
            <div style={{top: 9920}}>992</div>,
            <div style={{top: 9930}}>993</div>,
            <div style={{top: 9940}}>994</div>,
            <div style={{top: 9950}}>995</div>,
            <div style={{top: 9960}}>996</div>,
            <div style={{top: 9970}}>997</div>,
            <div style={{top: 9980}}>998</div>,
            <div style={{top: 9990}}>999</div>,
        ],
        contentHeight: 10_000,
        bufferedHeightBeforeChildren: 9800,
    });

    state = state.updateRenderedRange({
        scrollOffset: maxScrollOffset - 50,
        itemCount,
        getItem,
    });

    expect(
        omitObject(
            state.render({
                itemCount,
                getItem,
            }),
            ["state", "renderedRange"],
        ),
    ).toEqual({
        children: [
            <div style={{top: 9800}}>980</div>,
            <div style={{top: 9810}}>981</div>,
            <div style={{top: 9820}}>982</div>,
            <div style={{top: 9830}}>983</div>,
            <div style={{top: 9840}}>984</div>,
            <div style={{top: 9850}}>985</div>,
            <div style={{top: 9860}}>986</div>,
            <div style={{top: 9870}}>987</div>,
            <div style={{top: 9880}}>988</div>,
            <div style={{top: 9890}}>989</div>,
            <div style={{top: 9900}}>990</div>,
            <div style={{top: 9910}}>991</div>,
            <div style={{top: 9920}}>992</div>,
            <div style={{top: 9930}}>993</div>,
            <div style={{top: 9940}}>994</div>,
            <div style={{top: 9950}}>995</div>,
            <div style={{top: 9960}}>996</div>,
            <div style={{top: 9970}}>997</div>,
            <div style={{top: 9980}}>998</div>,
            <div style={{top: 9990}}>999</div>,
        ],
        contentHeight: 10_000,
        bufferedHeightBeforeChildren: 9800,
    });

    state = state.updateRenderedRange({
        scrollOffset: maxScrollOffset - 55,
        itemCount,
        getItem,
    });

    expect(
        omitObject(
            state.render({
                itemCount,
                getItem,
            }),
            ["state", "renderedRange"],
        ),
    ).toEqual({
        children: [
            <div style={{top: 9790}}>979</div>,
            <div style={{top: 9800}}>980</div>,
            <div style={{top: 9810}}>981</div>,
            <div style={{top: 9820}}>982</div>,
            <div style={{top: 9830}}>983</div>,
            <div style={{top: 9840}}>984</div>,
            <div style={{top: 9850}}>985</div>,
            <div style={{top: 9860}}>986</div>,
            <div style={{top: 9870}}>987</div>,
            <div style={{top: 9880}}>988</div>,
            <div style={{top: 9890}}>989</div>,
            <div style={{top: 9900}}>990</div>,
            <div style={{top: 9910}}>991</div>,
            <div style={{top: 9920}}>992</div>,
            <div style={{top: 9930}}>993</div>,
            <div style={{top: 9940}}>994</div>,
            <div style={{top: 9950}}>995</div>,
            <div style={{top: 9960}}>996</div>,
            <div style={{top: 9970}}>997</div>,
            <div style={{top: 9980}}>998</div>,
            <div style={{top: 9990}}>999</div>,
        ],
        contentHeight: 10_000,
        bufferedHeightBeforeChildren: 9790,
    });

    state = state.updateRenderedRange({
        scrollOffset: maxScrollOffset - 60,
        itemCount,
        getItem,
    });

    expect(
        omitObject(
            state.render({
                itemCount,
                getItem,
            }),
            ["state", "renderedRange"],
        ),
    ).toEqual({
        children: [
            <div style={{top: 9790}}>979</div>,
            <div style={{top: 9800}}>980</div>,
            <div style={{top: 9810}}>981</div>,
            <div style={{top: 9820}}>982</div>,
            <div style={{top: 9830}}>983</div>,
            <div style={{top: 9840}}>984</div>,
            <div style={{top: 9850}}>985</div>,
            <div style={{top: 9860}}>986</div>,
            <div style={{top: 9870}}>987</div>,
            <div style={{top: 9880}}>988</div>,
            <div style={{top: 9890}}>989</div>,
            <div style={{top: 9900}}>990</div>,
            <div style={{top: 9910}}>991</div>,
            <div style={{top: 9920}}>992</div>,
            <div style={{top: 9930}}>993</div>,
            <div style={{top: 9940}}>994</div>,
            <div style={{top: 9950}}>995</div>,
            <div style={{top: 9960}}>996</div>,
            <div style={{top: 9970}}>997</div>,
            <div style={{top: 9980}}>998</div>,
            <div style={{top: 9990}}>999</div>,
        ],
        contentHeight: 10_000,
        bufferedHeightBeforeChildren: 9790,
    });

    state = state.updateRenderedRange({
        scrollOffset: maxScrollOffset - 65,
        itemCount,
        getItem,
    });

    expect(
        omitObject(
            state.render({
                itemCount,
                getItem,
            }),
            ["state", "renderedRange"],
        ),
    ).toEqual({
        children: [
            <div style={{top: 9780}}>978</div>,
            <div style={{top: 9790}}>979</div>,
            <div style={{top: 9800}}>980</div>,
            <div style={{top: 9810}}>981</div>,
            <div style={{top: 9820}}>982</div>,
            <div style={{top: 9830}}>983</div>,
            <div style={{top: 9840}}>984</div>,
            <div style={{top: 9850}}>985</div>,
            <div style={{top: 9860}}>986</div>,
            <div style={{top: 9870}}>987</div>,
            <div style={{top: 9880}}>988</div>,
            <div style={{top: 9890}}>989</div>,
            <div style={{top: 9900}}>990</div>,
            <div style={{top: 9910}}>991</div>,
            <div style={{top: 9920}}>992</div>,
            <div style={{top: 9930}}>993</div>,
            <div style={{top: 9940}}>994</div>,
            <div style={{top: 9950}}>995</div>,
            <div style={{top: 9960}}>996</div>,
            <div style={{top: 9970}}>997</div>,
            <div style={{top: 9980}}>998</div>,
        ],
        contentHeight: 10_000,
        bufferedHeightBeforeChildren: 9780,
    });

    state = state.updateRenderedRange({
        scrollOffset: maxScrollOffset - 200,
        itemCount,
        getItem,
    });

    expect(
        omitObject(
            state.render({
                itemCount,
                getItem,
            }),
            ["state", "renderedRange"],
        ),
    ).toEqual({
        children: [
            <div style={{top: 9650}}>965</div>,
            <div style={{top: 9660}}>966</div>,
            <div style={{top: 9670}}>967</div>,
            <div style={{top: 9680}}>968</div>,
            <div style={{top: 9690}}>969</div>,
            <div style={{top: 9700}}>970</div>,
            <div style={{top: 9710}}>971</div>,
            <div style={{top: 9720}}>972</div>,
            <div style={{top: 9730}}>973</div>,
            <div style={{top: 9740}}>974</div>,
            <div style={{top: 9750}}>975</div>,
            <div style={{top: 9760}}>976</div>,
            <div style={{top: 9770}}>977</div>,
            <div style={{top: 9780}}>978</div>,
            <div style={{top: 9790}}>979</div>,
            <div style={{top: 9800}}>980</div>,
            <div style={{top: 9810}}>981</div>,
            <div style={{top: 9820}}>982</div>,
            <div style={{top: 9830}}>983</div>,
            <div style={{top: 9840}}>984</div>,
        ],
        contentHeight: 10_000,
        bufferedHeightBeforeChildren: 9650,
    });

    state = state.updateRenderedRange({
        scrollOffset: maxScrollOffset - 0,
        itemCount,
        getItem,
    });

    expect(
        omitObject(
            state.render({
                itemCount,
                getItem,
            }),
            ["state", "renderedRange"],
        ),
    ).toEqual({
        children: [
            <div style={{top: 9840}}>984</div>,
            <div style={{top: 9850}}>985</div>,
            <div style={{top: 9860}}>986</div>,
            <div style={{top: 9870}}>987</div>,
            <div style={{top: 9880}}>988</div>,
            <div style={{top: 9890}}>989</div>,
            <div style={{top: 9900}}>990</div>,
            <div style={{top: 9910}}>991</div>,
            <div style={{top: 9920}}>992</div>,
            <div style={{top: 9930}}>993</div>,
            <div style={{top: 9940}}>994</div>,
            <div style={{top: 9950}}>995</div>,
            <div style={{top: 9960}}>996</div>,
            <div style={{top: 9970}}>997</div>,
            <div style={{top: 9980}}>998</div>,
            <div style={{top: 9990}}>999</div>,
        ],
        contentHeight: 10_000,
        bufferedHeightBeforeChildren: 9840,
    });
});

test("can change the view height", () => {
    const itemCount = 1_000;
    const getItem = (index: number) => ({
        key: index,
        minHeight: 10,
        render: ({offset}: {offset: number}) => <div style={{top: offset}}>{String(index)}</div>,
    });

    let state = VirtualizedScrollViewState.initializeFromTop({
        initialViewHeight: 100,
        bufferedItemHeight: 10,
        itemCount,
        getItem,
    });

    state = state.updateRenderedRange({
        scrollOffset: 200,
        itemCount,
        getItem,
    });

    expect(
        omitObject(
            state.render({
                itemCount,
                getItem,
            }),
            ["state", "renderedRange"],
        ),
    ).toEqual({
        children: [
            <div style={{top: 150}}>15</div>,
            <div style={{top: 160}}>16</div>,
            <div style={{top: 170}}>17</div>,
            <div style={{top: 180}}>18</div>,
            <div style={{top: 190}}>19</div>,
            <div style={{top: 200}}>20</div>,
            <div style={{top: 210}}>21</div>,
            <div style={{top: 220}}>22</div>,
            <div style={{top: 230}}>23</div>,
            <div style={{top: 240}}>24</div>,
            <div style={{top: 250}}>25</div>,
            <div style={{top: 260}}>26</div>,
            <div style={{top: 270}}>27</div>,
            <div style={{top: 280}}>28</div>,
            <div style={{top: 290}}>29</div>,
            <div style={{top: 300}}>30</div>,
            <div style={{top: 310}}>31</div>,
            <div style={{top: 320}}>32</div>,
            <div style={{top: 330}}>33</div>,
            <div style={{top: 340}}>34</div>,
        ],
        contentHeight: 10_000,
        bufferedHeightBeforeChildren: 150,
    });

    expect(state.setViewHeight(100)).toBe(state);
    expect(state.setViewHeight(50)).not.toBe(state);

    state = state.setViewHeight(50);

    expect(state.setViewHeight(50)).toBe(state);

    expect(
        omitObject(
            state.render({
                itemCount,
                getItem,
            }),
            ["state", "renderedRange"],
        ),
    ).toEqual({
        children: [
            <div style={{top: 150}}>15</div>,
            <div style={{top: 160}}>16</div>,
            <div style={{top: 170}}>17</div>,
            <div style={{top: 180}}>18</div>,
            <div style={{top: 190}}>19</div>,
            <div style={{top: 200}}>20</div>,
            <div style={{top: 210}}>21</div>,
            <div style={{top: 220}}>22</div>,
            <div style={{top: 230}}>23</div>,
            <div style={{top: 240}}>24</div>,
            <div style={{top: 250}}>25</div>,
            <div style={{top: 260}}>26</div>,
            <div style={{top: 270}}>27</div>,
            <div style={{top: 280}}>28</div>,
            <div style={{top: 290}}>29</div>,
            <div style={{top: 300}}>30</div>,
            <div style={{top: 310}}>31</div>,
            <div style={{top: 320}}>32</div>,
            <div style={{top: 330}}>33</div>,
            <div style={{top: 340}}>34</div>,
        ],
        contentHeight: 10_000,
        bufferedHeightBeforeChildren: 150,
    });

    state = state.updateRenderedRange({
        scrollOffset: 200,
        itemCount,
        getItem,
    });

    expect(
        omitObject(
            state.render({
                itemCount,
                getItem,
            }),
            ["state", "renderedRange"],
        ),
    ).toEqual({
        children: [
            <div style={{top: 150}}>15</div>,
            <div style={{top: 160}}>16</div>,
            <div style={{top: 170}}>17</div>,
            <div style={{top: 180}}>18</div>,
            <div style={{top: 190}}>19</div>,
            <div style={{top: 200}}>20</div>,
            <div style={{top: 210}}>21</div>,
            <div style={{top: 220}}>22</div>,
            <div style={{top: 230}}>23</div>,
            <div style={{top: 240}}>24</div>,
            <div style={{top: 250}}>25</div>,
            <div style={{top: 260}}>26</div>,
            <div style={{top: 270}}>27</div>,
            <div style={{top: 280}}>28</div>,
            <div style={{top: 290}}>29</div>,
            <div style={{top: 300}}>30</div>,
            <div style={{top: 310}}>31</div>,
            <div style={{top: 320}}>32</div>,
            <div style={{top: 330}}>33</div>,
            <div style={{top: 340}}>34</div>,
        ],
        contentHeight: 10_000,
        bufferedHeightBeforeChildren: 150,
    });

    state = state.updateRenderedRange({
        scrollOffset: 300,
        itemCount,
        getItem,
    });

    expect(
        omitObject(
            state.render({
                itemCount,
                getItem,
            }),
            ["state", "renderedRange"],
        ),
    ).toEqual({
        children: [
            <div style={{top: 270}}>27</div>,
            <div style={{top: 280}}>28</div>,
            <div style={{top: 290}}>29</div>,
            <div style={{top: 300}}>30</div>,
            <div style={{top: 310}}>31</div>,
            <div style={{top: 320}}>32</div>,
            <div style={{top: 330}}>33</div>,
            <div style={{top: 340}}>34</div>,
            <div style={{top: 350}}>35</div>,
            <div style={{top: 360}}>36</div>,
            <div style={{top: 370}}>37</div>,
        ],
        contentHeight: 10_000,
        bufferedHeightBeforeChildren: 270,
    });

    state = state.setViewHeight(200);

    expect(
        omitObject(
            state.render({
                itemCount,
                getItem,
            }),
            ["state", "renderedRange"],
        ),
    ).toEqual({
        children: [
            <div style={{top: 270}}>27</div>,
            <div style={{top: 280}}>28</div>,
            <div style={{top: 290}}>29</div>,
            <div style={{top: 300}}>30</div>,
            <div style={{top: 310}}>31</div>,
            <div style={{top: 320}}>32</div>,
            <div style={{top: 330}}>33</div>,
            <div style={{top: 340}}>34</div>,
            <div style={{top: 350}}>35</div>,
            <div style={{top: 360}}>36</div>,
            <div style={{top: 370}}>37</div>,
        ],
        contentHeight: 10_000,
        bufferedHeightBeforeChildren: 270,
    });

    state = state.updateRenderedRange({
        scrollOffset: 300,
        itemCount,
        getItem,
    });

    expect(
        omitObject(
            state.render({
                itemCount,
                getItem,
            }),
            ["state", "renderedRange"],
        ),
    ).toEqual({
        children: [
            <div style={{top: 200}}>20</div>,
            <div style={{top: 210}}>21</div>,
            <div style={{top: 220}}>22</div>,
            <div style={{top: 230}}>23</div>,
            <div style={{top: 240}}>24</div>,
            <div style={{top: 250}}>25</div>,
            <div style={{top: 260}}>26</div>,
            <div style={{top: 270}}>27</div>,
            <div style={{top: 280}}>28</div>,
            <div style={{top: 290}}>29</div>,
            <div style={{top: 300}}>30</div>,
            <div style={{top: 310}}>31</div>,
            <div style={{top: 320}}>32</div>,
            <div style={{top: 330}}>33</div>,
            <div style={{top: 340}}>34</div>,
            <div style={{top: 350}}>35</div>,
            <div style={{top: 360}}>36</div>,
            <div style={{top: 370}}>37</div>,
            <div style={{top: 380}}>38</div>,
            <div style={{top: 390}}>39</div>,
            <div style={{top: 400}}>40</div>,
            <div style={{top: 410}}>41</div>,
            <div style={{top: 420}}>42</div>,
            <div style={{top: 430}}>43</div>,
            <div style={{top: 440}}>44</div>,
            <div style={{top: 450}}>45</div>,
            <div style={{top: 460}}>46</div>,
            <div style={{top: 470}}>47</div>,
            <div style={{top: 480}}>48</div>,
            <div style={{top: 490}}>49</div>,
            <div style={{top: 500}}>50</div>,
            <div style={{top: 510}}>51</div>,
            <div style={{top: 520}}>52</div>,
            <div style={{top: 530}}>53</div>,
            <div style={{top: 540}}>54</div>,
            <div style={{top: 550}}>55</div>,
            <div style={{top: 560}}>56</div>,
            <div style={{top: 570}}>57</div>,
            <div style={{top: 580}}>58</div>,
            <div style={{top: 590}}>59</div>,
        ],
        contentHeight: 10_000,
        bufferedHeightBeforeChildren: 200,
    });
});

test("can change the buffered item height", () => {
    const itemCount = 1000;
    const getItem = (index: number) => ({
        key: index,
        minHeight: 10,
        render: ({offset}: {offset: number}) => <div style={{top: offset}}>{String(index)}</div>,
    });

    let state = VirtualizedScrollViewState.initializeFromBottom({
        initialViewHeight: 100,
        bufferedItemHeight: 10,
        itemCount,
        getItem,
    });

    state = state.updateRenderedRange({
        scrollOffset: 10000 - 100 - 200,
        itemCount,
        getItem,
    });
    state = state.updateRenderedRange({
        scrollOffset: 10000 - 100 - 400,
        itemCount,
        getItem,
    });

    expect(
        omitObject(
            state.render({
                itemCount,
                getItem,
            }),
            ["state", "renderedRange"],
        ),
    ).toEqual({
        children: [
            <div style={{top: 9450}}>945</div>,
            <div style={{top: 9460}}>946</div>,
            <div style={{top: 9470}}>947</div>,
            <div style={{top: 9480}}>948</div>,
            <div style={{top: 9490}}>949</div>,
            <div style={{top: 9500}}>950</div>,
            <div style={{top: 9510}}>951</div>,
            <div style={{top: 9520}}>952</div>,
            <div style={{top: 9530}}>953</div>,
            <div style={{top: 9540}}>954</div>,
            <div style={{top: 9550}}>955</div>,
            <div style={{top: 9560}}>956</div>,
            <div style={{top: 9570}}>957</div>,
            <div style={{top: 9580}}>958</div>,
            <div style={{top: 9590}}>959</div>,
            <div style={{top: 9600}}>960</div>,
            <div style={{top: 9610}}>961</div>,
            <div style={{top: 9620}}>962</div>,
            <div style={{top: 9630}}>963</div>,
            <div style={{top: 9640}}>964</div>,
            <div style={{top: 9650}}>965</div>,
        ],
        contentHeight: 10000,
        bufferedHeightBeforeChildren: 9450,
    });

    expect(state.setBufferedItemHeight(10)).toBe(state);
    expect(state.setBufferedItemHeight(5)).not.toBe(state);

    state = state.setBufferedItemHeight(5);

    expect(state.setBufferedItemHeight(5)).toBe(state);

    expect(
        omitObject(
            state.render({
                itemCount,
                getItem,
            }),
            ["state", "renderedRange"],
        ),
    ).toEqual({
        children: [
            <div style={{top: 9450 - 4725}}>945</div>,
            <div style={{top: 9460 - 4725}}>946</div>,
            <div style={{top: 9470 - 4725}}>947</div>,
            <div style={{top: 9480 - 4725}}>948</div>,
            <div style={{top: 9490 - 4725}}>949</div>,
            <div style={{top: 9500 - 4725}}>950</div>,
            <div style={{top: 9510 - 4725}}>951</div>,
            <div style={{top: 9520 - 4725}}>952</div>,
            <div style={{top: 9530 - 4725}}>953</div>,
            <div style={{top: 9540 - 4725}}>954</div>,
            <div style={{top: 9550 - 4725}}>955</div>,
            <div style={{top: 9560 - 4725}}>956</div>,
            <div style={{top: 9570 - 4725}}>957</div>,
            <div style={{top: 9580 - 4725}}>958</div>,
            <div style={{top: 9590 - 4725}}>959</div>,
            <div style={{top: 9600 - 4725}}>960</div>,
            <div style={{top: 9610 - 4725}}>961</div>,
            <div style={{top: 9620 - 4725}}>962</div>,
            <div style={{top: 9630 - 4725}}>963</div>,
            <div style={{top: 9640 - 4725}}>964</div>,
            <div style={{top: 9650 - 4725}}>965</div>,
        ],
        contentHeight: 10000 - 4725,
        bufferedHeightBeforeChildren: 9450 - 4725,
    });

    state = state.updateRenderedRange({
        scrollOffset: 10000 - 4725 - 100 - 400,
        itemCount,
        getItem,
    });

    expect(
        omitObject(
            state.render({
                itemCount,
                getItem,
            }),
            ["state", "renderedRange"],
        ),
    ).toEqual({
        children: [
            <div style={{top: 9450 - 4725}}>945</div>,
            <div style={{top: 9460 - 4725}}>946</div>,
            <div style={{top: 9470 - 4725}}>947</div>,
            <div style={{top: 9480 - 4725}}>948</div>,
            <div style={{top: 9490 - 4725}}>949</div>,
            <div style={{top: 9500 - 4725}}>950</div>,
            <div style={{top: 9510 - 4725}}>951</div>,
            <div style={{top: 9520 - 4725}}>952</div>,
            <div style={{top: 9530 - 4725}}>953</div>,
            <div style={{top: 9540 - 4725}}>954</div>,
            <div style={{top: 9550 - 4725}}>955</div>,
            <div style={{top: 9560 - 4725}}>956</div>,
            <div style={{top: 9570 - 4725}}>957</div>,
            <div style={{top: 9580 - 4725}}>958</div>,
            <div style={{top: 9590 - 4725}}>959</div>,
            <div style={{top: 9600 - 4725}}>960</div>,
            <div style={{top: 9610 - 4725}}>961</div>,
            <div style={{top: 9620 - 4725}}>962</div>,
            <div style={{top: 9630 - 4725}}>963</div>,
            <div style={{top: 9640 - 4725}}>964</div>,
            <div style={{top: 9650 - 4725}}>965</div>,
        ],
        contentHeight: 10000 - 4725,
        bufferedHeightBeforeChildren: 9450 - 4725,
    });

    state = state.updateRenderedRange({
        scrollOffset: 10000 - 4725 - 100 - 500,
        itemCount,
        getItem,
    });

    expect(
        omitObject(
            state.render({
                itemCount,
                getItem,
            }),
            ["state", "renderedRange"],
        ),
    ).toEqual({
        children: [
            <div style={{top: 9350 - 4675}}>935</div>,
            <div style={{top: 9360 - 4675}}>936</div>,
            <div style={{top: 9370 - 4675}}>937</div>,
            <div style={{top: 9380 - 4675}}>938</div>,
            <div style={{top: 9390 - 4675}}>939</div>,
            <div style={{top: 9400 - 4675}}>940</div>,
            <div style={{top: 9410 - 4675}}>941</div>,
            <div style={{top: 9420 - 4675}}>942</div>,
            <div style={{top: 9430 - 4675}}>943</div>,
            <div style={{top: 9440 - 4675}}>944</div>,
            <div style={{top: 9450 - 4675}}>945</div>,
            <div style={{top: 9460 - 4675}}>946</div>,
            <div style={{top: 9470 - 4675}}>947</div>,
            <div style={{top: 9480 - 4675}}>948</div>,
            <div style={{top: 9490 - 4675}}>949</div>,
            <div style={{top: 9500 - 4675}}>950</div>,
            <div style={{top: 9510 - 4675}}>951</div>,
            <div style={{top: 9520 - 4675}}>952</div>,
            <div style={{top: 9530 - 4675}}>953</div>,
            <div style={{top: 9540 - 4675}}>954</div>,
        ],
        contentHeight: 10000 - 4675,
        bufferedHeightBeforeChildren: 9350 - 4675,
    });

    state = state.setBufferedItemHeight(20);

    expect(
        omitObject(
            state.render({
                itemCount,
                getItem,
            }),
            ["state", "renderedRange"],
        ),
    ).toEqual({
        children: [
            <div style={{top: 9350 + 9350}}>935</div>,
            <div style={{top: 9360 + 9350}}>936</div>,
            <div style={{top: 9370 + 9350}}>937</div>,
            <div style={{top: 9380 + 9350}}>938</div>,
            <div style={{top: 9390 + 9350}}>939</div>,
            <div style={{top: 9400 + 9350}}>940</div>,
            <div style={{top: 9410 + 9350}}>941</div>,
            <div style={{top: 9420 + 9350}}>942</div>,
            <div style={{top: 9430 + 9350}}>943</div>,
            <div style={{top: 9440 + 9350}}>944</div>,
            <div style={{top: 9450 + 9350}}>945</div>,
            <div style={{top: 9460 + 9350}}>946</div>,
            <div style={{top: 9470 + 9350}}>947</div>,
            <div style={{top: 9480 + 9350}}>948</div>,
            <div style={{top: 9490 + 9350}}>949</div>,
            <div style={{top: 9500 + 9350}}>950</div>,
            <div style={{top: 9510 + 9350}}>951</div>,
            <div style={{top: 9520 + 9350}}>952</div>,
            <div style={{top: 9530 + 9350}}>953</div>,
            <div style={{top: 9540 + 9350}}>954</div>,
        ],
        contentHeight: 10000 + 9350,
        bufferedHeightBeforeChildren: 9350 + 9350,
    });

    state = state.updateRenderedRange({
        scrollOffset: 10000 + 9350 - 100 - 500,
        itemCount,
        getItem,
    });

    expect(
        omitObject(
            state.render({
                itemCount,
                getItem,
            }),
            ["state", "renderedRange"],
        ),
    ).toEqual({
        children: [
            <div style={{top: 9350 + 9350}}>935</div>,
            <div style={{top: 9360 + 9350}}>936</div>,
            <div style={{top: 9370 + 9350}}>937</div>,
            <div style={{top: 9380 + 9350}}>938</div>,
            <div style={{top: 9390 + 9350}}>939</div>,
            <div style={{top: 9400 + 9350}}>940</div>,
            <div style={{top: 9410 + 9350}}>941</div>,
            <div style={{top: 9420 + 9350}}>942</div>,
            <div style={{top: 9430 + 9350}}>943</div>,
            <div style={{top: 9440 + 9350}}>944</div>,
            <div style={{top: 9450 + 9350}}>945</div>,
            <div style={{top: 9460 + 9350}}>946</div>,
            <div style={{top: 9470 + 9350}}>947</div>,
            <div style={{top: 9480 + 9350}}>948</div>,
            <div style={{top: 9490 + 9350}}>949</div>,
            <div style={{top: 9500 + 9350}}>950</div>,
            <div style={{top: 9510 + 9350}}>951</div>,
            <div style={{top: 9520 + 9350}}>952</div>,
            <div style={{top: 9530 + 9350}}>953</div>,
            <div style={{top: 9540 + 9350}}>954</div>,
        ],
        contentHeight: 10000 + 9350,
        bufferedHeightBeforeChildren: 9350 + 9350,
    });

    state = state.updateRenderedRange({
        scrollOffset: 10000 + 9350 - 100 - 600,
        itemCount,
        getItem,
    });

    expect(
        omitObject(
            state.render({
                itemCount,
                getItem,
            }),
            ["state", "renderedRange"],
        ),
    ).toEqual({
        children: [
            <div style={{top: 9250 + 9250}}>925</div>,
            <div style={{top: 9260 + 9250}}>926</div>,
            <div style={{top: 9270 + 9250}}>927</div>,
            <div style={{top: 9280 + 9250}}>928</div>,
            <div style={{top: 9290 + 9250}}>929</div>,
            <div style={{top: 9300 + 9250}}>930</div>,
            <div style={{top: 9310 + 9250}}>931</div>,
            <div style={{top: 9320 + 9250}}>932</div>,
            <div style={{top: 9330 + 9250}}>933</div>,
            <div style={{top: 9340 + 9250}}>934</div>,
            <div style={{top: 9350 + 9250}}>935</div>,
            <div style={{top: 9360 + 9250}}>936</div>,
            <div style={{top: 9370 + 9250}}>937</div>,
            <div style={{top: 9380 + 9250}}>938</div>,
            <div style={{top: 9390 + 9250}}>939</div>,
            <div style={{top: 9400 + 9250}}>940</div>,
            <div style={{top: 9410 + 9250}}>941</div>,
            <div style={{top: 9420 + 9250}}>942</div>,
            <div style={{top: 9430 + 9250}}>943</div>,
            <div style={{top: 9440 + 9250}}>944</div>,
        ],
        contentHeight: 10000 + 9250,
        bufferedHeightBeforeChildren: 9250 + 9250,
    });

    state = state.setBufferedItemHeight(10);

    expect(
        omitObject(
            state.render({
                itemCount,
                getItem,
            }),
            ["state", "renderedRange"],
        ),
    ).toEqual({
        children: [
            <div style={{top: 9250}}>925</div>,
            <div style={{top: 9260}}>926</div>,
            <div style={{top: 9270}}>927</div>,
            <div style={{top: 9280}}>928</div>,
            <div style={{top: 9290}}>929</div>,
            <div style={{top: 9300}}>930</div>,
            <div style={{top: 9310}}>931</div>,
            <div style={{top: 9320}}>932</div>,
            <div style={{top: 9330}}>933</div>,
            <div style={{top: 9340}}>934</div>,
            <div style={{top: 9350}}>935</div>,
            <div style={{top: 9360}}>936</div>,
            <div style={{top: 9370}}>937</div>,
            <div style={{top: 9380}}>938</div>,
            <div style={{top: 9390}}>939</div>,
            <div style={{top: 9400}}>940</div>,
            <div style={{top: 9410}}>941</div>,
            <div style={{top: 9420}}>942</div>,
            <div style={{top: 9430}}>943</div>,
            <div style={{top: 9440}}>944</div>,
        ],
        contentHeight: 10000,
        bufferedHeightBeforeChildren: 9250,
    });
});

test("can change item heights", () => {
    const itemCount = 1_000;
    const getItem = (index: number) => ({
        key: index,
        minHeight: 10,
        render: ({offset}: {offset: number}) => <div style={{top: offset}}>{String(index)}</div>,
    });

    let state = VirtualizedScrollViewState.initializeFromTop({
        initialViewHeight: 100,
        bufferedItemHeight: 10,
        itemCount,
        getItem,
    });

    state = state.updateRenderedRange({
        scrollOffset: 200,
        itemCount,
        getItem,
    });

    expect(
        omitObject(
            state.render({
                itemCount,
                getItem,
            }),
            ["state", "renderedRange"],
        ),
    ).toEqual({
        children: [
            <div style={{top: 150}}>15</div>,
            <div style={{top: 160}}>16</div>,
            <div style={{top: 170}}>17</div>,
            <div style={{top: 180}}>18</div>,
            <div style={{top: 190}}>19</div>,
            <div style={{top: 200}}>20</div>,
            <div style={{top: 210}}>21</div>,
            <div style={{top: 220}}>22</div>,
            <div style={{top: 230}}>23</div>,
            <div style={{top: 240}}>24</div>,
            <div style={{top: 250}}>25</div>,
            <div style={{top: 260}}>26</div>,
            <div style={{top: 270}}>27</div>,
            <div style={{top: 280}}>28</div>,
            <div style={{top: 290}}>29</div>,
            <div style={{top: 300}}>30</div>,
            <div style={{top: 310}}>31</div>,
            <div style={{top: 320}}>32</div>,
            <div style={{top: 330}}>33</div>,
            <div style={{top: 340}}>34</div>,
        ],
        contentHeight: 10_000,
        bufferedHeightBeforeChildren: 150,
    });

    expect(state.setItemHeight(20, 10)).toBe(state);
    expect(state.setItemHeight(20, 50)).not.toBe(state);

    state = state.setItemHeight(20, 50);

    expect(state.setItemHeight(20, 50)).toBe(state);

    expect(
        omitObject(
            state.render({
                itemCount,
                getItem,
            }),
            ["state", "renderedRange"],
        ),
    ).toEqual({
        children: [
            <div style={{top: 150}}>15</div>,
            <div style={{top: 160}}>16</div>,
            <div style={{top: 170}}>17</div>,
            <div style={{top: 180}}>18</div>,
            <div style={{top: 190}}>19</div>,
            <div style={{top: 200}}>20</div>,
            <div style={{top: 250}}>21</div>,
            <div style={{top: 260}}>22</div>,
            <div style={{top: 270}}>23</div>,
            <div style={{top: 280}}>24</div>,
            <div style={{top: 290}}>25</div>,
            <div style={{top: 300}}>26</div>,
            <div style={{top: 310}}>27</div>,
            <div style={{top: 320}}>28</div>,
            <div style={{top: 330}}>29</div>,
            <div style={{top: 340}}>30</div>,
            <div style={{top: 350}}>31</div>,
            <div style={{top: 360}}>32</div>,
            <div style={{top: 370}}>33</div>,
            <div style={{top: 380}}>34</div>,
        ],
        contentHeight: 10_040,
        bufferedHeightBeforeChildren: 150,
    });

    state = state.updateRenderedRange({
        scrollOffset: 200,
        itemCount,
        getItem,
    });

    expect(
        omitObject(
            state.render({
                itemCount,
                getItem,
            }),
            ["state", "renderedRange"],
        ),
    ).toEqual({
        children: [
            <div style={{top: 150}}>15</div>,
            <div style={{top: 160}}>16</div>,
            <div style={{top: 170}}>17</div>,
            <div style={{top: 180}}>18</div>,
            <div style={{top: 190}}>19</div>,
            <div style={{top: 200}}>20</div>,
            <div style={{top: 250}}>21</div>,
            <div style={{top: 260}}>22</div>,
            <div style={{top: 270}}>23</div>,
            <div style={{top: 280}}>24</div>,
            <div style={{top: 290}}>25</div>,
            <div style={{top: 300}}>26</div>,
            <div style={{top: 310}}>27</div>,
            <div style={{top: 320}}>28</div>,
            <div style={{top: 330}}>29</div>,
            <div style={{top: 340}}>30</div>,
            <div style={{top: 350}}>31</div>,
            <div style={{top: 360}}>32</div>,
            <div style={{top: 370}}>33</div>,
            <div style={{top: 380}}>34</div>,
        ],
        contentHeight: 10_040,
        bufferedHeightBeforeChildren: 150,
    });

    state = state.updateRenderedRange({
        scrollOffset: 250,
        itemCount,
        getItem,
    });

    expect(
        omitObject(
            state.render({
                itemCount,
                getItem,
            }),
            ["state", "renderedRange"],
        ),
    ).toEqual({
        children: [
            <div style={{top: 200}}>20</div>,
            <div style={{top: 250}}>21</div>,
            <div style={{top: 260}}>22</div>,
            <div style={{top: 270}}>23</div>,
            <div style={{top: 280}}>24</div>,
            <div style={{top: 290}}>25</div>,
            <div style={{top: 300}}>26</div>,
            <div style={{top: 310}}>27</div>,
            <div style={{top: 320}}>28</div>,
            <div style={{top: 330}}>29</div>,
            <div style={{top: 340}}>30</div>,
            <div style={{top: 350}}>31</div>,
            <div style={{top: 360}}>32</div>,
            <div style={{top: 370}}>33</div>,
            <div style={{top: 380}}>34</div>,
            <div style={{top: 390}}>35</div>,
        ],
        contentHeight: 10_040,
        bufferedHeightBeforeChildren: 200,
    });

    state = state.setItemHeight(20, 10);

    expect(
        omitObject(
            state.render({
                itemCount,
                getItem,
            }),
            ["state", "renderedRange"],
        ),
    ).toEqual({
        children: [
            <div style={{top: 200}}>20</div>,
            <div style={{top: 210}}>21</div>,
            <div style={{top: 220}}>22</div>,
            <div style={{top: 230}}>23</div>,
            <div style={{top: 240}}>24</div>,
            <div style={{top: 250}}>25</div>,
            <div style={{top: 260}}>26</div>,
            <div style={{top: 270}}>27</div>,
            <div style={{top: 280}}>28</div>,
            <div style={{top: 290}}>29</div>,
            <div style={{top: 300}}>30</div>,
            <div style={{top: 310}}>31</div>,
            <div style={{top: 320}}>32</div>,
            <div style={{top: 330}}>33</div>,
            <div style={{top: 340}}>34</div>,
            <div style={{top: 350}}>35</div>,
        ],
        contentHeight: 10_000,
        bufferedHeightBeforeChildren: 200,
    });

    state = state.updateRenderedRange({
        scrollOffset: 250,
        itemCount,
        getItem,
    });

    expect(
        omitObject(
            state.render({
                itemCount,
                getItem,
            }),
            ["state", "renderedRange"],
        ),
    ).toEqual({
        children: [
            <div style={{top: 200}}>20</div>,
            <div style={{top: 210}}>21</div>,
            <div style={{top: 220}}>22</div>,
            <div style={{top: 230}}>23</div>,
            <div style={{top: 240}}>24</div>,
            <div style={{top: 250}}>25</div>,
            <div style={{top: 260}}>26</div>,
            <div style={{top: 270}}>27</div>,
            <div style={{top: 280}}>28</div>,
            <div style={{top: 290}}>29</div>,
            <div style={{top: 300}}>30</div>,
            <div style={{top: 310}}>31</div>,
            <div style={{top: 320}}>32</div>,
            <div style={{top: 330}}>33</div>,
            <div style={{top: 340}}>34</div>,
            <div style={{top: 350}}>35</div>,
            <div style={{top: 360}}>36</div>,
            <div style={{top: 370}}>37</div>,
            <div style={{top: 380}}>38</div>,
            <div style={{top: 390}}>39</div>,
        ],
        contentHeight: 10_000,
        bufferedHeightBeforeChildren: 200,
    });

    state = state.setItemHeight(5, 110);

    expect(
        omitObject(
            state.render({
                itemCount,
                getItem,
            }),
            ["state", "renderedRange"],
        ),
    ).toEqual({
        children: [
            <div style={{top: 300}}>20</div>,
            <div style={{top: 310}}>21</div>,
            <div style={{top: 320}}>22</div>,
            <div style={{top: 330}}>23</div>,
            <div style={{top: 340}}>24</div>,
            <div style={{top: 350}}>25</div>,
            <div style={{top: 360}}>26</div>,
            <div style={{top: 370}}>27</div>,
            <div style={{top: 380}}>28</div>,
            <div style={{top: 390}}>29</div>,
            <div style={{top: 400}}>30</div>,
            <div style={{top: 410}}>31</div>,
            <div style={{top: 420}}>32</div>,
            <div style={{top: 430}}>33</div>,
            <div style={{top: 440}}>34</div>,
            <div style={{top: 450}}>35</div>,
            <div style={{top: 460}}>36</div>,
            <div style={{top: 470}}>37</div>,
            <div style={{top: 480}}>38</div>,
            <div style={{top: 490}}>39</div>,
        ],
        contentHeight: 10_100,
        bufferedHeightBeforeChildren: 300,
    });

    state = state.updateRenderedRange({
        scrollOffset: 250,
        itemCount,
        getItem,
    });

    expect(
        omitObject(
            state.render({
                itemCount,
                getItem,
            }),
            ["state", "renderedRange"],
        ),
    ).toEqual({
        children: [
            <div style={{top: 200}}>10</div>,
            <div style={{top: 210}}>11</div>,
            <div style={{top: 220}}>12</div>,
            <div style={{top: 230}}>13</div>,
            <div style={{top: 240}}>14</div>,
            <div style={{top: 250}}>15</div>,
            <div style={{top: 260}}>16</div>,
            <div style={{top: 270}}>17</div>,
            <div style={{top: 280}}>18</div>,
            <div style={{top: 290}}>19</div>,
            <div style={{top: 300}}>20</div>,
            <div style={{top: 310}}>21</div>,
            <div style={{top: 320}}>22</div>,
            <div style={{top: 330}}>23</div>,
            <div style={{top: 340}}>24</div>,
            <div style={{top: 350}}>25</div>,
            <div style={{top: 360}}>26</div>,
            <div style={{top: 370}}>27</div>,
            <div style={{top: 380}}>28</div>,
            <div style={{top: 390}}>29</div>,
        ],
        contentHeight: 10_100,
        bufferedHeightBeforeChildren: 200,
    });

    state = state.setItemHeight(5, 10);

    expect(
        omitObject(
            state.render({
                itemCount,
                getItem,
            }),
            ["state", "renderedRange"],
        ),
    ).toEqual({
        children: [
            <div style={{top: 100}}>10</div>,
            <div style={{top: 110}}>11</div>,
            <div style={{top: 120}}>12</div>,
            <div style={{top: 130}}>13</div>,
            <div style={{top: 140}}>14</div>,
            <div style={{top: 150}}>15</div>,
            <div style={{top: 160}}>16</div>,
            <div style={{top: 170}}>17</div>,
            <div style={{top: 180}}>18</div>,
            <div style={{top: 190}}>19</div>,
            <div style={{top: 200}}>20</div>,
            <div style={{top: 210}}>21</div>,
            <div style={{top: 220}}>22</div>,
            <div style={{top: 230}}>23</div>,
            <div style={{top: 240}}>24</div>,
            <div style={{top: 250}}>25</div>,
            <div style={{top: 260}}>26</div>,
            <div style={{top: 270}}>27</div>,
            <div style={{top: 280}}>28</div>,
            <div style={{top: 290}}>29</div>,
        ],
        contentHeight: 10_000,
        bufferedHeightBeforeChildren: 100,
    });

    state = state.updateRenderedRange({
        scrollOffset: 250,
        itemCount,
        getItem,
    });

    expect(
        omitObject(
            state.render({
                itemCount,
                getItem,
            }),
            ["state", "renderedRange"],
        ),
    ).toEqual({
        children: [
            <div style={{top: 200}}>20</div>,
            <div style={{top: 210}}>21</div>,
            <div style={{top: 220}}>22</div>,
            <div style={{top: 230}}>23</div>,
            <div style={{top: 240}}>24</div>,
            <div style={{top: 250}}>25</div>,
            <div style={{top: 260}}>26</div>,
            <div style={{top: 270}}>27</div>,
            <div style={{top: 280}}>28</div>,
            <div style={{top: 290}}>29</div>,
            <div style={{top: 300}}>30</div>,
            <div style={{top: 310}}>31</div>,
            <div style={{top: 320}}>32</div>,
            <div style={{top: 330}}>33</div>,
            <div style={{top: 340}}>34</div>,
            <div style={{top: 350}}>35</div>,
            <div style={{top: 360}}>36</div>,
            <div style={{top: 370}}>37</div>,
            <div style={{top: 380}}>38</div>,
            <div style={{top: 390}}>39</div>,
        ],
        contentHeight: 10_000,
        bufferedHeightBeforeChildren: 200,
    });
});

test("can move items between renders", () => {
    const stableRandom = new StableRandom("test-b4aa88af");
    const itemCount = 100;
    const items = createArrayWithLength(itemCount, index => ({
        key: index,
        minHeight: 100,
        render: ({offset}: {offset: number}) => <div style={{top: offset}}>{String(index)}</div>,
    }));

    const getItem = (index: number) => items[index]!;

    let state = VirtualizedScrollViewState.initializeFromTop({
        initialViewHeight: 1000,
        bufferedItemHeight: 10,
        itemCount,
        getItem,
    });

    state = state.updateRenderedRange({
        scrollOffset: 2000,
        itemCount,
        getItem,
    });
    state = state.updateRenderedRange({
        scrollOffset: 3000,
        itemCount,
        getItem,
    });
    state = state.updateRenderedRange({
        scrollOffset: 2000,
        itemCount,
        getItem,
    });

    expect(
        omitObject(
            state.render({
                itemCount,
                getItem,
            }),
            ["state", "renderedRange"],
        ),
    ).toEqual({
        children: [
            <div style={{top: 1500}}>15</div>,
            <div style={{top: 1600}}>16</div>,
            <div style={{top: 1700}}>17</div>,
            <div style={{top: 1800}}>18</div>,
            <div style={{top: 1900}}>19</div>,
            <div style={{top: 2000}}>20</div>,
            <div style={{top: 2100}}>21</div>,
            <div style={{top: 2200}}>22</div>,
            <div style={{top: 2300}}>23</div>,
            <div style={{top: 2400}}>24</div>,
            <div style={{top: 2500}}>25</div>,
            <div style={{top: 2600}}>26</div>,
            <div style={{top: 2700}}>27</div>,
            <div style={{top: 2800}}>28</div>,
            <div style={{top: 2900}}>29</div>,
            <div style={{top: 3000}}>30</div>,
            <div style={{top: 3100}}>31</div>,
            <div style={{top: 3200}}>32</div>,
            <div style={{top: 3300}}>33</div>,
            <div style={{top: 3400}}>34</div>,
        ],
        contentHeight: 5050,
        bufferedHeightBeforeChildren: 1500,
    });

    stableShuffleArray(stableRandom, "shuffle1", items);

    expect(
        omitObject(
            state.render({
                itemCount,
                getItem,
            }),
            ["state", "renderedRange"],
        ),
    ).toEqual({
        children: [
            <div style={{top: 1500}}>12</div>,
            <div style={{top: 1600}}>0</div>,
            <div style={{top: 1700}}>36</div>,
            <div style={{top: 1800}}>24</div>,
            <div style={{top: 1900}}>39</div>,
            <div style={{top: 2000}}>49</div>,
            <div style={{top: 2100}}>62</div>,
            <div style={{top: 2200}}>51</div>,
            <div style={{top: 2300}}>55</div>,
            <div style={{top: 2400}}>37</div>,
            <div style={{top: 2500}}>54</div>,
            <div style={{top: 2600}}>50</div>,
            <div style={{top: 2700}}>32</div>,
            <div style={{top: 2800}}>91</div>,
            <div style={{top: 2900}}>94</div>,
            <div style={{top: 3000}}>53</div>,
            <div style={{top: 3100}}>93</div>,
            <div style={{top: 3200}}>11</div>,
            <div style={{top: 3300}}>10</div>,
            <div style={{top: 3400}}>59</div>,
        ],
        contentHeight: 4420,
        bufferedHeightBeforeChildren: 1500,
    });

    state = state.updateRenderedRange({
        scrollOffset: 3000,
        itemCount,
        getItem,
    });

    expect(
        omitObject(
            state.render({
                itemCount,
                getItem,
            }),
            ["state", "renderedRange"],
        ),
    ).toEqual({
        children: [
            <div style={{top: 2500 - 90}}>54</div>,
            <div style={{top: 2600 - 90}}>50</div>,
            <div style={{top: 2700 - 90}}>32</div>,
            <div style={{top: 2800 - 90}}>91</div>,
            <div style={{top: 2900 - 90}}>94</div>,
            <div style={{top: 3000 - 90}}>53</div>,
            <div style={{top: 3100 - 90}}>93</div>,
            <div style={{top: 3200 - 90}}>11</div>,
            <div style={{top: 3300 - 90}}>10</div>,
            <div style={{top: 3400 - 90}}>59</div>,
            <div style={{top: 3500 - 90}}>46</div>,
            <div style={{top: 3600 - 90}}>76</div>,
            <div style={{top: 3700 - 90}}>56</div>,
            <div style={{top: 3800 - 90}}>77</div>,
            <div style={{top: 3900 - 90}}>72</div>,
            <div style={{top: 4000 - 90}}>74</div>,
            <div style={{top: 4100 - 90}}>34</div>,
            <div style={{top: 4200 - 90}}>28</div>,
            <div style={{top: 4300 - 90}}>21</div>,
            <div style={{top: 4400 - 90}}>27</div>,
        ],
        contentHeight: 4870,
        bufferedHeightBeforeChildren: 2410,
    });

    state = state.updateRenderedRange({
        scrollOffset: 2000,
        itemCount,
        getItem,
    });
    state = state.updateRenderedRange({
        scrollOffset: 1000,
        itemCount,
        getItem,
    });

    expect(
        omitObject(
            state.render({
                itemCount,
                getItem,
            }),
            ["state", "renderedRange"],
        ),
    ).toEqual({
        children: [
            <div style={{top: 700 - 90}}>68</div>,
            <div style={{top: 800 - 90}}>79</div>,
            <div style={{top: 900 - 90}}>17</div>,
            <div style={{top: 1000 - 90}}>29</div>,
            <div style={{top: 1100 - 90}}>80</div>,
            <div style={{top: 1200 - 90}}>26</div>,
            <div style={{top: 1300 - 90}}>86</div>,
            <div style={{top: 1400 - 90}}>97</div>,
            <div style={{top: 1500 - 90}}>12</div>,
            <div style={{top: 1600 - 90}}>0</div>,
            <div style={{top: 1700 - 90}}>36</div>,
            <div style={{top: 1800 - 90}}>24</div>,
            <div style={{top: 1900 - 90}}>39</div>,
            <div style={{top: 2000 - 90}}>49</div>,
            <div style={{top: 2100 - 90}}>62</div>,
            <div style={{top: 2200 - 90}}>51</div>,
            <div style={{top: 2300 - 90}}>55</div>,
            <div style={{top: 2400 - 90}}>37</div>,
            <div style={{top: 2500 - 90}}>54</div>,
            <div style={{top: 2600 - 90}}>50</div>,
            <div style={{top: 2700 - 90}}>32</div>,
        ],
        contentHeight: 4960,
        bufferedHeightBeforeChildren: 610,
    });
});

test("can scroll entire list from top", () => {
    const itemCount = 30;
    const getItem = (index: number) => ({
        key: index,
        minHeight: 10,
        render: ({offset}: {offset: number}) => <div style={{top: offset}}>{String(index)}</div>,
    });

    let state = VirtualizedScrollViewState.initializeFromTop({
        initialViewHeight: 100,
        bufferedItemHeight: 10,
        itemCount,
        getItem,
    });

    expect(
        omitObject(
            state.render({
                itemCount,
                getItem,
            }),
            ["state", "renderedRange"],
        ),
    ).toEqual({
        children: [
            <div style={{top: 0}}>0</div>,
            <div style={{top: 10}}>1</div>,
            <div style={{top: 20}}>2</div>,
            <div style={{top: 30}}>3</div>,
            <div style={{top: 40}}>4</div>,
            <div style={{top: 50}}>5</div>,
            <div style={{top: 60}}>6</div>,
            <div style={{top: 70}}>7</div>,
            <div style={{top: 80}}>8</div>,
            <div style={{top: 90}}>9</div>,
            <div style={{top: 100}}>10</div>,
            <div style={{top: 110}}>11</div>,
            <div style={{top: 120}}>12</div>,
            <div style={{top: 130}}>13</div>,
            <div style={{top: 140}}>14</div>,
            <div style={{top: 150}}>15</div>,
            <div style={{top: 160}}>16</div>,
            <div style={{top: 170}}>17</div>,
            <div style={{top: 180}}>18</div>,
            <div style={{top: 190}}>19</div>,
        ],
        contentHeight: 300,
        bufferedHeightBeforeChildren: 0,
    });

    state = state.updateRenderedRange({
        scrollOffset: 200,
        itemCount,
        getItem,
    });

    expect(
        omitObject(
            state.render({
                itemCount,
                getItem,
            }),
            ["state", "renderedRange"],
        ),
    ).toEqual({
        children: [
            <div style={{top: 150}}>15</div>,
            <div style={{top: 160}}>16</div>,
            <div style={{top: 170}}>17</div>,
            <div style={{top: 180}}>18</div>,
            <div style={{top: 190}}>19</div>,
            <div style={{top: 200}}>20</div>,
            <div style={{top: 210}}>21</div>,
            <div style={{top: 220}}>22</div>,
            <div style={{top: 230}}>23</div>,
            <div style={{top: 240}}>24</div>,
            <div style={{top: 250}}>25</div>,
            <div style={{top: 260}}>26</div>,
            <div style={{top: 270}}>27</div>,
            <div style={{top: 280}}>28</div>,
            <div style={{top: 290}}>29</div>,
        ],
        contentHeight: 300,
        bufferedHeightBeforeChildren: 150,
    });
});

test("can scroll entire list from end", () => {
    const itemCount = 30;
    const getItem = (index: number) => ({
        key: index,
        minHeight: 10,
        render: ({offset}: {offset: number}) => <div style={{top: offset}}>{String(index)}</div>,
    });

    let state = VirtualizedScrollViewState.initializeFromBottom({
        initialViewHeight: 100,
        bufferedItemHeight: 10,
        itemCount,
        getItem,
    });

    expect(
        omitObject(
            state.render({
                itemCount,
                getItem,
            }),
            ["state", "renderedRange"],
        ),
    ).toEqual({
        children: [
            <div style={{top: 100}}>10</div>,
            <div style={{top: 110}}>11</div>,
            <div style={{top: 120}}>12</div>,
            <div style={{top: 130}}>13</div>,
            <div style={{top: 140}}>14</div>,
            <div style={{top: 150}}>15</div>,
            <div style={{top: 160}}>16</div>,
            <div style={{top: 170}}>17</div>,
            <div style={{top: 180}}>18</div>,
            <div style={{top: 190}}>19</div>,
            <div style={{top: 200}}>20</div>,
            <div style={{top: 210}}>21</div>,
            <div style={{top: 220}}>22</div>,
            <div style={{top: 230}}>23</div>,
            <div style={{top: 240}}>24</div>,
            <div style={{top: 250}}>25</div>,
            <div style={{top: 260}}>26</div>,
            <div style={{top: 270}}>27</div>,
            <div style={{top: 280}}>28</div>,
            <div style={{top: 290}}>29</div>,
        ],
        contentHeight: 300,
        bufferedHeightBeforeChildren: 100,
    });

    state = state.updateRenderedRange({
        scrollOffset: 0,
        itemCount,
        getItem,
    });

    expect(
        omitObject(
            state.render({
                itemCount,
                getItem,
            }),
            ["state", "renderedRange"],
        ),
    ).toEqual({
        children: [
            <div style={{top: 0}}>0</div>,
            <div style={{top: 10}}>1</div>,
            <div style={{top: 20}}>2</div>,
            <div style={{top: 30}}>3</div>,
            <div style={{top: 40}}>4</div>,
            <div style={{top: 50}}>5</div>,
            <div style={{top: 60}}>6</div>,
            <div style={{top: 70}}>7</div>,
            <div style={{top: 80}}>8</div>,
            <div style={{top: 90}}>9</div>,
            <div style={{top: 100}}>10</div>,
            <div style={{top: 110}}>11</div>,
            <div style={{top: 120}}>12</div>,
            <div style={{top: 130}}>13</div>,
            <div style={{top: 140}}>14</div>,
        ],
        contentHeight: 300,
        bufferedHeightBeforeChildren: 0,
    });
});

test("can add item count", () => {
    const itemCount = 1_000;
    const getItem = (index: number) => ({
        key: index,
        minHeight: 10,
        render: ({offset}: {offset: number}) => <div style={{top: offset}}>{String(index)}</div>,
    });

    let state = VirtualizedScrollViewState.initializeFromTop({
        initialViewHeight: 100,
        bufferedItemHeight: 10,
        itemCount,
        getItem,
    });

    state = state.updateRenderedRange({
        scrollOffset: 200,
        itemCount,
        getItem,
    });

    expect(
        omitObject(
            state.render({
                itemCount,
                getItem,
            }),
            ["state", "renderedRange"],
        ),
    ).toEqual({
        children: [
            <div style={{top: 150}}>15</div>,
            <div style={{top: 160}}>16</div>,
            <div style={{top: 170}}>17</div>,
            <div style={{top: 180}}>18</div>,
            <div style={{top: 190}}>19</div>,
            <div style={{top: 200}}>20</div>,
            <div style={{top: 210}}>21</div>,
            <div style={{top: 220}}>22</div>,
            <div style={{top: 230}}>23</div>,
            <div style={{top: 240}}>24</div>,
            <div style={{top: 250}}>25</div>,
            <div style={{top: 260}}>26</div>,
            <div style={{top: 270}}>27</div>,
            <div style={{top: 280}}>28</div>,
            <div style={{top: 290}}>29</div>,
            <div style={{top: 300}}>30</div>,
            <div style={{top: 310}}>31</div>,
            <div style={{top: 320}}>32</div>,
            <div style={{top: 330}}>33</div>,
            <div style={{top: 340}}>34</div>,
        ],
        contentHeight: 10_000,
        bufferedHeightBeforeChildren: 150,
    });

    expect(
        omitObject(
            state.render({
                itemCount: 1_100,
                getItem,
            }),
            ["state", "renderedRange"],
        ),
    ).toEqual({
        children: [
            <div style={{top: 150}}>15</div>,
            <div style={{top: 160}}>16</div>,
            <div style={{top: 170}}>17</div>,
            <div style={{top: 180}}>18</div>,
            <div style={{top: 190}}>19</div>,
            <div style={{top: 200}}>20</div>,
            <div style={{top: 210}}>21</div>,
            <div style={{top: 220}}>22</div>,
            <div style={{top: 230}}>23</div>,
            <div style={{top: 240}}>24</div>,
            <div style={{top: 250}}>25</div>,
            <div style={{top: 260}}>26</div>,
            <div style={{top: 270}}>27</div>,
            <div style={{top: 280}}>28</div>,
            <div style={{top: 290}}>29</div>,
            <div style={{top: 300}}>30</div>,
            <div style={{top: 310}}>31</div>,
            <div style={{top: 320}}>32</div>,
            <div style={{top: 330}}>33</div>,
            <div style={{top: 340}}>34</div>,
        ],
        contentHeight: 11_000,
        bufferedHeightBeforeChildren: 150,
    });
});

test("can remove item count", () => {
    const itemCount = 1_000;
    const getItem = (index: number) => ({
        key: index,
        minHeight: 10,
        render: ({offset}: {offset: number}) => <div style={{top: offset}}>{String(index)}</div>,
    });

    let state = VirtualizedScrollViewState.initializeFromTop({
        initialViewHeight: 100,
        bufferedItemHeight: 10,
        itemCount,
        getItem,
    });

    state = state.updateRenderedRange({
        scrollOffset: 200,
        itemCount,
        getItem,
    });

    expect(
        omitObject(
            state.render({
                itemCount,
                getItem,
            }),
            ["state", "renderedRange"],
        ),
    ).toEqual({
        children: [
            <div style={{top: 150}}>15</div>,
            <div style={{top: 160}}>16</div>,
            <div style={{top: 170}}>17</div>,
            <div style={{top: 180}}>18</div>,
            <div style={{top: 190}}>19</div>,
            <div style={{top: 200}}>20</div>,
            <div style={{top: 210}}>21</div>,
            <div style={{top: 220}}>22</div>,
            <div style={{top: 230}}>23</div>,
            <div style={{top: 240}}>24</div>,
            <div style={{top: 250}}>25</div>,
            <div style={{top: 260}}>26</div>,
            <div style={{top: 270}}>27</div>,
            <div style={{top: 280}}>28</div>,
            <div style={{top: 290}}>29</div>,
            <div style={{top: 300}}>30</div>,
            <div style={{top: 310}}>31</div>,
            <div style={{top: 320}}>32</div>,
            <div style={{top: 330}}>33</div>,
            <div style={{top: 340}}>34</div>,
        ],
        contentHeight: 10_000,
        bufferedHeightBeforeChildren: 150,
    });

    expect(
        omitObject(
            state.render({
                itemCount: 900,
                getItem,
            }),
            ["state", "renderedRange"],
        ),
    ).toEqual({
        children: [
            <div style={{top: 150}}>15</div>,
            <div style={{top: 160}}>16</div>,
            <div style={{top: 170}}>17</div>,
            <div style={{top: 180}}>18</div>,
            <div style={{top: 190}}>19</div>,
            <div style={{top: 200}}>20</div>,
            <div style={{top: 210}}>21</div>,
            <div style={{top: 220}}>22</div>,
            <div style={{top: 230}}>23</div>,
            <div style={{top: 240}}>24</div>,
            <div style={{top: 250}}>25</div>,
            <div style={{top: 260}}>26</div>,
            <div style={{top: 270}}>27</div>,
            <div style={{top: 280}}>28</div>,
            <div style={{top: 290}}>29</div>,
            <div style={{top: 300}}>30</div>,
            <div style={{top: 310}}>31</div>,
            <div style={{top: 320}}>32</div>,
            <div style={{top: 330}}>33</div>,
            <div style={{top: 340}}>34</div>,
        ],
        contentHeight: 9_000,
        bufferedHeightBeforeChildren: 150,
    });
});

test("can remove all buffered item count", () => {
    const itemCount = 1_000;
    const getItem = (index: number) => ({
        key: index,
        minHeight: 10,
        render: ({offset}: {offset: number}) => <div style={{top: offset}}>{String(index)}</div>,
    });

    let state = VirtualizedScrollViewState.initializeFromTop({
        initialViewHeight: 100,
        bufferedItemHeight: 10,
        itemCount,
        getItem,
    });

    state = state.updateRenderedRange({
        scrollOffset: 200,
        itemCount,
        getItem,
    });

    expect(
        omitObject(
            state.render({
                itemCount,
                getItem,
            }),
            ["state", "renderedRange"],
        ),
    ).toEqual({
        children: [
            <div style={{top: 150}}>15</div>,
            <div style={{top: 160}}>16</div>,
            <div style={{top: 170}}>17</div>,
            <div style={{top: 180}}>18</div>,
            <div style={{top: 190}}>19</div>,
            <div style={{top: 200}}>20</div>,
            <div style={{top: 210}}>21</div>,
            <div style={{top: 220}}>22</div>,
            <div style={{top: 230}}>23</div>,
            <div style={{top: 240}}>24</div>,
            <div style={{top: 250}}>25</div>,
            <div style={{top: 260}}>26</div>,
            <div style={{top: 270}}>27</div>,
            <div style={{top: 280}}>28</div>,
            <div style={{top: 290}}>29</div>,
            <div style={{top: 300}}>30</div>,
            <div style={{top: 310}}>31</div>,
            <div style={{top: 320}}>32</div>,
            <div style={{top: 330}}>33</div>,
            <div style={{top: 340}}>34</div>,
        ],
        contentHeight: 10_000,
        bufferedHeightBeforeChildren: 150,
    });

    expect(
        omitObject(
            state.render({
                itemCount: 35,
                getItem,
            }),
            ["state", "renderedRange"],
        ),
    ).toEqual({
        children: [
            <div style={{top: 150}}>15</div>,
            <div style={{top: 160}}>16</div>,
            <div style={{top: 170}}>17</div>,
            <div style={{top: 180}}>18</div>,
            <div style={{top: 190}}>19</div>,
            <div style={{top: 200}}>20</div>,
            <div style={{top: 210}}>21</div>,
            <div style={{top: 220}}>22</div>,
            <div style={{top: 230}}>23</div>,
            <div style={{top: 240}}>24</div>,
            <div style={{top: 250}}>25</div>,
            <div style={{top: 260}}>26</div>,
            <div style={{top: 270}}>27</div>,
            <div style={{top: 280}}>28</div>,
            <div style={{top: 290}}>29</div>,
            <div style={{top: 300}}>30</div>,
            <div style={{top: 310}}>31</div>,
            <div style={{top: 320}}>32</div>,
            <div style={{top: 330}}>33</div>,
            <div style={{top: 340}}>34</div>,
        ],
        contentHeight: 350,
        bufferedHeightBeforeChildren: 150,
    });
});

test("can remove some items while removing item count", () => {
    const itemCount = 1_000;
    const getItem = (index: number) => ({
        key: index,
        minHeight: 10,
        render: ({offset}: {offset: number}) => <div style={{top: offset}}>{String(index)}</div>,
    });

    let state = VirtualizedScrollViewState.initializeFromTop({
        initialViewHeight: 100,
        bufferedItemHeight: 10,
        itemCount,
        getItem,
    });

    state = state.updateRenderedRange({
        scrollOffset: 200,
        itemCount,
        getItem,
    });

    expect(
        omitObject(
            state.render({
                itemCount,
                getItem,
            }),
            ["state", "renderedRange"],
        ),
    ).toEqual({
        children: [
            <div style={{top: 150}}>15</div>,
            <div style={{top: 160}}>16</div>,
            <div style={{top: 170}}>17</div>,
            <div style={{top: 180}}>18</div>,
            <div style={{top: 190}}>19</div>,
            <div style={{top: 200}}>20</div>,
            <div style={{top: 210}}>21</div>,
            <div style={{top: 220}}>22</div>,
            <div style={{top: 230}}>23</div>,
            <div style={{top: 240}}>24</div>,
            <div style={{top: 250}}>25</div>,
            <div style={{top: 260}}>26</div>,
            <div style={{top: 270}}>27</div>,
            <div style={{top: 280}}>28</div>,
            <div style={{top: 290}}>29</div>,
            <div style={{top: 300}}>30</div>,
            <div style={{top: 310}}>31</div>,
            <div style={{top: 320}}>32</div>,
            <div style={{top: 330}}>33</div>,
            <div style={{top: 340}}>34</div>,
        ],
        contentHeight: 10_000,
        bufferedHeightBeforeChildren: 150,
    });

    expect(
        omitObject(
            state.render({
                itemCount: 30,
                getItem,
            }),
            ["state", "renderedRange"],
        ),
    ).toEqual({
        children: [
            <div style={{top: 150}}>15</div>,
            <div style={{top: 160}}>16</div>,
            <div style={{top: 170}}>17</div>,
            <div style={{top: 180}}>18</div>,
            <div style={{top: 190}}>19</div>,
            <div style={{top: 200}}>20</div>,
            <div style={{top: 210}}>21</div>,
            <div style={{top: 220}}>22</div>,
            <div style={{top: 230}}>23</div>,
            <div style={{top: 240}}>24</div>,
            <div style={{top: 250}}>25</div>,
            <div style={{top: 260}}>26</div>,
            <div style={{top: 270}}>27</div>,
            <div style={{top: 280}}>28</div>,
            <div style={{top: 290}}>29</div>,
        ],
        contentHeight: 300,
        bufferedHeightBeforeChildren: 150,
    });
});

test("can remove every visible item while removing item count", () => {
    const itemCount = 1_000;
    const getItem = (index: number) => ({
        key: index,
        minHeight: 10,
        render: ({offset}: {offset: number}) => <div style={{top: offset}}>{String(index)}</div>,
    });

    let state = VirtualizedScrollViewState.initializeFromTop({
        initialViewHeight: 100,
        bufferedItemHeight: 10,
        itemCount,
        getItem,
    });

    state = state.updateRenderedRange({
        scrollOffset: 200,
        itemCount,
        getItem,
    });

    expect(
        omitObject(
            state.render({
                itemCount,
                getItem,
            }),
            ["state", "renderedRange"],
        ),
    ).toEqual({
        children: [
            <div style={{top: 150}}>15</div>,
            <div style={{top: 160}}>16</div>,
            <div style={{top: 170}}>17</div>,
            <div style={{top: 180}}>18</div>,
            <div style={{top: 190}}>19</div>,
            <div style={{top: 200}}>20</div>,
            <div style={{top: 210}}>21</div>,
            <div style={{top: 220}}>22</div>,
            <div style={{top: 230}}>23</div>,
            <div style={{top: 240}}>24</div>,
            <div style={{top: 250}}>25</div>,
            <div style={{top: 260}}>26</div>,
            <div style={{top: 270}}>27</div>,
            <div style={{top: 280}}>28</div>,
            <div style={{top: 290}}>29</div>,
            <div style={{top: 300}}>30</div>,
            <div style={{top: 310}}>31</div>,
            <div style={{top: 320}}>32</div>,
            <div style={{top: 330}}>33</div>,
            <div style={{top: 340}}>34</div>,
        ],
        contentHeight: 10_000,
        bufferedHeightBeforeChildren: 150,
    });

    expect(
        omitObject(
            state.render({
                itemCount: 10,
                getItem,
            }),
            ["state", "renderedRange"],
        ),
    ).toEqual({
        children: null,
        contentHeight: 100,
        bufferedHeightBeforeChildren: 0,
    });
});

test("can jump to arbitrary positions in list when rendering starts at the top", () => {
    const itemCount = 1_000;
    const getItem = (index: number) => ({
        key: index,
        minHeight: 10,
        render: ({offset}: {offset: number}) => <div style={{top: offset}}>{String(index)}</div>,
    });

    let state = VirtualizedScrollViewState.initializeFromTop({
        initialViewHeight: 100,
        bufferedItemHeight: 10,
        itemCount,
        getItem,
    });

    expect(
        omitObject(
            state.render({
                itemCount,
                getItem,
            }),
            ["state", "renderedRange"],
        ),
    ).toEqual({
        children: [
            <div style={{top: 0}}>0</div>,
            <div style={{top: 10}}>1</div>,
            <div style={{top: 20}}>2</div>,
            <div style={{top: 30}}>3</div>,
            <div style={{top: 40}}>4</div>,
            <div style={{top: 50}}>5</div>,
            <div style={{top: 60}}>6</div>,
            <div style={{top: 70}}>7</div>,
            <div style={{top: 80}}>8</div>,
            <div style={{top: 90}}>9</div>,
            <div style={{top: 100}}>10</div>,
            <div style={{top: 110}}>11</div>,
            <div style={{top: 120}}>12</div>,
            <div style={{top: 130}}>13</div>,
            <div style={{top: 140}}>14</div>,
            <div style={{top: 150}}>15</div>,
            <div style={{top: 160}}>16</div>,
            <div style={{top: 170}}>17</div>,
            <div style={{top: 180}}>18</div>,
            <div style={{top: 190}}>19</div>,
        ],
        contentHeight: 10_000,
        bufferedHeightBeforeChildren: 0,
    });

    state = state.setViewHeight(20);

    state = state.updateRenderedRange({
        scrollOffset: 400,
        itemCount,
        getItem,
    });

    expect(
        omitObject(
            state.render({
                itemCount,
                getItem,
            }),
            ["state", "renderedRange"],
        ),
    ).toEqual({
        children: [
            <div style={{top: 390}}>39</div>,
            <div style={{top: 400}}>40</div>,
            <div style={{top: 410}}>41</div>,
            <div style={{top: 420}}>42</div>,
        ],
        contentHeight: 10_000,
        bufferedHeightBeforeChildren: 390,
    });

    state = state.updateRenderedRange({
        scrollOffset: 0,
        itemCount,
        getItem,
    });

    state = state.setViewHeight(100);

    state = state.updateRenderedRange({
        scrollOffset: 0,
        itemCount,
        getItem,
    });

    for (let scrollOffset = 251; scrollOffset < 9_900; scrollOffset++) {
        // eslint-disable-next-line testing-library/render-result-naming-convention
        const jumpState = state.updateRenderedRange({
            scrollOffset,
            itemCount,
            getItem,
        });

        const children = [];

        for (
            let index = Math.floor((scrollOffset - 50) / 10);
            index <= Math.min(itemCount - 1, Math.floor((scrollOffset + 150 - 1) / 10));
            index++
        ) {
            children.push(<div style={{top: index * 10}}>{String(index)}</div>);
        }

        expect(
            omitObject(
                jumpState.render({
                    itemCount,
                    getItem,
                }),
                ["state", "renderedRange"],
            ),
        ).toEqual({
            children,
            contentHeight: 10_000,
            bufferedHeightBeforeChildren: children[0]?.props.style.top,
        });
    }
});

test("can jump to arbitrary positions in list when rendering starts at the end", () => {
    const itemCount = 1_000;
    const getItem = (index: number) => ({
        key: index,
        minHeight: 10,
        render: ({offset}: {offset: number}) => <div style={{top: offset}}>{String(index)}</div>,
    });

    let state = VirtualizedScrollViewState.initializeFromBottom({
        initialViewHeight: 100,
        bufferedItemHeight: 10,
        itemCount,
        getItem,
    });

    expect(
        omitObject(
            state.render({
                itemCount,
                getItem,
            }),
            ["state", "renderedRange"],
        ),
    ).toEqual({
        children: [
            <div style={{top: 9800}}>980</div>,
            <div style={{top: 9810}}>981</div>,
            <div style={{top: 9820}}>982</div>,
            <div style={{top: 9830}}>983</div>,
            <div style={{top: 9840}}>984</div>,
            <div style={{top: 9850}}>985</div>,
            <div style={{top: 9860}}>986</div>,
            <div style={{top: 9870}}>987</div>,
            <div style={{top: 9880}}>988</div>,
            <div style={{top: 9890}}>989</div>,
            <div style={{top: 9900}}>990</div>,
            <div style={{top: 9910}}>991</div>,
            <div style={{top: 9920}}>992</div>,
            <div style={{top: 9930}}>993</div>,
            <div style={{top: 9940}}>994</div>,
            <div style={{top: 9950}}>995</div>,
            <div style={{top: 9960}}>996</div>,
            <div style={{top: 9970}}>997</div>,
            <div style={{top: 9980}}>998</div>,
            <div style={{top: 9990}}>999</div>,
        ],
        contentHeight: 10_000,
        bufferedHeightBeforeChildren: 9800,
    });

    state = state.setViewHeight(20);

    state = state.updateRenderedRange({
        scrollOffset: 400,
        itemCount,
        getItem,
    });

    expect(
        omitObject(
            state.render({
                itemCount,
                getItem,
            }),
            ["state", "renderedRange"],
        ),
    ).toEqual({
        children: [
            <div style={{top: 390}}>39</div>,
            <div style={{top: 400}}>40</div>,
            <div style={{top: 410}}>41</div>,
            <div style={{top: 420}}>42</div>,
        ],
        contentHeight: 10_000,
        bufferedHeightBeforeChildren: 390,
    });

    state = state.updateRenderedRange({
        scrollOffset: 9_900,
        itemCount,
        getItem,
    });

    state = state.setViewHeight(100);

    state = state.updateRenderedRange({
        scrollOffset: 9_900,
        itemCount,
        getItem,
    });

    for (let scrollOffset = 0; scrollOffset < 9_649; scrollOffset++) {
        // eslint-disable-next-line testing-library/render-result-naming-convention
        const jumpState = state.updateRenderedRange({
            scrollOffset,
            itemCount,
            getItem,
        });

        const children = [];

        for (
            let index =
                // `scrollOffset === 360` special case accounts for floating point math
                // weirdness.
                scrollOffset === 360 ? 30 : Math.max(0, Math.floor((scrollOffset - 50) / 10));
            index <= Math.floor((scrollOffset + 150 - 1) / 10);
            index++
        ) {
            children.push(<div style={{top: index * 10}}>{String(index)}</div>);
        }

        expect(
            omitObject(
                jumpState.render({
                    itemCount,
                    getItem,
                }),
                ["state", "renderedRange"],
            ),
        ).toEqual({
            children,
            contentHeight: 10_000,
            bufferedHeightBeforeChildren: children[0]?.props.style.top ?? 0,
        });
    }
});

test("can render additional items", () => {
    const itemCount = 1_000;

    const stableRandom = new StableRandom("test-1694b944");
    const renderAdditionalIndexByIndex = stableShuffleArray(
        stableRandom,
        "shuffle",
        createArrayWithLength(itemCount, index => (index % 2 === 0 ? index : null)),
    );

    const getItem = (index: number) => {
        const renderAdditionalIndex = renderAdditionalIndexByIndex[index]!;
        return {
            key: index,
            minHeight: 10,
            renderAdditionalItemIndexes:
                renderAdditionalIndex !== null && renderAdditionalIndex >= index
                    ? [renderAdditionalIndex]
                    : [],
            render: ({offset}: {offset: number}) => (
                <div style={{top: offset}}>{String(index)}</div>
            ),
        };
    };

    let state = VirtualizedScrollViewState.initializeFromTop({
        initialViewHeight: 100,
        bufferedItemHeight: 5,
        itemCount,
        getItem,
    });

    {
        const {
            state: newState,
            renderedRange,
            ...renderResult
        } = state.render({
            itemCount,
            getItem,
        });
        state = newState;

        let bufferItemCount = 0;

        expect(renderResult).toEqual({
            children: [
                <div style={{top: 0}}>0</div>,
                <div style={{top: 10}}>1</div>,
                <div style={{top: 20}}>2</div>,
                <div style={{top: 30}}>3</div>,
                <div style={{top: 40}}>4</div>,
                <div style={{top: 50}}>5</div>,
                <div style={{top: 60}}>6</div>,
                <div style={{top: 70}}>7</div>,
                <div style={{top: 80}}>8</div>,
                <div style={{top: 90}}>9</div>,
                <div style={{top: 100}}>10</div>,
                <div style={{top: 110}}>11</div>,
                <div style={{top: 120}}>12</div>,
                <div style={{top: 130}}>13</div>,
                <div style={{top: 140}}>14</div>,
                <div style={{top: 150}}>15</div>,
                <div style={{top: 160}}>16</div>,
                <div style={{top: 170}}>17</div>,
                <div style={{top: 180}}>18</div>,
                <div style={{top: 190}}>19</div>,
                <div style={{top: 10 * 20 + 5 * (bufferItemCount += 9 - 1)}}>28</div>,
                <div style={{top: 10 * 21 + 5 * (bufferItemCount += 22 - 1)}}>50</div>,
                <div style={{top: 10 * 22 + 5 * (bufferItemCount += 78 - 1)}}>128</div>,
                <div style={{top: 10 * 23 + 5 * (bufferItemCount += 20 - 1)}}>148</div>,
                <div style={{top: 10 * 24 + 5 * (bufferItemCount += 62 - 1)}}>210</div>,
                <div style={{top: 10 * 25 + 5 * (bufferItemCount += 74 - 1)}}>284</div>,
                <div style={{top: 10 * 26 + 5 * (bufferItemCount += 8 - 1)}}>292</div>,
                <div style={{top: 10 * 27 + 5 * (bufferItemCount += 124 - 1)}}>416</div>,
                <div style={{top: 10 * 28 + 5 * (bufferItemCount += 4 - 1)}}>420</div>,
                <div style={{top: 10 * 29 + 5 * (bufferItemCount += 14 - 1)}}>434</div>,
                <div style={{top: 10 * 30 + 5 * (bufferItemCount += 170 - 1)}}>604</div>,
                <div style={{top: 10 * 31 + 5 * (bufferItemCount += 214 - 1)}}>818</div>,
                <div style={{top: 10 * 32 + 5 * (bufferItemCount += 106 - 1)}}>924</div>,
            ],
            contentHeight: 10 * 33 + 5 * (itemCount - 33),
            bufferedHeightBeforeChildren: 0,
        });
    }

    state = state.updateRenderedRange({
        scrollOffset: 200,
        itemCount,
        getItem,
    });

    {
        const {
            state: newState,
            renderedRange,
            ...renderResult
        } = state.render({
            itemCount,
            getItem,
        });
        state = newState;

        expect(renderResult).toEqual({
            children: [
                <div style={{top: 150}}>15</div>,
                <div style={{top: 160}}>16</div>,
                <div style={{top: 170}}>17</div>,
                <div style={{top: 180}}>18</div>,
                <div style={{top: 190}}>19</div>,
                <div style={{top: 200}}>20</div>,
                <div style={{top: 210}}>21</div>,
                <div style={{top: 220}}>22</div>,
                <div style={{top: 230}}>23</div>,
                <div style={{top: 240}}>24</div>,
                <div style={{top: 250}}>25</div>,
                <div style={{top: 260}}>26</div>,
                <div style={{top: 270}}>27</div>,
                <div style={{top: 280}}>28</div>,
                <div style={{top: 290}}>29</div>,
                <div style={{top: 300}}>30</div>,
                <div style={{top: 310}}>31</div>,
                <div style={{top: 320}}>32</div>,
                <div style={{top: 330}}>33</div>,
                <div style={{top: 340}}>34</div>,
                <div style={{top: 365}}>38</div>,
                <div style={{top: 430}}>50</div>,
                <div style={{top: 1095}}>180</div>,
                <div style={{top: 1545}}>268</div>,
                <div style={{top: 1630}}>284</div>,
                <div style={{top: 2050}}>366</div>,
                <div style={{top: 2205}}>396</div>,
                <div style={{top: 2310}}>416</div>,
                <div style={{top: 3710}}>692</div>,
                <div style={{top: 4620}}>872</div>,
            ],
            contentHeight: 5270,
            bufferedHeightBeforeChildren: 150,
        });
    }

    state = state.updateRenderedRange({
        scrollOffset: 610,
        itemCount,
        getItem,
    });

    {
        const {
            state: newState,
            renderedRange,
            ...renderResult
        } = state.render({
            itemCount,
            getItem,
        });
        state = newState;

        expect(renderResult).toEqual({
            children: [
                <div style={{top: 560}}>75</div>,
                <div style={{top: 570}}>76</div>,
                <div style={{top: 580}}>77</div>,
                <div style={{top: 590}}>78</div>,
                <div style={{top: 600}}>79</div>,
                <div style={{top: 610}}>80</div>,
                <div style={{top: 620}}>81</div>,
                <div style={{top: 630}}>82</div>,
                <div style={{top: 640}}>83</div>,
                <div style={{top: 650}}>84</div>,
                <div style={{top: 660}}>85</div>,
                <div style={{top: 670}}>86</div>,
                <div style={{top: 680}}>87</div>,
                <div style={{top: 690}}>88</div>,
                <div style={{top: 700}}>89</div>,
                <div style={{top: 710}}>90</div>,
                <div style={{top: 720}}>91</div>,
                <div style={{top: 730}}>92</div>,
                <div style={{top: 740}}>93</div>,
                <div style={{top: 750}}>94</div>,
                <div style={{top: 865}}>116</div>,
                <div style={{top: 1370}}>212</div>,
                <div style={{top: 2410}}>414</div>,
                <div style={{top: 2640}}>456</div>,
                <div style={{top: 3700}}>666</div>,
                <div style={{top: 4100}}>744</div>,
                <div style={{top: 4865}}>894</div>,
                <div style={{top: 5185}}>956</div>,
                <div style={{top: 5200}}>958</div>,
            ],
            contentHeight: 5415,
            bufferedHeightBeforeChildren: 560,
        });
    }
});

test("can expand and collapse an item", () => {
    let skipIndex: number | null = null;

    const getItemCount = () => 100 - (skipIndex !== null ? 1 : 0);

    const getItem = (index: number) => {
        if (skipIndex !== null && index >= skipIndex) {
            index += 1;
        }
        return {
            key: index,
            minHeight: 10,
            render: ({offset}: {offset: number}) => (
                <div style={{top: offset}}>{String(index)}</div>
            ),
        };
    };

    let state = VirtualizedScrollViewState.initializeFromTop({
        initialViewHeight: 100,
        bufferedItemHeight: 10,
        itemCount: getItemCount(),
        getItem,
    });

    {
        const {
            state: newState,
            renderedRange,
            ...result
        } = state.render({
            itemCount: getItemCount(),
            getItem,
        });
        state = newState;
        expect(result).toEqual({
            children: [
                <div style={{top: 0}}>0</div>,
                <div style={{top: 10}}>1</div>,
                <div style={{top: 20}}>2</div>,
                <div style={{top: 30}}>3</div>,
                <div style={{top: 40}}>4</div>,
                <div style={{top: 50}}>5</div>,
                <div style={{top: 60}}>6</div>,
                <div style={{top: 70}}>7</div>,
                <div style={{top: 80}}>8</div>,
                <div style={{top: 90}}>9</div>,
                <div style={{top: 100}}>10</div>,
                <div style={{top: 110}}>11</div>,
                <div style={{top: 120}}>12</div>,
                <div style={{top: 130}}>13</div>,
                <div style={{top: 140}}>14</div>,
                <div style={{top: 150}}>15</div>,
                <div style={{top: 160}}>16</div>,
                <div style={{top: 170}}>17</div>,
                <div style={{top: 180}}>18</div>,
                <div style={{top: 190}}>19</div>,
            ],
            contentHeight: 1000,
            bufferedHeightBeforeChildren: 0,
        });
    }

    skipIndex = 4;

    {
        const {
            state: newState,
            renderedRange,
            ...result
        } = state.render({
            itemCount: getItemCount(),
            getItem,
        });
        state = newState;
        expect(result).toEqual({
            children: [
                <div style={{top: 0}}>0</div>,
                <div style={{top: 10}}>1</div>,
                <div style={{top: 20}}>2</div>,
                <div style={{top: 30}}>3</div>,
                <div style={{top: 40}}>5</div>,
                <div style={{top: 50}}>6</div>,
                <div style={{top: 60}}>7</div>,
                <div style={{top: 70}}>8</div>,
                <div style={{top: 80}}>9</div>,
                <div style={{top: 90}}>10</div>,
                <div style={{top: 100}}>11</div>,
                <div style={{top: 110}}>12</div>,
                <div style={{top: 120}}>13</div>,
                <div style={{top: 130}}>14</div>,
                <div style={{top: 140}}>15</div>,
                <div style={{top: 150}}>16</div>,
                <div style={{top: 160}}>17</div>,
                <div style={{top: 170}}>18</div>,
                <div style={{top: 180}}>19</div>,
                <div style={{top: 190}}>20</div>,
            ],
            contentHeight: 990,
            bufferedHeightBeforeChildren: 0,
        });
    }

    state = state.updateRenderedRange({
        scrollOffset: 0,
        itemCount: getItemCount(),
        getItem,
    });

    {
        const {
            state: newState,
            renderedRange,
            ...result
        } = state.render({
            itemCount: getItemCount(),
            getItem,
        });
        state = newState;
        expect(result).toEqual({
            children: [
                <div style={{top: 0}}>0</div>,
                <div style={{top: 10}}>1</div>,
                <div style={{top: 20}}>2</div>,
                <div style={{top: 30}}>3</div>,
                <div style={{top: 40}}>5</div>,
                <div style={{top: 50}}>6</div>,
                <div style={{top: 60}}>7</div>,
                <div style={{top: 70}}>8</div>,
                <div style={{top: 80}}>9</div>,
                <div style={{top: 90}}>10</div>,
                <div style={{top: 100}}>11</div>,
                <div style={{top: 110}}>12</div>,
                <div style={{top: 120}}>13</div>,
                <div style={{top: 130}}>14</div>,
                <div style={{top: 140}}>15</div>,
                <div style={{top: 150}}>16</div>,
                <div style={{top: 160}}>17</div>,
                <div style={{top: 170}}>18</div>,
                <div style={{top: 180}}>19</div>,
                <div style={{top: 190}}>20</div>,
            ],
            contentHeight: 990,
            bufferedHeightBeforeChildren: 0,
        });
    }

    skipIndex = null;

    {
        const {
            state: newState,
            renderedRange,
            ...result
        } = state.render({
            itemCount: getItemCount(),
            getItem,
        });
        state = newState;
        expect(result).toEqual({
            children: [
                <div style={{top: 0}}>0</div>,
                <div style={{top: 10}}>1</div>,
                <div style={{top: 20}}>2</div>,
                <div style={{top: 30}}>3</div>,
                <div style={{top: 40}}>4</div>,
                <div style={{top: 50}}>5</div>,
                <div style={{top: 60}}>6</div>,
                <div style={{top: 70}}>7</div>,
                <div style={{top: 80}}>8</div>,
                <div style={{top: 90}}>9</div>,
                <div style={{top: 100}}>10</div>,
                <div style={{top: 110}}>11</div>,
                <div style={{top: 120}}>12</div>,
                <div style={{top: 130}}>13</div>,
                <div style={{top: 140}}>14</div>,
                <div style={{top: 150}}>15</div>,
                <div style={{top: 160}}>16</div>,
                <div style={{top: 170}}>17</div>,
                <div style={{top: 180}}>18</div>,
                <div style={{top: 190}}>19</div>,
            ],
            contentHeight: 1000,
            bufferedHeightBeforeChildren: 0,
        });
    }

    state = state.updateRenderedRange({
        scrollOffset: 0,
        itemCount: getItemCount(),
        getItem,
    });

    {
        const {
            state: newState,
            renderedRange,
            ...result
        } = state.render({
            itemCount: getItemCount(),
            getItem,
        });
        state = newState;
        expect(result).toEqual({
            children: [
                <div style={{top: 0}}>0</div>,
                <div style={{top: 10}}>1</div>,
                <div style={{top: 20}}>2</div>,
                <div style={{top: 30}}>3</div>,
                <div style={{top: 40}}>4</div>,
                <div style={{top: 50}}>5</div>,
                <div style={{top: 60}}>6</div>,
                <div style={{top: 70}}>7</div>,
                <div style={{top: 80}}>8</div>,
                <div style={{top: 90}}>9</div>,
                <div style={{top: 100}}>10</div>,
                <div style={{top: 110}}>11</div>,
                <div style={{top: 120}}>12</div>,
                <div style={{top: 130}}>13</div>,
                <div style={{top: 140}}>14</div>,
                <div style={{top: 150}}>15</div>,
                <div style={{top: 160}}>16</div>,
                <div style={{top: 170}}>17</div>,
                <div style={{top: 180}}>18</div>,
                <div style={{top: 190}}>19</div>,
            ],
            contentHeight: 1000,
            bufferedHeightBeforeChildren: 0,
        });
    }
});

test("an item maintains its height when expanding and collapsing another item", () => {
    let skipIndex: number | null = null;

    const getItemCount = () => 100 - (skipIndex !== null ? 1 : 0);

    const getItem = (index: number) => {
        if (skipIndex !== null && index >= skipIndex) {
            index += 1;
        }
        return {
            key: index,
            minHeight: 10,
            render: ({offset}: {offset: number}) => (
                <div style={{top: offset}}>{String(index)}</div>
            ),
        };
    };

    let state = VirtualizedScrollViewState.initializeFromTop({
        initialViewHeight: 100,
        bufferedItemHeight: 10,
        itemCount: getItemCount(),
        getItem,
    });

    state = state.setItemHeight(14, 20);

    {
        const {
            state: newState,
            renderedRange,
            ...result
        } = state.render({
            itemCount: getItemCount(),
            getItem,
        });
        state = newState;
        expect(result).toEqual({
            children: [
                <div style={{top: 0}}>0</div>,
                <div style={{top: 10}}>1</div>,
                <div style={{top: 20}}>2</div>,
                <div style={{top: 30}}>3</div>,
                <div style={{top: 40}}>4</div>,
                <div style={{top: 50}}>5</div>,
                <div style={{top: 60}}>6</div>,
                <div style={{top: 70}}>7</div>,
                <div style={{top: 80}}>8</div>,
                <div style={{top: 90}}>9</div>,
                <div style={{top: 100}}>10</div>,
                <div style={{top: 110}}>11</div>,
                <div style={{top: 120}}>12</div>,
                <div style={{top: 130}}>13</div>,
                <div style={{top: 140}}>14</div>,
                <div style={{top: 160}}>15</div>,
                <div style={{top: 170}}>16</div>,
                <div style={{top: 180}}>17</div>,
                <div style={{top: 190}}>18</div>,
                <div style={{top: 200}}>19</div>,
            ],
            contentHeight: 1010,
            bufferedHeightBeforeChildren: 0,
        });
    }

    skipIndex = 4;

    {
        const {
            state: newState,
            renderedRange,
            ...result
        } = state.render({
            itemCount: getItemCount(),
            getItem,
        });
        state = newState;
        expect(result).toEqual({
            children: [
                <div style={{top: 0}}>0</div>,
                <div style={{top: 10}}>1</div>,
                <div style={{top: 20}}>2</div>,
                <div style={{top: 30}}>3</div>,
                <div style={{top: 40}}>5</div>,
                <div style={{top: 50}}>6</div>,
                <div style={{top: 60}}>7</div>,
                <div style={{top: 70}}>8</div>,
                <div style={{top: 80}}>9</div>,
                <div style={{top: 90}}>10</div>,
                <div style={{top: 100}}>11</div>,
                <div style={{top: 110}}>12</div>,
                <div style={{top: 120}}>13</div>,
                <div style={{top: 130}}>14</div>,
                <div style={{top: 150}}>15</div>,
                <div style={{top: 160}}>16</div>,
                <div style={{top: 170}}>17</div>,
                <div style={{top: 180}}>18</div>,
                <div style={{top: 190}}>19</div>,
                <div style={{top: 200}}>20</div>,
            ],
            contentHeight: 1000,
            bufferedHeightBeforeChildren: 0,
        });
    }

    state = state.updateRenderedRange({
        scrollOffset: 0,
        itemCount: getItemCount(),
        getItem,
    });

    {
        const {
            state: newState,
            renderedRange,
            ...result
        } = state.render({
            itemCount: getItemCount(),
            getItem,
        });
        state = newState;
        expect(result).toEqual({
            children: [
                <div style={{top: 0}}>0</div>,
                <div style={{top: 10}}>1</div>,
                <div style={{top: 20}}>2</div>,
                <div style={{top: 30}}>3</div>,
                <div style={{top: 40}}>5</div>,
                <div style={{top: 50}}>6</div>,
                <div style={{top: 60}}>7</div>,
                <div style={{top: 70}}>8</div>,
                <div style={{top: 80}}>9</div>,
                <div style={{top: 90}}>10</div>,
                <div style={{top: 100}}>11</div>,
                <div style={{top: 110}}>12</div>,
                <div style={{top: 120}}>13</div>,
                <div style={{top: 130}}>14</div>,
                <div style={{top: 150}}>15</div>,
                <div style={{top: 160}}>16</div>,
                <div style={{top: 170}}>17</div>,
                <div style={{top: 180}}>18</div>,
                <div style={{top: 190}}>19</div>,
                <div style={{top: 200}}>20</div>,
            ],
            contentHeight: 1000,
            bufferedHeightBeforeChildren: 0,
        });
    }

    skipIndex = null;

    {
        const {
            state: newState,
            renderedRange,
            ...result
        } = state.render({
            itemCount: getItemCount(),
            getItem,
        });
        state = newState;
        expect(result).toEqual({
            children: [
                <div style={{top: 0}}>0</div>,
                <div style={{top: 10}}>1</div>,
                <div style={{top: 20}}>2</div>,
                <div style={{top: 30}}>3</div>,
                <div style={{top: 40}}>4</div>,
                <div style={{top: 50}}>5</div>,
                <div style={{top: 60}}>6</div>,
                <div style={{top: 70}}>7</div>,
                <div style={{top: 80}}>8</div>,
                <div style={{top: 90}}>9</div>,
                <div style={{top: 100}}>10</div>,
                <div style={{top: 110}}>11</div>,
                <div style={{top: 120}}>12</div>,
                <div style={{top: 130}}>13</div>,
                <div style={{top: 140}}>14</div>,
                <div style={{top: 160}}>15</div>,
                <div style={{top: 170}}>16</div>,
                <div style={{top: 180}}>17</div>,
                <div style={{top: 190}}>18</div>,
                <div style={{top: 200}}>19</div>,
            ],
            contentHeight: 1010,
            bufferedHeightBeforeChildren: 0,
        });
    }

    state = state.updateRenderedRange({
        scrollOffset: 0,
        itemCount: getItemCount(),
        getItem,
    });

    {
        const {
            state: newState,
            renderedRange,
            ...result
        } = state.render({
            itemCount: getItemCount(),
            getItem,
        });
        state = newState;
        expect(result).toEqual({
            children: [
                <div style={{top: 0}}>0</div>,
                <div style={{top: 10}}>1</div>,
                <div style={{top: 20}}>2</div>,
                <div style={{top: 30}}>3</div>,
                <div style={{top: 40}}>4</div>,
                <div style={{top: 50}}>5</div>,
                <div style={{top: 60}}>6</div>,
                <div style={{top: 70}}>7</div>,
                <div style={{top: 80}}>8</div>,
                <div style={{top: 90}}>9</div>,
                <div style={{top: 100}}>10</div>,
                <div style={{top: 110}}>11</div>,
                <div style={{top: 120}}>12</div>,
                <div style={{top: 130}}>13</div>,
                <div style={{top: 140}}>14</div>,
                <div style={{top: 160}}>15</div>,
                <div style={{top: 170}}>16</div>,
                <div style={{top: 180}}>17</div>,
                <div style={{top: 190}}>18</div>,
                <div style={{top: 200}}>19</div>,
            ],
            contentHeight: 1010,
            bufferedHeightBeforeChildren: 0,
        });
    }
});

test("reproduce jump to reply scroll bug", () => {
    withRealVirtualizationWindowHeightForTest(() => {
        const itemCount = 1013;

        const getItem = (index: number) => ({
            key: index === 0 ? "PostContent" : `PostComment:${index - 1}`,
            minHeight: index === 0 ? 376 : 34,
            render: ({offset}: {offset: number}) => (
                <div style={{top: offset}}>{String(index)}</div>
            ),
        });

        let state = VirtualizedScrollViewState.initializeFromTop({
            initialViewHeight: 1080,
            bufferedItemHeight: 176,
            itemCount,
            getItem,
        });

        state = state.setViewHeight(980);
        state = state.setItemHeight("PostComment:0", 64);

        state = state.updateRenderedRange({
            scrollOffset: 530,
            itemCount,
            getItem,
        });

        const lastPosition = state.getPositionByIndex(515);

        let scrollOffset = 82296;

        state = state.updateRenderedRange({
            scrollOffset,
            itemCount,
            getItem,
        });

        // NOTE(calebmer): The bug was reading the `nextPosition` here BEFORE updating
        // item heights. This ended up being a bug in `<VirtualizedScrollView>`, not
        // `VirtualizedScrollViewState`. Leaving this test here since it exercises some
        // interesting behavior even though it didn't expose the bug I was looking for.
        //
        // const nextPosition = state.getPositionByIndex(515);

        for (let i = 509; i <= 591; i++) {
            state = state.setItemHeight(`PostComment:${i}`, 274);
        }

        const nextPosition = state.getPositionByIndex(515);

        const scrollAdjustment = nextPosition.offset - lastPosition.offset;

        scrollOffset += scrollAdjustment;

        state = state.updateRenderedRange({
            scrollOffset,
            itemCount,
            getItem,
        });

        const {startIndex, endIndex} = assertExists(state.getRenderedRange());
        const startPosition = state.getPositionByIndex(startIndex);
        const endPosition = state.getPositionByIndex(endIndex);

        expect(scrollOffset).toBeGreaterThanOrEqual(startPosition.offset);
        expect(scrollOffset).toBeLessThanOrEqual(endPosition.offset + endPosition.height);
    });
});

test("can always render additional items", () => {
    const itemCount = 1_000;

    const getItem = (index: number) => {
        return {
            key: index,
            minHeight: 10,
            render: ({offset}: {offset: number}) => (
                <div style={{top: offset}}>{String(index)}</div>
            ),
        };
    };

    let state = VirtualizedScrollViewState.initializeFromTop({
        initialViewHeight: 100,
        bufferedItemHeight: 5,
        itemCount,
        getItem,
    });

    {
        const {
            state: newState,
            renderedRange,
            ...renderResult
        } = state.render({
            itemCount,
            getItem,
        });
        state = newState;

        expect(renderResult).toEqual({
            children: [
                <div style={{top: 0}}>0</div>,
                <div style={{top: 10}}>1</div>,
                <div style={{top: 20}}>2</div>,
                <div style={{top: 30}}>3</div>,
                <div style={{top: 40}}>4</div>,
                <div style={{top: 50}}>5</div>,
                <div style={{top: 60}}>6</div>,
                <div style={{top: 70}}>7</div>,
                <div style={{top: 80}}>8</div>,
                <div style={{top: 90}}>9</div>,
                <div style={{top: 100}}>10</div>,
                <div style={{top: 110}}>11</div>,
                <div style={{top: 120}}>12</div>,
                <div style={{top: 130}}>13</div>,
                <div style={{top: 140}}>14</div>,
                <div style={{top: 150}}>15</div>,
                <div style={{top: 160}}>16</div>,
                <div style={{top: 170}}>17</div>,
                <div style={{top: 180}}>18</div>,
                <div style={{top: 190}}>19</div>,
            ],
            contentHeight: 10 * 20 + 5 * (itemCount - 20),
            bufferedHeightBeforeChildren: 0,
        });
    }

    {
        const {
            state: newState,
            renderedRange,
            ...renderResult
        } = state.render({
            itemCount,
            getItem,
            alwaysRenderAdditionalItemIndexes: [600, 500, 500],
        });
        state = newState;

        expect(renderResult).toEqual({
            children: [
                <div style={{top: 0}}>0</div>,
                <div style={{top: 10}}>1</div>,
                <div style={{top: 20}}>2</div>,
                <div style={{top: 30}}>3</div>,
                <div style={{top: 40}}>4</div>,
                <div style={{top: 50}}>5</div>,
                <div style={{top: 60}}>6</div>,
                <div style={{top: 70}}>7</div>,
                <div style={{top: 80}}>8</div>,
                <div style={{top: 90}}>9</div>,
                <div style={{top: 100}}>10</div>,
                <div style={{top: 110}}>11</div>,
                <div style={{top: 120}}>12</div>,
                <div style={{top: 130}}>13</div>,
                <div style={{top: 140}}>14</div>,
                <div style={{top: 150}}>15</div>,
                <div style={{top: 160}}>16</div>,
                <div style={{top: 170}}>17</div>,
                <div style={{top: 180}}>18</div>,
                <div style={{top: 190}}>19</div>,
                <div style={{top: 2600}}>500</div>,
                <div style={{top: 3105}}>600</div>,
            ],
            contentHeight: 10 * 22 + 5 * (itemCount - 22),
            bufferedHeightBeforeChildren: 0,
        });
    }

    state = state.updateRenderedRange({
        scrollOffset: 610,
        itemCount,
        getItem,
    });

    {
        const {
            state: newState,
            renderedRange,
            ...renderResult
        } = state.render({
            itemCount,
            getItem,
        });
        state = newState;

        expect(renderResult).toEqual({
            children: [
                <div style={{top: 560}}>92</div>,
                <div style={{top: 570}}>93</div>,
                <div style={{top: 580}}>94</div>,
                <div style={{top: 590}}>95</div>,
                <div style={{top: 600}}>96</div>,
                <div style={{top: 610}}>97</div>,
                <div style={{top: 620}}>98</div>,
                <div style={{top: 630}}>99</div>,
                <div style={{top: 640}}>100</div>,
                <div style={{top: 650}}>101</div>,
                <div style={{top: 660}}>102</div>,
                <div style={{top: 670}}>103</div>,
                <div style={{top: 680}}>104</div>,
                <div style={{top: 690}}>105</div>,
                <div style={{top: 700}}>106</div>,
                <div style={{top: 710}}>107</div>,
                <div style={{top: 720}}>108</div>,
                <div style={{top: 730}}>109</div>,
                <div style={{top: 740}}>110</div>,
                <div style={{top: 750}}>111</div>,
            ],
            contentHeight: 10 * 42 + 5 * (itemCount - 42),
            bufferedHeightBeforeChildren: 560,
        });
    }

    {
        const {
            state: newState,
            renderedRange,
            ...renderResult
        } = state.render({
            itemCount,
            getItem,
            alwaysRenderAdditionalItemIndexes: [60, 60, 50],
        });
        state = newState;

        expect(renderResult).toEqual({
            children: [
                <div style={{top: 350}}>50</div>,
                <div style={{top: 405}}>60</div>,
                <div style={{top: 570}}>92</div>,
                <div style={{top: 580}}>93</div>,
                <div style={{top: 590}}>94</div>,
                <div style={{top: 600}}>95</div>,
                <div style={{top: 610}}>96</div>,
                <div style={{top: 620}}>97</div>,
                <div style={{top: 630}}>98</div>,
                <div style={{top: 640}}>99</div>,
                <div style={{top: 650}}>100</div>,
                <div style={{top: 660}}>101</div>,
                <div style={{top: 670}}>102</div>,
                <div style={{top: 680}}>103</div>,
                <div style={{top: 690}}>104</div>,
                <div style={{top: 700}}>105</div>,
                <div style={{top: 710}}>106</div>,
                <div style={{top: 720}}>107</div>,
                <div style={{top: 730}}>108</div>,
                <div style={{top: 740}}>109</div>,
                <div style={{top: 750}}>110</div>,
                <div style={{top: 760}}>111</div>,
            ],
            contentHeight: 10 * 44 + 5 * (itemCount - 44),
            bufferedHeightBeforeChildren: 570,
        });
    }
});

test("render will expand rendered range when adding items", () => {
    let itemCount = 3;
    const getItem = (index: number) => ({
        key: index,
        minHeight: 10,
        render: ({offset}: {offset: number}) => <div style={{top: offset}}>{String(index)}</div>,
    });

    let state = VirtualizedScrollViewState.initializeFromTop({
        initialViewHeight: 100,
        bufferedItemHeight: 10,
        itemCount,
        getItem,
    });

    // eslint-disable-next-line testing-library/render-result-naming-convention
    let renderedRange = state.getRenderedRange();

    {
        let result;
        ({state, renderedRange, ...result} = state.render({
            itemCount,
            getItem,
        }));
        expect(result).toEqual({
            children: [
                <div style={{top: 0}}>0</div>,
                <div style={{top: 10}}>1</div>,
                <div style={{top: 20}}>2</div>,
            ],
            contentHeight: 30,
            bufferedHeightBeforeChildren: 0,
        });
    }

    itemCount = 4;

    {
        let result;
        ({state, renderedRange, ...result} = state.render({
            itemCount,
            getItem,
        }));
        expect(result).toEqual({
            children: [
                <div style={{top: 0}}>0</div>,
                <div style={{top: 10}}>1</div>,
                <div style={{top: 20}}>2</div>,
                <div style={{top: 30}}>3</div>,
            ],
            contentHeight: 40,
            bufferedHeightBeforeChildren: 0,
        });
    }

    state = state.updateRenderedRange({
        scrollOffset: 0,
        itemCount,
        getItem,
    });

    {
        let result;
        ({state, renderedRange, ...result} = state.render({
            itemCount,
            getItem,
        }));
        expect(result).toEqual({
            children: [
                <div style={{top: 0}}>0</div>,
                <div style={{top: 10}}>1</div>,
                <div style={{top: 20}}>2</div>,
                <div style={{top: 30}}>3</div>,
            ],
            contentHeight: 40,
            bufferedHeightBeforeChildren: 0,
        });
    }

    itemCount = 500;

    {
        let result;
        ({state, renderedRange, ...result} = state.render({
            itemCount,
            getItem,
        }));
        expect(result).toEqual({
            children: [
                <div style={{top: 0}}>0</div>,
                <div style={{top: 10}}>1</div>,
                <div style={{top: 20}}>2</div>,
                <div style={{top: 30}}>3</div>,
                <div style={{top: 40}}>4</div>,
                <div style={{top: 50}}>5</div>,
                <div style={{top: 60}}>6</div>,
                <div style={{top: 70}}>7</div>,
                <div style={{top: 80}}>8</div>,
                <div style={{top: 90}}>9</div>,
                <div style={{top: 100}}>10</div>,
                <div style={{top: 110}}>11</div>,
                <div style={{top: 120}}>12</div>,
                <div style={{top: 130}}>13</div>,
            ],
            contentHeight: 5000,
            bufferedHeightBeforeChildren: 0,
        });
    }

    state = state.updateRenderedRange({
        scrollOffset: 0,
        itemCount,
        getItem,
    });

    {
        let result;
        ({state, renderedRange, ...result} = state.render({
            itemCount,
            getItem,
        }));
        expect(result).toEqual({
            children: [
                <div style={{top: 0}}>0</div>,
                <div style={{top: 10}}>1</div>,
                <div style={{top: 20}}>2</div>,
                <div style={{top: 30}}>3</div>,
                <div style={{top: 40}}>4</div>,
                <div style={{top: 50}}>5</div>,
                <div style={{top: 60}}>6</div>,
                <div style={{top: 70}}>7</div>,
                <div style={{top: 80}}>8</div>,
                <div style={{top: 90}}>9</div>,
                <div style={{top: 100}}>10</div>,
                <div style={{top: 110}}>11</div>,
                <div style={{top: 120}}>12</div>,
                <div style={{top: 130}}>13</div>,
                <div style={{top: 140}}>14</div>,
            ],
            contentHeight: 5000,
            bufferedHeightBeforeChildren: 0,
        });
    }

    state = state.updateRenderedRange({
        scrollOffset: 5000 - state.getViewHeight(),
        itemCount,
        getItem,
    });

    {
        let result;
        ({state, renderedRange, ...result} = state.render({
            itemCount,
            getItem,
        }));
        expect(result).toEqual({
            children: [
                <div style={{top: 4850}}>485</div>,
                <div style={{top: 4860}}>486</div>,
                <div style={{top: 4870}}>487</div>,
                <div style={{top: 4880}}>488</div>,
                <div style={{top: 4890}}>489</div>,
                <div style={{top: 4900}}>490</div>,
                <div style={{top: 4910}}>491</div>,
                <div style={{top: 4920}}>492</div>,
                <div style={{top: 4930}}>493</div>,
                <div style={{top: 4940}}>494</div>,
                <div style={{top: 4950}}>495</div>,
                <div style={{top: 4960}}>496</div>,
                <div style={{top: 4970}}>497</div>,
                <div style={{top: 4980}}>498</div>,
                <div style={{top: 4990}}>499</div>,
            ],
            contentHeight: 5000,
            bufferedHeightBeforeChildren: 4850,
        });
    }

    itemCount += 2;

    {
        let result;
        ({state, renderedRange, ...result} = state.render({
            itemCount,
            getItem,
        }));
        expect(result).toEqual({
            children: [
                <div style={{top: 4850}}>485</div>,
                <div style={{top: 4860}}>486</div>,
                <div style={{top: 4870}}>487</div>,
                <div style={{top: 4880}}>488</div>,
                <div style={{top: 4890}}>489</div>,
                <div style={{top: 4900}}>490</div>,
                <div style={{top: 4910}}>491</div>,
                <div style={{top: 4920}}>492</div>,
                <div style={{top: 4930}}>493</div>,
                <div style={{top: 4940}}>494</div>,
                <div style={{top: 4950}}>495</div>,
                <div style={{top: 4960}}>496</div>,
                <div style={{top: 4970}}>497</div>,
                <div style={{top: 4980}}>498</div>,
                <div style={{top: 4990}}>499</div>,
                <div style={{top: 5000}}>500</div>,
                <div style={{top: 5010}}>501</div>,
            ],
            contentHeight: 5020,
            bufferedHeightBeforeChildren: 4850,
        });
    }
});

test("works with sub-pixel item heights", () => {
    const itemCount = 500;
    const getItem = (index: number) => ({
        key: index,
        minHeight: 10 + (index % 2 === 1 ? 0.5 : 0),
        render: ({offset}: {offset: number}) => <div style={{top: offset}}>{String(index)}</div>,
    });

    let state = VirtualizedScrollViewState.initializeFromBottom({
        initialViewHeight: 100,
        bufferedItemHeight: 10,
        itemCount,
        getItem,
    });

    // eslint-disable-next-line testing-library/render-result-naming-convention
    let renderedRange = state.getRenderedRange();

    {
        let result;
        ({state, renderedRange, ...result} = state.render({
            itemCount,
            getItem,
        }));
        expect(result).toEqual({
            children: [
                <div style={{top: 4800}}>480</div>,
                <div style={{top: 4810}}>481</div>,
                <div style={{top: 4820.5}}>482</div>,
                <div style={{top: 4830.5}}>483</div>,
                <div style={{top: 4841}}>484</div>,
                <div style={{top: 4851}}>485</div>,
                <div style={{top: 4861.5}}>486</div>,
                <div style={{top: 4871.5}}>487</div>,
                <div style={{top: 4882}}>488</div>,
                <div style={{top: 4892}}>489</div>,
                <div style={{top: 4902.5}}>490</div>,
                <div style={{top: 4912.5}}>491</div>,
                <div style={{top: 4923}}>492</div>,
                <div style={{top: 4933}}>493</div>,
                <div style={{top: 4943.5}}>494</div>,
                <div style={{top: 4953.5}}>495</div>,
                <div style={{top: 4964}}>496</div>,
                <div style={{top: 4974}}>497</div>,
                <div style={{top: 4984.5}}>498</div>,
                <div style={{top: 4994.5}}>499</div>,
            ],
            contentHeight: 5005,
            bufferedHeightBeforeChildren: 4800,
        });
    }

    state = state.updateRenderedRange({
        scrollOffset: 4905,
        itemCount,
        getItem,
    });

    {
        let result;
        ({state, renderedRange, ...result} = state.render({
            itemCount,
            getItem,
        }));
        expect(result).toEqual({
            children: [
                <div style={{top: 4800}}>480</div>,
                <div style={{top: 4810}}>481</div>,
                <div style={{top: 4820.5}}>482</div>,
                <div style={{top: 4830.5}}>483</div>,
                <div style={{top: 4841}}>484</div>,
                <div style={{top: 4851}}>485</div>,
                <div style={{top: 4861.5}}>486</div>,
                <div style={{top: 4871.5}}>487</div>,
                <div style={{top: 4882}}>488</div>,
                <div style={{top: 4892}}>489</div>,
                <div style={{top: 4902.5}}>490</div>,
                <div style={{top: 4912.5}}>491</div>,
                <div style={{top: 4923}}>492</div>,
                <div style={{top: 4933}}>493</div>,
                <div style={{top: 4943.5}}>494</div>,
                <div style={{top: 4953.5}}>495</div>,
                <div style={{top: 4964}}>496</div>,
                <div style={{top: 4974}}>497</div>,
                <div style={{top: 4984.5}}>498</div>,
                <div style={{top: 4994.5}}>499</div>,
            ],
            contentHeight: 5005,
            bufferedHeightBeforeChildren: 4800,
        });
    }

    state = state.updateRenderedRange({
        scrollOffset: 4890,
        itemCount,
        getItem,
    });

    {
        let result;
        ({state, renderedRange, ...result} = state.render({
            itemCount,
            getItem,
        }));
        expect(result).toEqual({
            children: [
                <div style={{top: 4800}}>480</div>,
                <div style={{top: 4810}}>481</div>,
                <div style={{top: 4820.5}}>482</div>,
                <div style={{top: 4830.5}}>483</div>,
                <div style={{top: 4841}}>484</div>,
                <div style={{top: 4851}}>485</div>,
                <div style={{top: 4861.5}}>486</div>,
                <div style={{top: 4871.5}}>487</div>,
                <div style={{top: 4882}}>488</div>,
                <div style={{top: 4892}}>489</div>,
                <div style={{top: 4902.5}}>490</div>,
                <div style={{top: 4912.5}}>491</div>,
                <div style={{top: 4923}}>492</div>,
                <div style={{top: 4933}}>493</div>,
                <div style={{top: 4943.5}}>494</div>,
                <div style={{top: 4953.5}}>495</div>,
                <div style={{top: 4964}}>496</div>,
                <div style={{top: 4974}}>497</div>,
                <div style={{top: 4984.5}}>498</div>,
                <div style={{top: 4994.5}}>499</div>,
            ],
            contentHeight: 5005,
            bufferedHeightBeforeChildren: 4800,
        });
    }

    state = state.updateRenderedRange({
        scrollOffset: 4840,
        itemCount,
        getItem,
    });

    {
        let result;
        ({state, renderedRange, ...result} = state.render({
            itemCount,
            getItem,
        }));
        expect(result).toEqual({
            children: [
                <div style={{top: 4790}}>479</div>,
                <div style={{top: 4800.5}}>480</div>,
                <div style={{top: 4810.5}}>481</div>,
                <div style={{top: 4821}}>482</div>,
                <div style={{top: 4831}}>483</div>,
                <div style={{top: 4841.5}}>484</div>,
                <div style={{top: 4851.5}}>485</div>,
                <div style={{top: 4862}}>486</div>,
                <div style={{top: 4872}}>487</div>,
                <div style={{top: 4882.5}}>488</div>,
                <div style={{top: 4892.5}}>489</div>,
                <div style={{top: 4903}}>490</div>,
                <div style={{top: 4913}}>491</div>,
                <div style={{top: 4923.5}}>492</div>,
                <div style={{top: 4933.5}}>493</div>,
                <div style={{top: 4944}}>494</div>,
                <div style={{top: 4954}}>495</div>,
                <div style={{top: 4964.5}}>496</div>,
                <div style={{top: 4974.5}}>497</div>,
                <div style={{top: 4985}}>498</div>,
            ],
            contentHeight: 5005.5,
            bufferedHeightBeforeChildren: 4790,
        });
    }

    state = state.updateRenderedRange({
        scrollOffset: 4840,
        itemCount,
        getItem,
    });

    {
        let result;
        ({state, renderedRange, ...result} = state.render({
            itemCount,
            getItem,
        }));
        expect(result).toEqual({
            children: [
                <div style={{top: 4790}}>479</div>,
                <div style={{top: 4800.5}}>480</div>,
                <div style={{top: 4810.5}}>481</div>,
                <div style={{top: 4821}}>482</div>,
                <div style={{top: 4831}}>483</div>,
                <div style={{top: 4841.5}}>484</div>,
                <div style={{top: 4851.5}}>485</div>,
                <div style={{top: 4862}}>486</div>,
                <div style={{top: 4872}}>487</div>,
                <div style={{top: 4882.5}}>488</div>,
                <div style={{top: 4892.5}}>489</div>,
                <div style={{top: 4903}}>490</div>,
                <div style={{top: 4913}}>491</div>,
                <div style={{top: 4923.5}}>492</div>,
                <div style={{top: 4933.5}}>493</div>,
                <div style={{top: 4944}}>494</div>,
                <div style={{top: 4954}}>495</div>,
                <div style={{top: 4964.5}}>496</div>,
                <div style={{top: 4974.5}}>497</div>,
                <div style={{top: 4985}}>498</div>,
            ],
            contentHeight: 5005.5,
            bufferedHeightBeforeChildren: 4790,
        });
    }
});
