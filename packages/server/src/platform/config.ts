import fs from 'fs';
import { parse } from 'yaml';
import path from 'path';

const paths = ['default.yaml'];
if (process.env.NODE_ENV) {
  paths.push(`${process.env.NODE_ENV}.yaml`);
}

export type Config = {
  app: {
    name: string;
    port: number;
  };
  logging: {
    level: string;
  };
  services: {
    [key: string]: { [key: string]: any };
  }
  [key: string]: { [key: string]: any };
};

export const readYaml = (configPath: string) => {
  if (fs.existsSync(configPath)) {
    const configContent = fs.readFileSync(configPath, { encoding: 'utf-8' });
    return parse(configContent);
  } else return null;
};
export const loadConfig = <T>(...configPaths: string[]): T => {
  const configs = configPaths
    .map((configPath: string) => path.join(process.cwd(), 'config', configPath))
    .map((configPath) => readYaml(configPath))
    .filter((config) => config !== null);
  return Object.assign({}, ...configs);
};

export const config = loadConfig<Config>(...paths);
