import {ThemeColor} from "~/shared/design/theme_colors";
import {LocalTaskCollectionId} from "~/shared/id/types/id_types";

export type LocalTaskCollection = {
    readonly id: LocalTaskCollectionId;
    readonly name: string;
    readonly color: ThemeColor;
};
