import {useCallback} from "react";
import {Box} from "~/client/design/box";
import {useUrlSearchParamState} from "~/client/helpers/use_url_search_param_state";
import {VirtualizedScrollView} from "~/client/virtualized/virtualized_scroll_view";
import {StableRandom} from "~/shared/helpers/number/stable_random";
import {sprinkles} from "~/shared/styles/styles";

const stableRandom = new StableRandom("test");

export default function VirtualizedScrollViewDesignPlaygroundPage() {
    const [pinToSearchParam, setPinTo] = useUrlSearchParamState("pin");
    const pinTo = pinToSearchParam ?? "top";

    const [itemCountStringSearchParam, setItemCountString] = useUrlSearchParamState("count");
    const itemCountString = itemCountStringSearchParam ?? "10000";
    const itemCountNumber = parseInt(itemCountString, 10);
    const itemCount = !isNaN(itemCountNumber) ? itemCountNumber : 10000;

    return (
        <main
            className={sprinkles({
                height: "full",
                display: "flex",
                flexDirection: "column",
                position: "relative",
            })}
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
                    Pin to{" "}
                    <select
                        value={pinTo === "top" ? "top" : "bottom"}
                        onChange={event => setPinTo(event.currentTarget.value)}
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
            <Box flexGrow="1" position="relative" zIndex="0" overflowY="hidden">
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
                                    backgroundColor={index % 2 ? "grey-0" : "grey-wash"}
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
                    pinTo={pinTo === "top" ? "top" : "bottom"}
                />
            </Box>
        </main>
    );
}
