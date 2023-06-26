import {maxDate, maxIsoLexicographicallySortableDate} from "~/shared/helpers/date/max_date.js";

test("we actually have the maximum date", () => {
    expect(new Date(maxDate.getTime()).toString()).not.toEqual("Invalid Date");
    expect(new Date(maxDate.getTime() + 1).toString()).toEqual("Invalid Date");
});

test("the maximum lexicographically sortable date is actually the maximum lexicographically sortable date", () => {
    expect(
        new Date(maxIsoLexicographicallySortableDate.getTime() - 1).toISOString() <
            maxIsoLexicographicallySortableDate.toISOString(),
    ).toEqual(true);
    expect(
        maxIsoLexicographicallySortableDate.toISOString() <
            new Date(maxIsoLexicographicallySortableDate.getTime() + 1).toISOString(),
    ).toEqual(false);
});
