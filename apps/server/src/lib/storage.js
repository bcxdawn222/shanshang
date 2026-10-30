import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

/**
 * 媒体存储（服饰原图，后续还有快照、广告视频）。
 * 现在只有本地磁盘；以后接腾讯云 COS / 火山引擎 TOS 时，另写一个同样接口的适配器，业务代码不用改。
 * key 形如 garments/<24 位十六进制>.jpg，由服务端生成，不使用用户上传的文件名。
 */
export function createLocalStorage(rootDir) {
  const resolve = (key) => {
    const full = path.resolve(rootDir, key);
    if (!full.startsWith(path.resolve(rootDir) + path.sep)) throw new Error('非法的存储路径');
    return full;
  };

  return {
    async put(dir, buffer, ext) {
      const key = `${dir}/${randomBytes(12).toString('hex')}.${ext}`;
      const full = resolve(key);
      await fs.promises.mkdir(path.dirname(full), { recursive: true });
      await fs.promises.writeFile(full, buffer);
      return key;
    },
    read(key) {
      return fs.promises.readFile(resolve(key));
    },
    open(key) {
      return fs.createReadStream(resolve(key));
    },
    async exists(key) {
      try {
        return (await fs.promises.stat(resolve(key))).isFile();
      } catch {
        return false;
      }
    },
    async remove(key) {
      await fs.promises.rm(resolve(key), { force: true });
    },
  };
}
