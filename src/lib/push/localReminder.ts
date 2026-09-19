interface LocalReminderHandle {
  stop: () => void;
}

/**
 * Reporting has no deadline now, so cycle-deadline reminders are disabled.
 * The function remains as a no-op for compatibility with existing app wiring.
 */
export function startLocalReminder(
  _reguId: string | undefined,
): LocalReminderHandle {
  return { stop: () => undefined };
}
