import { getAccessToken } from './client';

export type ReportType = 'daily' | 'monthly';

export async function downloadReport(
  type: ReportType,
  date: string,
): Promise<{ ok: boolean; csv?: string; filename?: string; error?: string }> {
  try {
    const token = await getAccessToken();
    if (!token) return { ok: false, error: 'Not authenticated' };

    const API_URL = process.env.EXPO_PUBLIC_API_URL || 'https://chronicle-backend-gvy4.onrender.com/api/v1';
    const url = `${API_URL}/usage/report/?type=${type}&date=${date}`;

    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!response.ok) {
      const text = await response.text();
      let errorMsg = `HTTP ${response.status}`;
      try {
        const data = JSON.parse(text);
        if (data.error) errorMsg = data.error;
      } catch {}
      return { ok: false, error: errorMsg };
    }

    const csv = await response.text();
    const filename = `orbit-report-${date}.csv`;
    return { ok: true, csv, filename };
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Network error';
    return { ok: false, error: msg };
  }
}
