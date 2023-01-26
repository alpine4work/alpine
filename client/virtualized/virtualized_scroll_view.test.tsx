import {adjustVirtualizedScrollViewRenderedRange} from "~/client/virtualized/virtualized_scroll_view";
import {remPxByPlatform} from "~/shared/design/spacing";

test("adjusting rendered range assigns removed item height proportionally", () => {
    expect(
        adjustVirtualizedScrollViewRenderedRange(
            {
                itemCount: 120,
                startIndex: 60,
                endIndex: 80,
                bufferedLeadingHeight: 3000,
                bufferedTrailingHeight: 1000,
                remPx: remPxByPlatform.desktop,
            },
            115,
            remPxByPlatform.desktop,
        ),
    ).toEqual({
        itemCount: 115,
        startIndex: 60,
        endIndex: 80,
        bufferedLeadingHeight: 3000 - 150,
        bufferedTrailingHeight: 1000 - 50,
        remPx: remPxByPlatform.desktop,
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
                remPx: remPxByPlatform.desktop,
            },
            125,
            remPxByPlatform.desktop,
        ),
    ).toEqual({
        itemCount: 125,
        startIndex: 60,
        endIndex: 80,
        bufferedLeadingHeight: 3000 + 150,
        bufferedTrailingHeight: 1000 + 50,
        remPx: remPxByPlatform.desktop,
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
                remPx: remPxByPlatform.desktop,
            },
            70,
            remPxByPlatform.desktop,
        ),
    ).toEqual({
        itemCount: 70,
        startIndex: 49,
        endIndex: 69,
        bufferedLeadingHeight: 2000,
        bufferedTrailingHeight: 0,
        remPx: remPxByPlatform.desktop,
    });
});
