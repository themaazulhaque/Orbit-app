import { apiRequest } from './client';

export type ReportType = 'daily' | 'monthly';

export interface ReportSession {
  app_name: string;
  package_name: string;
  start_time: string;
  end_time: string;
  duration_seconds: number;
  duration_minutes: number;
  source: string;
}

export interface ReportData {
  report_type: ReportType;
  date: string;
  total_sessions: number;
  total_duration_seconds: number;
  total_duration_minutes: number;
  unique_apps: number;
  sessions: ReportSession[];
}

export async function fetchReportData(
  type: ReportType,
  date: string,
): Promise<{ ok: boolean; data?: ReportData; error?: string }> {
  const result = await apiRequest<ReportData>(
    `/usage/report/?type=${type}&date=${date}&format=json`,
  );

  if (!result.ok) {
    let errorMsg = result.error || 'Failed to fetch report data';
    if (result.status === 401) {
      errorMsg = 'Your session has expired. Please sign in again.';
    } else if (result.status === 403) {
      errorMsg = 'You do not have permission to access this data.';
    } else if (result.status === 404) {
      errorMsg = 'Report endpoint not found. Please update the app.';
    } else if (result.status >= 500) {
      errorMsg = 'Server error. Please try again later.';
    }
    return { ok: false, error: errorMsg };
  }

  return { ok: true, data: result.data || undefined };
}
