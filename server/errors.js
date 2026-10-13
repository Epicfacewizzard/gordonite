// The error the HTTP layer turns into a JSON answer: a status, a stable code for programs, a message for people.
export class HttpError extends Error {
  constructor(status, code, message, extra = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}
