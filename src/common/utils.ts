import fs, { promises as fsPromise } from 'node:fs';

export async function* filesTreeGenerator(directory: string, filenameFilter?: (filename: string) => boolean): AsyncGenerator<fs.Dirent> {
  for await (const dirent of await fsPromise.opendir(directory, { recursive: true })) {
    if (dirent.isFile() && (!filenameFilter || filenameFilter(dirent.name))) {
      yield dirent;
    }
  }
}
