"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowLeft, Bot, CalendarCheck, CalendarDays, Check, ChevronRight, Gift,
  Link2, Pencil, Plus, ShieldCheck, Sparkles, Trash2,
} from "lucide-react";
import type { Entry } from "./records";
import {
  Birthday, Goal, GoalArea, ProposedPlan, planTasksToEntries, proposeGoalPlan,
  readBirthdays, readGoals, readPlans, writeBirthdays, writeGoals, writePlans,
} from "./planning";
import {
  fetchCalendarChanges, fetchTelegramProposal, getDeviceToken, getGoogleConnectUrl,
  getIntegrationStatus, IntegrationStatus, pollTelegramLink, saveDeviceToken,
  startTelegramLink, syncBirthday, syncPlan,
} from "./integrations";

type View = "home" | "goal" | "review" | "birthday" | "connections";

interface Props {
  entries: Entry[];
  onBack(): void;
  onAcceptEntries(entries: Entry[]): void;
  onBirthdaysChange(items: Birthday[]): void;
  onApplyCalendarChanges(changes: Array<{ localId: string; text: string; date: string; time?: string; cancelled?: boolean }>): void;
  onMessage(message: string): void;
}

const EMPTY_STATUS: IntegrationStatus = {
  backendReady: false, telegramConfigured: false, telegramConnected: false,
  googleConfigured: false, googleConnected: false, aiConfigured: false,
};

export default function AssistantScreen({ entries, onBack, onAcceptEntries, onBirthdaysChange, onApplyCalendarChanges, onMessage }: Props) {
  const [view, setView] = useState<View>("home");
  const [goals, setGoals] = useState<Goal[]>(() => typeof window === "undefined" ? [] : readGoals());
  const [plans, setPlans] = useState<ProposedPlan[]>(() => typeof window === "undefined" ? [] : readPlans());
  const [birthdays, setBirthdays] = useState<Birthday[]>(() => typeof window === "undefined" ? [] : readBirthdays());
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null);

  useEffect(() => {
    const proposalId = new URLSearchParams(window.location.search).get("proposal");
    if (proposalId && getDeviceToken()) {
      fetchTelegramProposal(proposalId).then(({ plan }) => {
        setPlans((current) => {
          const next = [plan, ...current.filter((item) => item.id !== plan.id)];
          writePlans(next); return next;
        });
        setSelectedPlanId(plan.id); setView("review");
        window.history.replaceState({}, "", window.location.pathname);
      }).catch(() => onMessage("Не удалось открыть предложение из Telegram"));
    }
  }, [onMessage]);

  const selectedPlan = plans.find((plan) => plan.id === selectedPlanId) ?? null;

  const saveGoal = (draft: { title: string; area: GoalArea; details: string; targetDate: string; weeklyHours: number }) => {
    const goal: Goal = {
      id: crypto.randomUUID(), title: draft.title.trim(), area: draft.area,
      details: draft.details.trim(), targetDate: draft.targetDate || undefined,
      weeklyHours: draft.weeklyHours, createdAt: new Date().toISOString(), status: "active",
    };
    const plan = proposeGoalPlan(goal, entries);
    const nextGoals = [goal, ...goals]; const nextPlans = [plan, ...plans];
    setGoals(nextGoals); setPlans(nextPlans); writeGoals(nextGoals); writePlans(nextPlans);
    setSelectedPlanId(plan.id); setView("review");
  };

  const updatePlan = (plan: ProposedPlan) => {
    const next = plans.map((item) => item.id === plan.id ? plan : item);
    setPlans(next); writePlans(next);
  };

  const acceptPlan = async (plan: ProposedPlan) => {
    const accepted = { ...plan, status: "accepted" as const };
    updatePlan(accepted);
    onAcceptEntries(planTasksToEntries(accepted));
    onMessage("План принят и добавлен в задачи");
    if (getDeviceToken()) {
      try {
        const result = await syncPlan(accepted);
        onMessage(`В календарь передано: ${result.synced}`);
      } catch (error) {
        onMessage(error instanceof Error ? `${error.message}. Задачи сохранены локально.` : "Задачи сохранены локально");
      }
    }
    setView("home");
  };

  const saveBirthday = async (birthday: Birthday) => {
    const next = [birthday, ...birthdays];
    setBirthdays(next); writeBirthdays(next); onBirthdaysChange(next);
    onMessage("День рождения сохранён"); setView("home");
    if (getDeviceToken()) syncBirthday(birthday).catch(() => undefined);
  };

  const deleteBirthday = (id: string) => {
    const next = birthdays.filter((birthday) => birthday.id !== id);
    setBirthdays(next); writeBirthdays(next); onBirthdaysChange(next);
  };

  return (
    <section className="screen assistant-screen" aria-labelledby="assistant-title">
      <header className="page-top">
        <button className="icon-button bare" onClick={view === "home" ? onBack : () => setView("home")} aria-label="Назад"><ArrowLeft /></button>
        <div><h1 id="assistant-title">Личный помощник</h1><p>Планы — только после вашего подтверждения</p></div>
      </header>

      {view === "home" && <AssistantHome goals={goals} plans={plans} birthdays={birthdays} onGoal={() => setView("goal")} onBirthday={() => setView("birthday")} onConnections={() => setView("connections")} onPlan={(id) => { setSelectedPlanId(id); setView("review"); }} onDeleteBirthday={deleteBirthday} />}
      {view === "goal" && <GoalForm onSave={saveGoal} />}
      {view === "review" && selectedPlan && <PlanReview plan={selectedPlan} onChange={updatePlan} onAccept={() => acceptPlan(selectedPlan)} />}
      {view === "birthday" && <BirthdayForm onSave={saveBirthday} />}
      {view === "connections" && <Connections onMessage={onMessage} onApplyCalendarChanges={onApplyCalendarChanges} />}
    </section>
  );
}

