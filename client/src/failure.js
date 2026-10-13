// What a failed request means for work that is waiting to be sent.
//
// Anything queued on this device (note edits, mood entries) is removed only when the server confirms it, so after
// a failure the only question is what to do next. The answer is one of:
//
//   network   the request may not have reached the server (offline, timed out, VPN dropped): keep it, try again
//   login     the server wants a login first: keep it, wait for the login, then send
//   retry     a temporary problem on the server's side, or a refusal that says nothing about this data: keep it,
//             try again later
//   conflict  a note that changed somewhere else (409 with a conflict body): keep both versions and ask
//   rejected  the server understood the request and will never accept this exact input: keep it where the person
//             can see it, and do not send it again unchanged
//
// "Rejected" is deliberately narrow. Only a failure the server names as bad input counts; an unknown 4xx (an old
// server in the middle of an update, a proxy, a blocked cross-site request) says nothing about the data itself,
// so it is "retry" and nothing is thrown away.
import { ApiError, NetworkError } from './api.js';

// The server names validation failures bad_* (bad_score, bad_doc, bad_time, ...). These are the other codes that
// mean "this input is wrong or too big", never "try again".
const REJECTED_CODES = new Set(['too_large', 'too_long', 'too_big', 'too_deep', 'empty_file', 'bad_json']);
const isRejectedCode = (code) => typeof code === 'string' && (code.startsWith('bad_') || REJECTED_CODES.has(code));

export function classifyFailure(err) {
  if (err instanceof NetworkError) return { kind: 'network', message: err.message };
  if (err instanceof ApiError) {
    const { status, code } = err;
    const message = err.message;
    if (status === 409 && err.body?.status === 'conflict') return { kind: 'conflict', message, status, code };
    if (status === 401 || code === 'login_required') return { kind: 'login', message: 'Log in to send this', status, code };
    if (status >= 500 || status === 408 || status === 425 || status === 429) return { kind: 'retry', message, status, code };
    if (status >= 400 && isRejectedCode(code)) return { kind: 'rejected', message, status, code };
    return { kind: 'retry', message, status, code };
  }
  // Not a request failure at all (a bug, a storage error): never a reason to discard the data.
  return { kind: 'retry', message: err?.message ?? String(err) };
}
