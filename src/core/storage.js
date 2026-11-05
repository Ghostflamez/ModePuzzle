import {migrateConfig,validate} from './engine.js';
import {stackInventory} from './inventory.js';
// Keep the original key and origin. Loading does not rewrite existing bytes.
export const STORAGE_KEY='module-layout-lab-v1';
export const UPGRADE_BACKUP_KEY='module-layout-lab-v1.before-custom';
// Copy of the configuration taken right before a save import overwrites it.
export const SAVE_IMPORT_BACKUP_KEY='module-layout-lab-v1.before-save-import';
export function backupBeforeSaveImport(storage,config){storage.setItem(SAVE_IMPORT_BACKUP_KEY,JSON.stringify(config));}
export function loadSavedConfig(storage){const raw=storage.getItem(STORAGE_KEY);return raw===null?null:stackInventory(migrateConfig(JSON.parse(raw)));}
export function saveConfig(storage,config){validate(config);const raw=storage.getItem(STORAGE_KEY);if(raw!==null&&storage.getItem(UPGRADE_BACKUP_KEY)===null)storage.setItem(UPGRADE_BACKUP_KEY,raw);storage.setItem(STORAGE_KEY,JSON.stringify(config));}
