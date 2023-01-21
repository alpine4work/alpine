import {adjustVirtualizedScrollViewRenderedRange} from "~/client/virtualized/virtualized_scroll_view";

test("adjusting rendered range assigns removed item height proportionally", () => {
    expect(
        adjustVirtualizedScrollViewRenderedRange(
            {
                itemCount: 120,
                startIndex: 60,
                endIndex: 80,
                bufferedLeadingHeight: 3000,
                bufferedTrailingHeight: 1000,
            },
            115,
        ),
    ).toEqual({
        itemCount: 115,
        startIndex: 60,
        endIndex: 80,
        bufferedLeadingHeight: 3000 - 150,
        bufferedTrailingHeight: 1000 - 50,
    });
});

test("adjusting rendered range assigns added item height proportionally", () => {
    expect(
        adjustVirtualizedScrollViewRenderedRange(
            {
                itemCount: 120,
                startIndex: 60,
                endIndex: 80,
                bufferedLeadingHeight: 3000,
                bufferedTrailingHeight: 1000,
            },
            125,
        ),
    ).toEqual({
        itemCount: 125,
        startIndex: 60,
        endIndex: 80,
        bufferedLeadingHeight: 3000 + 150,
        bufferedTrailingHeight: 1000 + 50,
    });
});

test("adjusting rendered range removes item height when truncating correctly", () => {
    expect(
        adjustVirtualizedScrollViewRenderedRange(
            {
                itemCount: 120,
                startIndex: 60,
                endIndex: 80,
                bufferedLeadingHeight: 3000,
                bufferedTrailingHeight: 1000,
            },
            70,
        ),
    ).toEqual({
        itemCount: 70,
        startIndex: 49,
        endIndex: 69,
        bufferedLeadingHeight: 2000,
        bufferedTrailingHeight: 0,
    });
});