function AssistantHome({ goals, plans, birthdays, onGoal, onBirthday, onConnections, onPlan, onDeleteBirthday }: {
  goals: Goal[]; plans: ProposedPlan[]; birthdays: Birthday[]; onGoal(): void; onBirthday(): void; onConnections(): void; onPlan(id: string): void; onDeleteBirthday(id: string): void;
}) {
  const drafts = plans.filter((plan) => plan.status === "draft");
  return <>
    <div className="assistant-intro card-surface"><span className="assistant-hero-icon"><Sparkles /></span><div><h2>Спокойный план по шагам</h2><p>Опишите цель. Помощник предложит недели, задачи и свободные моменты — вы сможете всё изменить до сохранения.</p></div></div>
    <div className="assistant-actions">
      <button className="primary-button full" onClick={onGoal}><Plus />Добавить цель</button>
      <button className="secondary-button full" onClick={onBirthday}><Gift />Добавить день рождения</button>
    </div>
    {drafts.length > 0 && <section className="section-block"><div className="section-heading"><span className="section-icon"><Pencil /></span><h2>Ждут решения</h2><span className="count-badge">{drafts.length}</span></div><div className="card-stack">{drafts.map((plan) => <button className="simple-list-card" key={plan.id} onClick={() => onPlan(plan.id)}><span><strong>{plan.goalTitle}</strong><small>{plan.weeks.length} недель · можно изменить</small></span><ChevronRight /></button>)}</div></section>}
    <section className="section-block"><div className="section-heading"><span className="section-icon"><CalendarCheck /></span><h2>Цели</h2><span className="count-badge">{goals.length}</span></div>{goals.length ? <div className="card-stack">{goals.map((goal) => <div className="simple-list-card static" key={goal.id}><span><strong>{goal.title}</strong><small>{goal.area === "work" ? "Рабочая" : "Личная"}{goal.targetDate ? ` · до ${goal.targetDate}` : ""}</small></span><Check /></div>)}</div> : <p className="section-empty">Добавьте цель, чтобы получить первый недельный план.</p>}</section>
    <section className="section-block"><div className="section-heading"><span className="section-icon"><Gift /></span><h2>Дни рождения</h2><span className="count-badge">{birthdays.length}</span></div>{birthdays.length ? <div className="card-stack">{birthdays.map((birthday) => <div className="simple-list-card static" key={birthday.id}><span><strong>{birthday.name}</strong><small>{String(birthday.day).padStart(2,"0")}.{String(birthday.month).padStart(2,"0")}{birthday.year ? `.${birthday.year}` : ""} · повторяется ежегодно</small></span><button className="mini-icon-button" onClick={() => onDeleteBirthday(birthday.id)} aria-label={`Удалить день рождения: ${birthday.name}`}><Trash2 /></button></div>)}</div> : <p className="section-empty">Напомним в Telegram за день и в сам день.</p>}</section>
    <button className="connection-banner" onClick={onConnections}><span className="section-icon"><Link2 /></span><span><strong>Telegram и Google Calendar</strong><small>Подключения, приватность и синхронизация</small></span><ChevronRight /></button>
  </>;
}

