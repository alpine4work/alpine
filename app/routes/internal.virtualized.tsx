import {useCallback} from "react";
import {Box} from "~/client/web/design/box.js";
import {useUrlSearchParamState} from "~/client/web/remix/use_url_search_param_state.js";
import {sprinkles} from "~/client/web/styles/styles.js";
import {VirtualizedScrollView} from "~/client/web/virtualized/virtualized_scroll_view.js";
import {StableRandom} from "~/shared/helpers/number/stable_random.js";

const stableRandom = new StableRandom("test");

export default function VirtualizedScrollViewDesignPlaygroundPage() {
    const [initialScrollOffsetSearchParam, setInitialScrollOffset] =
        useUrlSearchParamState("scroll");
    const initialScrollOffset =
        (initialScrollOffsetSearchParam ?? "top") === "bottom"
            ? ("bottom" as const)
            : ("top" as const);

    const [itemCountStringSearchParam, setItemCountString] = useUrlSearchParamState("count");
    const itemCountString = itemCountStringSearchParam ?? "10000";
    const itemCountNumber = parseInt(itemCountString, 10);
    const itemCount = !isNaN(itemCountNumber) ? itemCountNumber : 10000;

    return (
        <main
            className={sprinkles({
                display: "flex",
                flexDirection: "column",
                position: "relative",
            })}
            style={{height: "100svh"}}
        >
            <Box
                flexShrink="0"
                position="relative"
                zIndex="10"
                backgroundColor="grey-0"
                boxShadow="elevation-10"
                display="flex"
                padding="4"
                gap="5"
            >
                <label>
                    Initial scroll offset{" "}
                    <select
                        value={initialScrollOffset}
                        onChange={event => setInitialScrollOffset(event.currentTarget.value)}
                    >
                        <option>top</option>
                        <option>bottom</option>
                    </select>
                </label>
                <label>
                    Item count{" "}
                    <select
                        value={itemCountString}
                        onChange={event => setItemCountString(event.currentTarget.value)}
                    >
                        <option>10000</option>
                        <option>500</option>
                    </select>
                </label>
            </Box>
            <Box flexGrow="1" position="relative" zIndex="0" overflow="hidden">
                <VirtualizedScrollView
                    itemCount={itemCount}
                    renderItem={useCallback(
                        index => ({
                            minHeight: 30,
                            key: index,
                            node: (
                                <Box
                                    display="flex"
                                    alignItems="center"
                                    paddingX="4"
                                    backgroundColor={index % 2 ? "grey-0" : "grey-5"}
                                    style={{
                                        height: stableRandom.randomInteger("test", index, 30, 100),
                                    }}
                                >
                                    {index}
                                </Box>
                            ),
                        }),
                        [],
                    )}
                    bufferedItemHeight={65}
                    initialScrollOffset={initialScrollOffset}
                />
            </Box>
        </main>
    );
}
