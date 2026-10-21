/**
 * UserError: an expected problem the user can fix, such as "Select an open
 * path...". Commands that throw one show its message as a notification
 * without logging it as an error; any other error is a bug and is logged.
 */
export class UserError extends Error {
  constructor(message) {
    super(message);
    this.name = 'UserError';
    this.expected = true;
  }
}

export function isUserError(err) {
  return Boolean(err && err.expected === true);
}
