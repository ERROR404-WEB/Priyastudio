import { getAuth } from '../auth';
import { getRuntimeConfig } from '../config';
import { getDatabase } from '../database';
import { calendarConfiguration } from './config';
import { createCalendarHandlers } from './handlers';

/** Request-time composition: no database, credentials or Google calls during module collection. */
export function calendarHandlers() {
  const hosted = getRuntimeConfig();
  return createCalendarHandlers({ hosted, calendar: calendarConfiguration(hosted?.baseUrl ?? null),
    ...(hosted ? { db: getDatabase(), auth: getAuth() } : {}) });
}