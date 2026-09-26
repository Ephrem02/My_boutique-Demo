import axios from 'axios';

export const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000/api';

// withCredentials so the browser sends the httpOnly session cookie set by
// POST /auth/login - the token itself is never readable/settable from JS.
const client = axios.create({
  baseURL: API_BASE_URL,
  withCredentials: true,
});

/**
 * Every failed request rejects with an ApiError:
 *  - kind 'network': no response (offline, server down) - nothing was saved
 *  - kind 'server':  5xx - the server hit an unexpected problem
 *  - kind 'client':  4xx - a business rule or validation message from the
 *                    API, which is always safe and meant for people to read
 * `message` stays the API's own message where there is one, so existing
 * `err.message` usage keeps working; ui/errors.js turns these into
 * friendly, action-oriented copy.
 */
export class ApiError extends Error {
  constructor(message, { status = 0, kind = 'network', required } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.kind = kind;
    this.required = required;
  }
}

client.interceptors.response.use(
  (res) => res,
  (err) => {
    if (!err.response) {
      return Promise.reject(new ApiError("Couldn't reach the server. Check the connection and try again.", { kind: 'network' }));
    }
    const { status, data } = err.response;
    if (status >= 500) {
      return Promise.reject(new ApiError('Something went wrong on the server.', { status, kind: 'server' }));
    }
    const message = data?.error || err.message || 'Something went wrong';
    return Promise.reject(new ApiError(message, { status, kind: 'client', required: data?.required }));
  }
);

export default client;
