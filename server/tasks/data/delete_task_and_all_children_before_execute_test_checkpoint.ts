import {TestCheckpoint} from "~/shared/helpers/test/test_checkpoint.js";
import {AccountId} from "~/shared/id/types/id_types.js";

export const deleteTaskAndAllChildrenBeforeExecuteTestCheckpoint = new TestCheckpoint<AccountId>();
