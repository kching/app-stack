import fs, { Dirent } from 'fs';
import path from 'path';
import {parse} from "yaml";

const isTestFile = (entry: Dirent) => {
  return (
    (entry.isFile() && entry.name.endsWith('.test.ts')) ||
    (entry.isDirectory() && entry.name === '__tests__')
  );
};

export const scanForFiles = async (
  directory: string,
  filter: (file: Dirent) => boolean = () => true,
  result: Promise<string[]> = Promise.resolve([]),
): Promise<string[]> => {
  let entries: Dirent[] = (
    await fs.promises.readdir(directory, {
      withFileTypes: true,
    })
  ).sort();
  return await entries.reduce(async (result, entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isFile() && filter(entry)) {
      result.then((result) => {
        result.push(entryPath);
        return result;
      });
    } else if (entry.isDirectory() && !isTestFile(entry)) {
      return scanForFiles(entryPath, filter, result);
    }
    return result;
  }, result);
};

export const readYaml = (path: string) => {
  if (fs.existsSync(path)) {
    const configContent = fs.readFileSync(path, { encoding: 'utf-8' });
    return parse(configContent);
  } else return null;
};