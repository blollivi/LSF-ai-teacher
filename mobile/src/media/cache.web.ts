import { absolute, type ApiConfig } from '../api/client';

/** expo-file-system has no web support; the browser HTTP cache plays that role, so stream from the server. */
export async function cacheMedia(cfg: ApiConfig, remotePath: string): Promise<string> {
  return absolute(cfg, remotePath);
}
