import {schedule, ScheduledTask} from 'node-cron';

export const cron = (cronExpression: string, task : () => void) : ScheduledTask => {
  return schedule(cronExpression, task);
};

export const delay = (ms : number, task: () => void) : Promise<void> => {
  return new Promise(resolve => setTimeout(() => {
    task();
    resolve();
  }, ms));
};