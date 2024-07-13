import fs, { Dirent } from 'fs';
import path from 'path';

const isTestFile = (entry: Dirent) => {
  return (
    (entry.isFile() && entry.name.endsWith('.test.ts')) ||
    (entry.isDirectory() && entry.name === '__tests__')
  );
};

export const scanForFiles = async (
  directory: string,
  result: Promise<string[]> = Promise.resolve([]),
  filter: (file: Dirent) => boolean = () => true
): Promise<string[]> => {
  let entries: Dirent[] = (
    await fs.promises.readdir(directory, {
      withFileTypes: true,
    })
  ).sort();
  return await entries.reduce(async (result, entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isFile() && (filter ? filter(entry) : true)) {
      result.then((result) => {
        result.push(entryPath);
        return result;
      });
    } else if (entry.isDirectory() && !isTestFile(entry)) {
      return scanForFiles(entryPath, result, filter);
    }
    return result;
  }, result);
};
