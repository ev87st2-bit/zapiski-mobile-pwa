const REMINDER_ENDPOINT =
  "https://zapiski-mobile-pwa.ev87st-2.chatgpt.site/api/cron";

async function checkReminders(env) {
  if (!env.CRON_SECRET) {
    throw new Error("CRON_SECRET is not configured");
  }

  const response = await fetch(REMINDER_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.CRON_SECRET}`,
    },
  });

  const body = await response.text();

  if (!response.ok) {
    throw new Error(`Reminder endpoint returned ${response.status}`);
  }

  return body;
}

const worker = {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname !== "/run") {
      return new Response("Zapiski reminder scheduler is active", {
        headers: { "content-type": "text/plain; charset=utf-8" },
      });
    }

    try {
      const body = await checkReminders(env);
      return new Response(body, {
        headers: { "content-type": "application/json; charset=utf-8" },
      });
    } catch {
      return new Response("Reminder check failed", { status: 502 });
    }
  },

  async scheduled(_controller, env, ctx) {
    ctx.waitUntil(checkReminders(env));
  },
};

export default worker;
