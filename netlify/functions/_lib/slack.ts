/**
 * Slack incoming-webhook notifications.
 * Degrades gracefully: if SLACK_WEBHOOK_URL is unset or the request fails,
 * the main flow continues and the miss is logged to the events table upstream.
 */
export async function notifySlack(text: string): Promise<boolean> {
  const url = process.env.SLACK_WEBHOOK_URL
  if (!url) {
    console.warn('SLACK_WEBHOOK_URL not set — skipping notification:', text)
    return false
  }
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text }),
    })
    if (!res.ok) {
      console.error('Slack webhook returned', res.status)
      return false
    }
    return true
  } catch (err) {
    console.error('Slack webhook failed', err)
    return false
  }
}

export function money(n: number | null | undefined): string {
  if (n == null) return '$0'
  return '$' + Number(n).toLocaleString('en-US', { maximumFractionDigits: 0 })
}
