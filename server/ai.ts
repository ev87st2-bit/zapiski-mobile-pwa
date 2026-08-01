import type { AssistantEnv } from "./types";

export interface AssistantProposalTask { id: string; text: string; date: string; time: string; durationMinutes: number }
export interface AssistantProposal {
  id: string; goalId: string; goalTitle: string; createdAt: string; status: "draft";
  weeks: Array<{ index: number; startsOn: string; title: string; objective: string; tasks: AssistantProposalTask[] }>;
}

function tomorrowDate(): string {
  const date = new Date(); date.setDate(date.getDate() + 1);
  return date.toISOString().slice(0, 10);
}

function fallbackProposal(text: string): AssistantProposal {
  const date = tomorrowDate();
  return { id: crypto.randomUUID(), goalId: crypto.randomUUID(), goalTitle: text.slice(0, 90), createdAt: new Date().toISOString(), status: "draft", weeks: [{ index: 1, startsOn: date, title: "Неделя 1 · Предложение из Telegram", objective: "Проверить распознанное действие и выбрать подходящее время", tasks: [{ id: crypto.randomUUID(), text, date, time: "10:00", durationMinutes: 60 }] }] };
}

function normalizeProposal(value: unknown, fallbackText: string): AssistantProposal {
  if (!value || typeof value !== "object") return fallbackProposal(fallbackText);
  const source = value as { goalTitle?: unknown; weeks?: unknown };
  if (!Array.isArray(source.weeks) || !source.weeks.length) return fallbackProposal(fallbackText);
  const weeks = source.weeks.slice(0, 8).map((weekValue, weekIndex) => {
    const week = weekValue as { title?: unknown; objective?: unknown; startsOn?: unknown; tasks?: unknown };
    const tasks = (Array.isArray(week.tasks) ? week.tasks : []).slice(0, 5).map((taskValue) => {
      const task = taskValue as { text?: unknown; date?: unknown; time?: unknown; durationMinutes?: unknown };
      return { id: crypto.randomUUID(), text: String(task.text || fallbackText).slice(0, 500), date: /^\d{4}-\d{2}-\d{2}$/.test(String(task.date)) ? String(task.date) : tomorrowDate(), time: /^\d{2}:\d{2}$/.test(String(task.time)) ? String(task.time) : "10:00", durationMinutes: Math.max(15, Math.min(240, Number(task.durationMinutes) || 60)) };
    });
    return { index: weekIndex + 1, startsOn: String(week.startsOn || tasks[0]?.date || tomorrowDate()), title: String(week.title || `Неделя ${weekIndex + 1}`), objective: String(week.objective || "Продвинуться к результату"), tasks: tasks.length ? tasks : fallbackProposal(fallbackText).weeks[0].tasks };
  });
  return { id: crypto.randomUUID(), goalId: crypto.randomUUID(), goalTitle: String(source.goalTitle || fallbackText).slice(0, 120), createdAt: new Date().toISOString(), status: "draft", weeks };
}

export async function deriveProposal(text: string, timezone: string, env: AssistantEnv): Promise<AssistantProposal> {
  if (!env.AI_API_KEY || !env.AI_MODEL) return fallbackProposal(text);
  const endpoint = `${(env.AI_API_BASE || "https://api.openai.com/v1").replace(/\/$/, "")}/chat/completions`;
  const response = await fetch(endpoint, {
    method: "POST", headers: { authorization: `Bearer ${env.AI_API_KEY}`, "content-type": "application/json" },
    body: JSON.stringify({ model: env.AI_MODEL, temperature: 0.2, response_format: { type: "json_object" }, messages: [
      { role: "system", content: `Ты помощник по личному планированию. Часовой пояс: ${timezone}. Верни только JSON: {goalTitle,weeks:[{startsOn,title,objective,tasks:[{text,date,time,durationMinutes}]}]}. Предлагай реалистичные даты и время, ничего не считай подтвержденным.` },
      { role: "user", content: text },
    ] }),
  });
  const payload = await response.json() as { choices?: Array<{ message?: { content?: string } }>; error?: { message?: string } };
  if (!response.ok) throw new Error(payload.error?.message || "AI planning request failed");
  try { return normalizeProposal(JSON.parse(payload.choices?.[0]?.message?.content || "{}"), text); }
  catch { return fallbackProposal(text); }
}
