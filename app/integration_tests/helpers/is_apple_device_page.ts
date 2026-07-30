import {type Page} from "@playwright/test";
import {getOrSetDefaultMapValue} from "~/shared/helpers/map/get_or_set_default_map_value.js";

const isAppleDeviceByPage = new WeakMap<Page, Promise<boolean>>();

export async function isAppleDevicePage(page: Page): Promise<boolean> {
    return await getOrSetDefaultMapValue(
        isAppleDeviceByPage,
        page,
        async () =>
            await page.evaluate(
                () =>
                    /Mac|iPhone|iPad|iPod/.test(navigator.userAgent) ||
                    /Mac/.test(navigator.platform),
            ),
    );
}
