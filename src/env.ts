// Константы, подставляемые при сборке (build.mjs).
declare const __APP_VERSION__: string;
declare const __NATIVE_VERSION__: number;
declare const __BUILD_DATE__: string;
declare const __APP_URL__: string;
declare const __COMMIT__: string;
declare const __UPDATE_TOKEN__: string;
declare const __UPDATE_REPO__: string;

export const APP_VERSION: string = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'dev';
export const NATIVE_VERSION: number = typeof __NATIVE_VERSION__ !== 'undefined' ? __NATIVE_VERSION__ : 1;
export const BUILD_DATE: string = typeof __BUILD_DATE__ !== 'undefined' ? __BUILD_DATE__ : '';
export const APP_URL: string = typeof __APP_URL__ !== 'undefined' ? __APP_URL__ : '';
export const COMMIT: string = typeof __COMMIT__ !== 'undefined' ? __COMMIT__ : '';
// Необязательный read-only токен — нужен, только если релизы лежат в приватном репозитории (форке). Только для Android.
export const UPDATE_TOKEN: string = typeof __UPDATE_TOKEN__ !== 'undefined' ? __UPDATE_TOKEN__ : '';
export const UPDATE_REPO: string = typeof __UPDATE_REPO__ !== 'undefined' ? __UPDATE_REPO__ : '';
