import axios from 'axios';

// withCredentials so the browser sends the httpOnly session cookie set by
// POST /auth/login - the token itself is never readable/settable from JS.
export const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000/api';

const client = axios.create({
  baseURL: API_BASE_URL,
  withCredentials: true,
});

// Surfaces the API's own error message rather than a generic axios one,
// since the backend already returns { error: "..." } with the right detail.
client.interceptors.response.use(
  (res) => res,
  (err) => {
    const message = err.response?.data?.error || err.message || 'Something went wrong';
    return Promise.reject(new Error(message));
  }
);

export default client;
