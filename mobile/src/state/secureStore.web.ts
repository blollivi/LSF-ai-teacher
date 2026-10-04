/** expo-secure-store has no web implementation; fall back to localStorage for web dev/preview builds. */
export async function getItemAsync(key: string): Promise<string | null> {
  return globalThis.localStorage?.getItem(key) ?? null;
}

export async function setItemAsync(key: string, value: string): Promise<void> {
  globalThis.localStorage?.setItem(key, value);
}

export async function deleteItemAsync(key: string): Promise<void> {
  globalThis.localStorage?.removeItem(key);
}
