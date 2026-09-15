export const DEFAULT_BROWSER_CAPACITY: number;
export const MAX_BROWSER_CAPACITY: number;
export const CAPACITY_ENV: string;
export function validateBrowserCapacity(value: unknown): number;
export function readBrowserCapacity(coreHome: string): number;
export function saveBrowserCapacity(coreHome: string, value: unknown): number;
export function runtimeBrowserCapacity(coreHome: string, env?: Record<string, string | undefined>): number;
