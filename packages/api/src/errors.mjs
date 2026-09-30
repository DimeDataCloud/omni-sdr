// One place that turns failures into HTTP answers. The database is the enforcer; most refusals arrive
// here as Postgres errors, and each class maps to one status. Unknown errors are 500 with a request id
// and no detail, so SQL and stack traces never reach a browser.
import { TenantAccessError } from '../../db/src/context.mjs';
import { AuthError } from './auth.mjs';

export class HttpError extends Error {
  constructor(status, code, message, details) {
    super(message ?? code);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const badRequest = (message, details) => new HttpError(400, 'bad_request', message, details);
export const forbidden = (message = 'not allowed for your role') => new HttpError(403, 'forbidden', message);
export const notFound = (what = 'not found') => new HttpError(404, 'not_found', what);
export const conflict = (message, details) => new HttpError(409, 'conflict', message, details);

// Messages our own SQL raises on purpose (RAISE ... USING ERRCODE) are written for people and are safe
// to show. Everything else from Postgres is summarized.
const OWN_MESSAGE = /^(send_guard|create_org_with_admin|create_workspace|accept_invite|ensure_user|workspace settings|invites|evidence is immutable|icp versions are immutable|audit_log is append-only|reserve amount|release)/;

export function toHttp(err) {
  if (err instanceof HttpError) return err;
  if (err instanceof AuthError) return new HttpError(401, 'unauthenticated', 'sign in again');
  if (err instanceof TenantAccessError) return new HttpError(403, 'forbidden', 'no access to this workspace');
  const code = err?.code;
  const msg = String(err?.message ?? '');
  const own = OWN_MESSAGE.test(msg) ? msg : null;
  switch (code) {
    case '42501': return new HttpError(403, 'forbidden', own ?? 'not allowed for your role');
    case '22023': case '22P02': case '22007': case '22008': case '23502':
      return new HttpError(400, 'bad_request', own ?? 'invalid value');
    case '23505': return new HttpError(409, 'conflict', own ?? 'already exists');
    case '23503': return new HttpError(404, 'not_found', 'a referenced record was not found in this workspace');
    case '23514': return new HttpError(409, 'conflict', own ?? 'refused by a data rule', { constraint: err.constraint });
    case 'P0001': return new HttpError(409, 'conflict', own ?? 'refused by a data rule');
    default: return null;
  }
}
