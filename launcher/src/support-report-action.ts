/** Export returns only an outcome. Paths and exception messages never become UI copy. */
export type SupportReportOutcome = 'saved' | 'cancelled' | 'unavailable' | 'failed';
export async function exportSupportReportSafely(exportReport?: () => Promise<string | null>): Promise<SupportReportOutcome> {
  if (!exportReport) return 'unavailable';
  try { return await exportReport() ? 'saved' : 'cancelled'; }
  catch { return 'failed'; }
}
