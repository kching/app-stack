import path from 'path';
import dotenv from 'dotenv';
import { readYaml } from './fileUtils';

const dotEnvConfig = dotenv.config();
const paths = ['default.yaml'];
if (process.env.NODE_ENV) {
  paths.push(`${process.env.NODE_ENV}.yaml`);
}

export type Config = {
  app: {
    domain: string;
    port: number;
    apiRoot: string;
    staticRoot: string;
    templateRoot: string;
    extensions: string[];
  };
  logging: {
    level: string;
  };
  notification: {
    fromEmail: string;
    outBoundRetentionDays: number;
  };
  auth: {
    issuer: string;
    tokenMaxAgeSeconds: number;
    sessionMaxAgeSeconds: number;
    defaultUsers: string[];
    rootUser: string;
    anonymousUser: string;
  };
  env: {
    [key: string]: { [key: string]: string };
  };
  [key: string]: { [key: string]: any };
};

export const loadConfig = <T>(...configPaths: string[]): T => {
  const configs = configPaths
    .map((configPath: string) => path.join(process.cwd(), 'config', configPath))
    .map((configPath) => readYaml(configPath))
    .filter((config) => config !== null);
  return Object.assign({}, ...configs, { env: dotEnvConfig.parsed });
};

export const config = loadConfig<Config>(...paths);