function GoalForm({ onSave }: { onSave(draft: { title: string; area: GoalArea; details: string; targetDate: string; weeklyHours: number }): void }) {
  const [title, setTitle] = useState(""); const [area, setArea] = useState<GoalArea>("personal");
  const [details, setDetails] = useState(""); const [targetDate, setTargetDate] = useState(""); const [weeklyHours, setWeeklyHours] = useState(3);
  return <div className="form-card assistant-form"><h2>Новая цель</h2><label>Что хотите получить?<input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Например, подготовить семейный праздник" /></label><div><span className="field-label">Область</span><div className="segmented"><button className={area === "personal" ? "active" : ""} onClick={() => setArea("personal")}>Личная</button><button className={area === "work" ? "active" : ""} onClick={() => setArea("work")}>Рабочая</button></div></div><label>Что важно учесть? <span>(необязательно)</span><textarea value={details} onChange={(event) => setDetails(event.target.value)} placeholder="Ограничения, желаемый результат, свободное время" /></label><label>Желаемая дата <span>(необязательно)</span><input type="date" value={targetDate} onChange={(event) => setTargetDate(event.target.value)} /></label><label>Часов в неделю<input type="number" min="1" max="20" value={weeklyHours} onChange={(event) => setWeeklyHours(Number(event.target.value))} /></label><p><ShieldCheck size={18} />Сначала появится предложение. В календарь ничего не попадёт без кнопки «Принять план».</p><button className="primary-button full" disabled={!title.trim()} onClick={() => onSave({ title, area, details, targetDate, weeklyHours })}><Sparkles />Предложить план</button></div>;
}

function PlanReview({ plan, onChange, onAccept }: { plan: ProposedPlan; onChange(plan: ProposedPlan): void; onAccept(): void }) {
  const taskCount = useMemo(() => plan.weeks.reduce((sum, week) => sum + week.tasks.length, 0), [plan]);
  const updateTask = (weekIndex: number, taskId: string, field: "text" | "date" | "time", value: string) => onChange({ ...plan, weeks: plan.weeks.map((week, index) => index === weekIndex ? { ...week, tasks: week.tasks.map((task) => task.id === taskId ? { ...task, [field]: value } : task) } : week) });
  return <><div className="review-summary card-surface"><Sparkles /><div><h2>Предложение готово</h2><p>{plan.weeks.length} недель · {taskCount} задач. Проверьте даты и время.</p></div></div><div className="plan-weeks">{plan.weeks.map((week, weekIndex) => <section className="plan-week card-surface" key={week.startsOn}><span className="week-label">{week.title}</span><h2>{week.objective}</h2>{week.tasks.map((task) => <div className="plan-task" key={task.id}><label>Задача<input value={task.text} onChange={(event) => updateTask(weekIndex, task.id, "text", event.target.value)} /></label><div><label>Дата<input type="date" value={task.date} onChange={(event) => updateTask(weekIndex, task.id, "date", event.target.value)} /></label><label>Время<input type="time" value={task.time} onChange={(event) => updateTask(weekIndex, task.id, "time", event.target.value)} /></label></div></div>)}</section>)}</div><div className="sticky-accept"><p>Будут созданы только эти задачи. Существующие события Google не меняются.</p><button className="primary-button full" onClick={onAccept}><Check />Принять план</button></div></>;
}

function BirthdayForm({ onSave }: { onSave(birthday: Birthday): void }) {
  const [name, setName] = useState(""); const [date, setDate] = useState("");
  const save = () => { const [year, month, day] = date.split("-").map(Number); onSave({ id: crypto.randomUUID(), name: name.trim(), year, month, day, createdAt: new Date().toISOString() }); };
  return <div className="form-card assistant-form"><h2>День рождения</h2><label>Имя<input value={name} onChange={(event) => setName(event.target.value)} placeholder="Сергей" /></label><label>Дата рождения<input type="date" value={date} onChange={(event) => setDate(event.target.value)} /></label><div className="info-card no-margin"><Gift /><div><strong>Два мягких напоминания</strong><span>За день: «Завтра день рождения Сергея». В сам день: «Сегодня день рождения Сергея».</span></div></div><button className="primary-button full" disabled={!name.trim() || !date} onClick={save}><Check />Сохранить</button></div>;
}

