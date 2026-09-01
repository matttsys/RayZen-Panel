/**
 * One-way settings loader.
 *
 * KV access stays out of `settings.ts` so settings state has no static dependency
 * back into persistence. This removes a real module-evaluation cycle independently
 * of the browser setup incident; a DOM `HTMLFormElement` stack cannot originate from
 * this Worker-side module graph.
 */
import { getDataset } from '@kv';
import { applySettingsDataset } from '@settings';

export async function setSettings(env: Env) {
    const dataset = await getDataset(env);
    applySettingsDataset(dataset.settings, dataset.warpAccounts);
}
