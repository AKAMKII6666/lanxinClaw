import { readdir, stat } from "node:fs/promises";
import path from "node:path";

export function toPosix(filePath) {
  return filePath.split(path.sep).join("/");
}

export async function exists(filePath) {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function walkFiles(root, options = {}) {
  const out = [];
  const excludeDirNames = new Set(options.excludeDirNames ?? []);
  const extensions = new Set(options.extensions ?? []);

  async function walk(dir) {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (!excludeDirNames.has(entry.name)) {
          await walk(path.join(dir, entry.name));
        }
        continue;
      }

      if (!entry.isFile()) continue;
      const ext = path.extname(entry.name);
      if (extensions.size === 0 || extensions.has(ext)) {
        out.push(path.join(dir, entry.name));
      }
    }
  }

  await walk(root);
  return out;
}

export async function listDirs(dir) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
}

