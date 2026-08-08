import {Item} from "react-stately";
import {TaskCollectionOption} from "~/client/web/tasks/internal/task_collection_option.js";
import {TaskCollectionId} from "~/shared/id/types/id_types.open_source.js";
import {TaskCollectionModelSearchResult} from "~/shared/tasks/model/task_collection_model_search_result.js";

export type TaskCollectionComboBoxItem =
    | TaskCollectionComboBoxCollectionItem
    | TaskCollectionComboBoxCreateCollectionItem;

export type TaskCollectionComboBoxCollectionItem = {
    readonly type: "Collection";
    readonly key: `Collection:${TaskCollectionId}`;
    readonly collectionResult: TaskCollectionModelSearchResult & {readonly score: number};
};

export type TaskCollectionComboBoxCreateCollectionItem = {
    readonly type: "CreateCollection";
    readonly key: "CreateCollection";
    readonly isInputValueEmpty: boolean;
};

export function renderTaskCollectionComboBoxItem(item: TaskCollectionComboBoxItem) {
    return item.type === "Collection" ? (
        <Item textValue={item.collectionResult.collection.getName()}>
            <TaskCollectionOption collectionResult={item.collectionResult} />
        </Item>
    ) : (
        <Item>Create collection</Item>
    );
}
