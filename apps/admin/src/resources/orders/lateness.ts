import { startOfDay, subDays } from 'date-fns';
import type { Order } from '../../types';

/** An order still waiting to ship after this many days is flagged as late. */
export const LATE_AFTER_DAYS = 3;

/** Orders placed before this moment are late if they are still waiting to ship. */
export function lateCutoff(now: Date = new Date()): Date {
  return subDays(startOfDay(now), LATE_AFTER_DAYS);
}

export function isLateOrder(order: Pick<Order, 'status' | 'date'>, cutoff: Date): boolean {
  return order.status === 'ordered' && new Date(order.date) < cutoff;
}
