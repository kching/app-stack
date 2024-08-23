import { createLogger, transports, format, Logger } from 'winston';
import DailyRotateFile from 'winston-daily-rotate-file';
import { config } from './config';

const { combine, timestamp, prettyPrint, printf, errors } = format;

const lineFormat = printf(
  ({ timestamp, level, label, message }) =>
    `[${timestamp} | ${level.toUpperCase()}${label ? ` | ${label}` : ''} ]  ${message}`
);

const childLoggers: Map<string, Logger> = new Map();
const loggingLevel = config.logging.level;

const rootLogger = createLogger({
  level: loggingLevel,
  defaultMeta: {},
  transports: [
    new transports.Console({
      format: combine(
        errors({ stack: true }),
        timestamp({ format: 'YYYY-MM-DD HH:mm:ss.SSS' }),
        prettyPrint(),
        lineFormat
      ),
    }),
    new DailyRotateFile({
      filename: 'logs/server-%DATE%.log',
      datePattern: 'YYYY-MM-DD',
      zippedArchive: true,
      maxSize: '4M',
      maxFiles: '30d',
      format: combine(
        errors({ stack: true }),
        timestamp({ format: 'YYYY-MM-DD HH:mm:ss.SSS' }),
        prettyPrint(),
        lineFormat
      ),
    }),
  ],
});

export const getLogger = (label?: string): Logger => {
  if (label) {
    let childLogger = childLoggers.get(label);
    if (!childLogger) {
      childLogger = rootLogger.child({ label: label });
      childLoggers.set(label, childLogger);
    }
    return childLogger;
  } else {
    return rootLogger;
  }
};
