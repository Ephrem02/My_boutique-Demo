// Turns an ApiError (api/client.js) into human copy: what happened, and
// whether anything was saved. Never shows stack traces or server internals
// - the API only ever sends safe messages, and 5xx details are replaced.
//
// `action` is a short noun phrase for what the user was doing, e.g.
// t('errors.actions.sale') -> "The sale".
export function describeError(err, t, { action } = {}) {
  const subject = action || t('errors.actions.generic');
  if (!err) return null;
  switch (err.kind) {
    case 'network':
      return { title: t('errors.networkTitle'), message: t('errors.networkMessage', { action: subject }), retryable: true };
    case 'server':
      return { title: t('errors.serverTitle'), message: t('errors.serverMessage', { action: subject }), retryable: true };
    case 'client':
      if (err.status === 401) return { title: t('errors.sessionTitle'), message: t('errors.sessionMessage'), retryable: false };
      if (err.status === 403) return { title: t('errors.forbiddenTitle'), message: t('errors.forbiddenMessage'), retryable: false };
      return { title: t('errors.notCompletedTitle', { action: subject }), message: err.message, retryable: false };
    default:
      return { title: t('errors.serverTitle'), message: err.message || t('errors.serverMessage', { action: subject }), retryable: true };
  }
}
