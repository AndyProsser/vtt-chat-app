import { useEffect, useState } from 'react';

import { fetchVersion, type ServerVersion } from '../lib/api.js';

/** The server's version, fetched once when the page opens. Undefined until it answers (or if it never does). */
export function useServerVersion(): ServerVersion | undefined {
  const [version, setVersion] = useState<ServerVersion>();
  useEffect(() => {
    const controller = new AbortController();
    fetchVersion(controller.signal).then(setVersion, () => undefined);
    return () => controller.abort();
  }, []);
  return version;
}
