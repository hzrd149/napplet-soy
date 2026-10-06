import { createFileRoute } from '@tanstack/react-router';
import { lifecycleHistoryResponse } from '../../../../packages/backend/src/lifecycle-history';

// Read-only retained signed history; no relay queries or modifying operations.
export const Route = createFileRoute('/api/lifecycle-history')({
  server: { handlers: { GET: ({ request }) => lifecycleHistoryResponse(request) } },
});
