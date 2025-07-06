import fs, { promises as fsPromise } from 'node:fs';

const LAST_INDEX = -1;

export async function* filesTreeGenerator(directory: string, filenameFilter?: (filename: string) => boolean): AsyncGenerator<fs.Dirent> {
  for await (const dirent of await fsPromise.opendir(directory, { recursive: true })) {
    if (dirent.isFile() && (!filenameFilter || filenameFilter(dirent.name))) {
      yield dirent;
    }
  }
}

export function removeSchemaVersion(schemaId: string): string {
  // Remove the last part of the schemaId, which is the version
  return schemaId.split('/').slice(0, LAST_INDEX).join('/');
}
