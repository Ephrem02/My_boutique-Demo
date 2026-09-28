import { useRef } from 'react';

function newKey() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  // randomUUID needs a secure context; a LAN address over http may not be one
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * One Idempotency-Key per form submission attempt. The same key is sent until
 * the request succeeds (then call reset()), so a double click or a retry after
 * a dropped connection can never record the same payment or sale twice - the
 * API replays the first result instead.
 *
 *   const idem = useIdempotencyKey();
 *   await client.post(url, body, idem.config());
 *   idem.reset();
 */
export function useIdempotencyKey() {
  const ref = useRef(null);
  return {
    config: () => {
      if (!ref.current) ref.current = newKey();
      return { headers: { 'Idempotency-Key': ref.current } };
    },
    reset: () => {
      ref.current = null;
    },
  };
}
