import { Directory, File, Paths } from 'expo-file-system';

import { absolute, type ApiConfig } from '../api/client';

function mediaDir(): Directory {
  const dir = new Directory(Paths.document, 'media');
  if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
  return dir;
}

/** Downloads a server media file (video or poster) once and returns its local uri.
 * The download lands in place only when complete, so a partial video is never shown. */
export async function cacheMedia(cfg: ApiConfig, remotePath: string): Promise<string> {
  const file = new File(mediaDir(), remotePath.split('/').pop()!);
  if (file.exists && (file.size ?? 0) > 0) return file.uri;
  const out = await File.downloadFileAsync(absolute(cfg, remotePath), file, {
    headers: { Authorization: `Bearer ${cfg.token}` },
    idempotent: true,
  });
  return out.uri;
}
