import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';

/**
 * 媒体存储（服饰原图、收款码、广告素材、专题海报）。
 * 现在只有本地磁盘；以后接腾讯云 COS / 火山引擎 TOS 时，另写一个同样接口的适配器，业务代码不用改。
 * key 形如 garments/<24 位十六进制>.jpg，由服务端生成，不使用用户上传的文件名。
 */
export function createLocalStorage(rootDir) {
  const resolve = (key) => {
    const full = path.resolve(rootDir, key);
    if (!full.startsWith(path.resolve(rootDir) + path.sep)) throw new Error('非法的存储路径');
    return full;
  };
  const newKey = (dir, ext) => `${dir}/${randomBytes(12).toString('hex')}.${ext}`;

  return {
    async put(dir, buffer, ext) {
      const key = newKey(dir, ext);
      const full = resolve(key);
      await fs.promises.mkdir(path.dirname(full), { recursive: true });
      await fs.promises.writeFile(full, buffer);
      return key;
    },
    /** 流式写入（大视频不整个读进内存）；源流出错时删掉半截文件并抛出原错误 */
    async putStream(dir, readable, ext) {
      const key = newKey(dir, ext);
      const full = resolve(key);
      await fs.promises.mkdir(path.dirname(full), { recursive: true });
      try {
        await pipeline(readable, fs.createWriteStream(full));
      } catch (error) {
        await fs.promises.rm(full, { force: true });
        throw error;
      }
      return key;
    },
    read(key) {
      return fs.promises.readFile(resolve(key));
    },
    /** range 为 { start, end }（含 end），用于 HTTP Range */
    open(key, range) {
      return fs.createReadStream(resolve(key), range);
    },
    /** 文件大小（字节），不存在返回 null */
    async size(key) {
      try {
        const st = await fs.promises.stat(resolve(key));
        return st.isFile() ? st.size : null;
      } catch {
        return null;
      }
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
