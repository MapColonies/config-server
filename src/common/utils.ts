import fs, { promises as fsPromise } from 'node:fs';
import path from 'node:path';

// export async function* filesTreeGenerator(directory: string, filenameFilter?: (filename: string) => boolean): AsyncGenerator<fs.Dirent> {
//   const directories = [directory];
//   while (directories.length > 0) {
//     const currentDirectory = directories.pop() as string;
//     const files = await fsPromise.readdir(currentDirectory, { withFileTypes: true });

//     for (const file of files) {
//       const fullPath = path.join(currentDirectory, file.name);

//       if (file.isDirectory()) {
//         directories.push(path.join(fullPath));
//         continue;
//       }

//       if (!file.isFile()) {
//         throw new Error(`Unexpected file type: ${fullPath}`);
//       }

//       if (!filenameFilter || filenameFilter(file.name)) {
//         yield file;
//       }
//     }
//   }
// }

export async function* filesTreeGenerator(directory: string, filenameFilter?: (filename: string) => boolean): AsyncGenerator<fs.Dirent> {
  for await (const dirent of await fsPromise.opendir(directory, {recursive: true})) {
    if (dirent.isFile() && (!filenameFilter || filenameFilter(dirent.name))) {
      yield dirent;
    }
  }
}
