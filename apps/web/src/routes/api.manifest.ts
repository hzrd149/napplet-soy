import { createFileRoute } from '@tanstack/react-router';
import { manifestResponse } from '../../../../packages/backend/src/manifest-response';

// Read-only, bounded signed-event accelerator. Lookup never starts relay work.
export const Route = createFileRoute('/api/manifest')({
  server: { handlers: { GET: ({ request }) => manifestResponse(request) } },
});