function Connections({ onMessage, onApplyCalendarChanges }: { onMessage(message: string): void; onApplyCalendarChanges(changes: Array<{ localId: string; text: string; date: string; time?: string; cancelled?: boolean }>): void }) {
  const [status, setStatus] = useState(EMPTY_STATUS); const [loading, setLoading] = useState(true);
  const [link, setLink] = useState<{ challengeId: string; pollSecret: string; code: string; botUsername: string } | null>(null);
  const refresh = useCallback(() => { getIntegrationStatus().then(setStatus).catch(() => setStatus(EMPTY_STATUS)).finally(() => setLoading(false)); }, []);
  useEffect(() => { refresh(); }, [refresh]);
  useEffect(() => { if (!link) return; const timer = window.setInterval(() => pollTelegramLink(link.challengeId, link.pollSecret).then((result) => { if (result.linked && result.deviceToken) { saveDeviceToken(result.deviceToken); setLink(null); refresh(); onMessage("Telegram подключён"); } }).catch(() => undefined), 2500); return () => clearInterval(timer); }, [link, onMessage, refresh]);
  const connectTelegram = async () => { try { setLink(await startTelegramLink(Intl.DateTimeFormat().resolvedOptions().timeZone)); } catch (error) { onMessage(error instanceof Error ? error.message : "Сервис пока не настроен"); } };
  const connectGoogle = async () => { try { window.location.href = await getGoogleConnectUrl(); } catch (error) { onMessage(error instanceof Error ? error.message : "Google пока не настроен"); } };
  const sync = async () => { try { const { changes } = await fetchCalendarChanges(); onApplyCalendarChanges(changes); onMessage(changes.length ? `Найдено изменений: ${changes.length}` : "Изменений нет"); } catch (error) { onMessage(error instanceof Error ? error.message : "Синхронизация недоступна"); } };
  return <><div className="privacy-card card-surface"><ShieldCheck /><div><h2>Под вашим контролем</h2><p>Telegram получает тексты напоминаний. Google видит только события, которые вы подтвердили. Токены хранятся на сервере в зашифрованном виде; аудио после расшифровки не сохраняется.</p></div></div><div className="connection-list"><ConnectionCard icon={<Bot />} title="Telegram" text="Все напоминания и голосовые сообщения" state={loading ? "Проверяем…" : status.telegramConnected ? "Подключён" : status.telegramConfigured ? "Готов к подключению" : "Нужен токен бота"} connected={status.telegramConnected}>{!status.telegramConnected && <button className="secondary-button full" disabled={!status.telegramConfigured} onClick={connectTelegram}>Подключить Telegram</button>}{link && <div className="link-code"><span>Отправьте боту команду</span><strong>/start {link.code}</strong><a href={`https://t.me/${link.botUsername}?start=${link.code}`} target="_blank" rel="noreferrer">Открыть @{link.botUsername}</a></div>}</ConnectionCard><ConnectionCard icon={<CalendarDays />} title="Google Calendar" text="Только созданные приложением события" state={status.googleConnected ? "Подключён" : status.googleConfigured ? "Готов к подключению" : "Нужны данные Google OAuth"} connected={status.googleConnected}>{!status.googleConnected ? <button className="secondary-button full" disabled={!status.telegramConnected || !status.googleConfigured} onClick={connectGoogle}>Подключить Google</button> : <button className="secondary-button full" onClick={sync}>Проверить изменения</button>}</ConnectionCard><ConnectionCard icon={<Sparkles />} title="AI и расшифровка" text="Провайдер выбирается явно; постоянная бесплатность не обещается" state={status.aiConfigured ? "Настроено" : "Нужен ключ провайдера"} connected={status.aiConfigured} /></div><p className="privacy-footnote">Без подключений приложение продолжает работать локально. Облачные функции можно не включать.</p></>;
}

function ConnectionCard({ icon, title, text, state, connected, children }: { icon: React.ReactNode; title: string; text: string; state: string; connected: boolean; children?: React.ReactNode }) {
  return <section className="connection-card card-surface"><span className="section-icon">{icon}</span><div className="connection-copy"><h2>{title}</h2><p>{text}</p><span className={`connection-state ${connected ? "connected" : ""}`}>{connected && <Check />}{state}</span></div>{children && <div className="connection-action">{children}</div>}</section>;
}
