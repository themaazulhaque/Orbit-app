import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import * as FileSystem from 'expo-file-system';
import { ReportData } from './api/report';

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatDurationShort(totalMinutes: number): string {
  const h = Math.floor(totalMinutes / 60);
  const m = Math.round(totalMinutes % 60);
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

function formatDateTime(isoString: string): string {
  const d = new Date(isoString);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const hours = String(d.getHours()).padStart(2, '0');
  const minutes = String(d.getMinutes()).padStart(2, '0');
  return `${year}-${month}-${day} ${hours}:${minutes}`;
}

function buildHtml(data: ReportData, generatedAt: string): string {
  const isDaily = data.report_type === 'daily';
  const periodLabel = isDaily ? 'Daily Report' : 'Monthly Report';
  const dateLabel = isDaily
    ? new Date(data.date + 'T00:00:00').toLocaleDateString('en-US', {
        weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
      })
    : new Date(data.date + '-01T00:00:00').toLocaleDateString('en-US', {
        year: 'numeric', month: 'long',
      });

  const hasSessions = data.sessions.length > 0;

  let sessionRows = '';
  if (hasSessions) {
    for (let i = 0; i < data.sessions.length; i++) {
      const s = data.sessions[i];
      const bg = i % 2 === 0 ? '#f8f9fa' : '#ffffff';
      sessionRows += `
        <tr style="background:${bg}">
          <td style="padding:8px 10px;border-bottom:1px solid #e9ecef;font-size:13px;color:#212529">${escapeHtml(s.app_name)}</td>
          <td style="padding:8px 10px;border-bottom:1px solid #e9ecef;font-size:11px;color:#6c757d;word-break:break-all;max-width:180px">${escapeHtml(s.package_name)}</td>
          <td style="padding:8px 10px;border-bottom:1px solid #e9ecef;font-size:12px;color:#495057;white-space:nowrap">${formatDateTime(s.start_time)}</td>
          <td style="padding:8px 10px;border-bottom:1px solid #e9ecef;font-size:12px;color:#495057;white-space:nowrap">${formatDateTime(s.end_time)}</td>
          <td style="padding:8px 10px;border-bottom:1px solid #e9ecef;font-size:12px;color:#212529;text-align:right;font-weight:500">${formatDurationShort(s.duration_minutes)}</td>
        </tr>`;
    }
  }

  const emptyState = !hasSessions
    ? `<div style="text-align:center;padding:60px 20px;color:#6c757d">
        <div style="font-size:48px;margin-bottom:16px">&#128196;</div>
        <p style="font-size:16px;color:#495057;margin:0 0 8px 0">No usage activity recorded</p>
        <p style="font-size:13px;color:#868e96;margin:0">There are no app usage sessions for this period.</p>
      </div>`
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #212529; background: #fff; }
    @page { margin: 15mm; size: A4; }
    @media print { body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
  </style>
</head>
<body>
  <div style="max-width:100%">
    <!-- Header -->
    <div style="background:linear-gradient(135deg,#007AFF 0%,#0055D4 100%);color:#fff;padding:32px 28px;border-radius:12px;margin-bottom:28px">
      <div style="font-size:28px;font-weight:700;letter-spacing:-0.5px;margin-bottom:4px">Orbit</div>
      <div style="font-size:15px;opacity:0.9;font-weight:500">Usage Activity Report</div>
    </div>

    <!-- Report Info -->
    <div style="display:flex;gap:24px;margin-bottom:28px;flex-wrap:wrap">
      <div style="flex:1;min-width:200px">
        <div style="font-size:11px;text-transform:uppercase;letter-spacing:1px;color:#868e96;font-weight:600;margin-bottom:6px">Report Type</div>
        <div style="font-size:15px;font-weight:600;color:#212529">${periodLabel}</div>
      </div>
      <div style="flex:1;min-width:200px">
        <div style="font-size:11px;text-transform:uppercase;letter-spacing:1px;color:#868e96;font-weight:600;margin-bottom:6px">Period</div>
        <div style="font-size:15px;font-weight:600;color:#212529">${escapeHtml(dateLabel)}</div>
      </div>
      <div style="flex:1;min-width:200px">
        <div style="font-size:11px;text-transform:uppercase;letter-spacing:1px;color:#868e96;font-weight:600;margin-bottom:6px">Generated</div>
        <div style="font-size:15px;font-weight:600;color:#212529">${escapeHtml(generatedAt)}</div>
      </div>
    </div>

    <!-- Summary Cards -->
    <div style="display:flex;gap:16px;margin-bottom:28px;flex-wrap:wrap">
      <div style="flex:1;min-width:120px;background:#f0f7ff;border-radius:10px;padding:16px;text-align:center">
        <div style="font-size:24px;font-weight:700;color:#007AFF">${data.total_sessions}</div>
        <div style="font-size:11px;color:#6c757d;margin-top:4px;text-transform:uppercase;letter-spacing:0.5px;font-weight:600">Sessions</div>
      </div>
      <div style="flex:1;min-width:120px;background:#f0faf0;border-radius:10px;padding:16px;text-align:center">
        <div style="font-size:24px;font-weight:700;color:#34C759">${formatDurationShort(data.total_duration_minutes)}</div>
        <div style="font-size:11px;color:#6c757d;margin-top:4px;text-transform:uppercase;letter-spacing:0.5px;font-weight:600">Total Time</div>
      </div>
      <div style="flex:1;min-width:120px;background:#fff8f0;border-radius:10px;padding:16px;text-align:center">
        <div style="font-size:24px;font-weight:700;color:#FF9500">${data.unique_apps}</div>
        <div style="font-size:11px;color:#6c757d;margin-top:4px;text-transform:uppercase;letter-spacing:0.5px;font-weight:600">Apps Used</div>
      </div>
    </div>

    ${emptyState}

    ${hasSessions ? `
    <!-- Sessions Table -->
    <div style="margin-bottom:20px">
      <div style="font-size:13px;font-weight:600;color:#495057;margin-bottom:12px;text-transform:uppercase;letter-spacing:0.5px">Usage Sessions</div>
      <table style="width:100%;border-collapse:collapse;border:1px solid #e9ecef;border-radius:8px;overflow:hidden;font-size:12px">
        <thead>
          <tr style="background:#f1f3f5">
            <th style="padding:10px 10px;text-align:left;font-size:11px;font-weight:700;color:#495057;text-transform:uppercase;letter-spacing:0.5px;border-bottom:2px solid #dee2e6">App</th>
            <th style="padding:10px 10px;text-align:left;font-size:11px;font-weight:700;color:#495057;text-transform:uppercase;letter-spacing:0.5px;border-bottom:2px solid #dee2e6">Package</th>
            <th style="padding:10px 10px;text-align:left;font-size:11px;font-weight:700;color:#495057;text-transform:uppercase;letter-spacing:0.5px;border-bottom:2px solid #dee2e6">Start</th>
            <th style="padding:10px 10px;text-align:left;font-size:11px;font-weight:700;color:#495057;text-transform:uppercase;letter-spacing:0.5px;border-bottom:2px solid #dee2e6">End</th>
            <th style="padding:10px 10px;text-align:right;font-size:11px;font-weight:700;color:#495057;text-transform:uppercase;letter-spacing:0.5px;border-bottom:2px solid #dee2e6">Duration</th>
          </tr>
        </thead>
        <tbody>
          ${sessionRows}
        </tbody>
        <tfoot>
          <tr style="background:#f1f3f5;border-top:2px solid #dee2e6">
            <td colspan="4" style="padding:10px;font-size:12px;font-weight:700;color:#495057">Total</td>
            <td style="padding:10px;font-size:12px;font-weight:700;color:#007AFF;text-align:right">${formatDurationShort(data.total_duration_minutes)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
    ` : ''}

    <!-- Footer -->
    <div style="text-align:center;padding-top:20px;border-top:1px solid #e9ecef;color:#adb5bd;font-size:11px">
      Generated by Orbit &middot; ${escapeHtml(generatedAt)}
    </div>
  </div>
</body>
</html>`;
}

export async function generateReportPdf(
  data: ReportData,
): Promise<{ ok: boolean; uri?: string; filename?: string; error?: string }> {
  try {
    const now = new Date();
    const generatedAt = now.toLocaleString('en-US', {
      year: 'numeric', month: 'long', day: 'numeric',
      hour: 'numeric', minute: '2-digit', hour12: true,
    });

    const html = buildHtml(data, generatedAt);

    const { uri } = await Print.printToFileAsync({ html });

    const filename = data.report_type === 'daily'
      ? `orbit-report-${data.date}.pdf`
      : `orbit-report-${data.date}.pdf`;

    const destUri = FileSystem.cacheDirectory + filename;
    await FileSystem.moveAsync({ from: uri, to: destUri });

    return { ok: true, uri: destUri, filename };
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'PDF generation failed';
    return { ok: false, error: msg };
  }
}

export async function shareReportPdf(
  uri: string,
  reportType: string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const canShare = await Sharing.isAvailableAsync();
    if (!canShare) {
      return { ok: false, error: 'Sharing is not available on this device' };
    }

    await Sharing.shareAsync(uri, {
      mimeType: 'application/pdf',
      dialogTitle: `Share ${reportType} report`,
      UTI: 'com.adobe.pdf',
    });

    return { ok: true };
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Failed to share report';
    return { ok: false, error: msg };
  }
}
