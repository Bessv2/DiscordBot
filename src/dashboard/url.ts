import { config } from '../config';

// Kept apart from server.ts so /dashboard can build links without loading
// express when the dashboard is switched off.
export function dashboardUrl(): string {
  return config.DASHBOARD_URL ?? `http://localhost:${config.DASHBOARD_PORT}`;
}
