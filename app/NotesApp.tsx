"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft, Bell, BellRing, BookOpen, CalendarDays, Check, CheckCircle2, ChevronLeft,
  ChevronRight, CircleAlert, ClipboardList, FileText, Home, Lightbulb, ListFilter,
  Mic, MicOff, Pencil, Plus, RotateCcw, Save, Settings2, Trash2, X,
} from "lucide-react";
import {
  Entry, RecordType, entryIsDue, formatDateKey, formatLongDate, ideaRevisitDate,
  localDateKey, NOTIFIED_KEY, readEntries, sortEntries, writeEntries,
} from "./records";

type Screen = "today" | "records" | "calendar" | "create" | "editor" | "details";
type Filter = "all" | RecordType | "completed";

const TYPE_LABELS: Record<RecordType, string> = { note: "Заметка", idea: "Идея", task: "Задача" };
const TYPE_HELP: Record<RecordType, string> = {
  note: "Быстро сохранить мысль",
  idea: "Вернуться к ней через 7 дней",
  task: "Запланировать дату и время",
};
const TYPE_ICON = { note: FileText, idea: Lightbulb, task: CheckCircle2 };

interface SpeechRecognitionEventLike { results: ArrayLike<{ 0: { transcript: string } }>; }
interface SpeechRecognitionErrorEventLike { error: string; }
interface SpeechRecognitionLike {
  lang: string; interimResults: boolean; continuous: boolean;
  start(): void; stop(): void;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null;
  onend: (() => void) | null;
}
type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

function getSpeechRecognition(): SpeechRecognitionConstructor | undefined {
  if (typeof window === "undefined") return undefined;
  const speechWindow = window as typeof window & { SpeechRecognition?: SpeechRecognitionConstructor; webkitSpeechRecognition?: SpeechRecognitionConstructor };
  return speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition;
}

function IconForType({ type, size = 22 }: { type: RecordType; size?: number }) {
  const Icon = TYPE_ICON[type];
  return <Icon size={size} strokeWidth={1.8} aria-hidden="true" />;
}

function StatusBadge({ entry, today }: { entry: Entry; today: string }) {
  if (entry.status === "completed") return <span className="status status-success"><Check size={15} />Выполнено</span>;
  if (entry.type === "task" && entry.date && entry.date < today) return <span className="status status-danger"><CircleAlert size={15} />Просрочено</span>;
  if (entry.type === "idea" && !entry.reviewedAt && entry.revisitDate && entry.revisitDate <= today) return <span className="status status-warning"><Bell size={15} />Пора вернуться</span>;
  return null;
}

function EntryCard({ entry, today, onOpen }: { entry: Entry; today: string; onOpen: (entry: Entry) => void }) {
  return (
    <button className="entry-card" onClick={() => onOpen(entry)} aria-label={`Открыть: ${entry.text}`}>
      <span className={`entry-icon entry-icon-${entry.type}`}><IconForType type={entry.type} /></span>
      <span className="entry-content">
        <span className="entry-type">{TYPE_LABELS[entry.type]}</span>
        <span className="entry-text">{entry.text}</span>
        <span className="entry-meta">
          {entry.type === "task" && entry.date ? `${formatDateKey(entry.date)}${entry.time ? ` · ${entry.time}` : ""}` : null}
          {entry.type === "idea" && entry.revisitDate ? `Вернуться ${formatDateKey(entry.revisitDate)}` : null}
          {entry.type === "note" ? `Создано ${new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short" }).format(new Date(entry.createdAt))}` : null}
        </span>
        <StatusBadge entry={entry} today={today} />
      </span>
      <ChevronRight className="entry-chevron" size={20} aria-hidden="true" />
    </button>
  );
}

export default function NotesApp() {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [screen, setScreen] = useState<Screen>("today");
  const [previousScreen, setPreviousScreen] = useState<Screen>("today");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editorType, setEditorType] = useState<RecordType>("note");
  const [draftText, setDraftText] = useState("");
  const [draftDate, setDraftDate] = useState("");
  const [draftTime, setDraftTime] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [calendarMonth, setCalendarMonth] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const [calendarDate, setCalendarDate] = useState(() => localDateKey());
  const [toast, setToast] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [speechState, setSpeechState] = useState<"idle" | "listening" | "unsupported" | "error">("idle");
  const [permission, setPermission] = useState<NotificationPermission | "unsupported">("default");
  const [reminderInfo, setReminderInfo] = useState(false);
  const [installPrompt, setInstallPrompt] = useState<Event | null>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const today = localDateKey();

  const persistEntries = useCallback((updater: (current: Entry[]) => Entry[]) => {
    setEntries((current) => {
      const next = updater(current);
      writeEntries(next);
      return next;
    });
  }, []);

  useEffect(() => {
    const hydrationTimer = window.setTimeout(() => {
      setEntries(readEntries());
      if ("Notification" in window) setPermission(Notification.permission);
      else setPermission("unsupported");
    }, 0);
    if ("serviceWorker" in navigator) navigator.serviceWorker.register(new URL("sw.js", document.baseURI).pathname).catch(() => undefined);
    const handleInstall = (event: Event) => { event.preventDefault(); setInstallPrompt(event); };
    window.addEventListener("beforeinstallprompt", handleInstall);
    return () => {
      window.clearTimeout(hydrationTimer);
      window.removeEventListener("beforeinstallprompt", handleInstall);
    };
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 2600);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const playReminderSound = useCallback(() => {
    try {
      const AudioContextClass = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioContextClass) return;
      const context = new AudioContextClass();
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.frequency.setValueAtTime(660, context.currentTime);
      oscillator.frequency.setValueAtTime(880, context.currentTime + 0.12);
      gain.gain.setValueAtTime(0.0001, context.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.12, context.currentTime + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.32);
      oscillator.connect(gain); gain.connect(context.destination);
      oscillator.start(); oscillator.stop(context.currentTime + 0.34);
      window.setTimeout(() => context.close(), 500);
    } catch { /* Sound remains controlled by the operating system. */ }
  }, []);

  const checkReminders = useCallback(async () => {
    if (permission !== "granted") return;
    const due = entries.filter((entry) => entryIsDue(entry));
    if (!due.length) return;
    const notified: string[] = JSON.parse(localStorage.getItem(NOTIFIED_KEY) ?? "[]");
    for (const entry of due) {
      const stamp = `${entry.id}:${entry.type === "task" ? `${entry.date}-${entry.time ?? "day"}` : entry.revisitDate}`;
      if (notified.includes(stamp)) continue;
      const title = entry.type === "task" ? "Пора выполнить задачу" : "Пора вернуться к идее";
      try {
        const registration = await navigator.serviceWorker.ready;
        const icon = new URL("icons/icon-192.png", document.baseURI).pathname;
        await registration.showNotification(title, { body: entry.text, icon, badge: icon, tag: stamp });
        playReminderSound();
        notified.push(stamp);
      } catch { /* Today screen still shows the reminder. */ }
    }
    localStorage.setItem(NOTIFIED_KEY, JSON.stringify(notified.slice(-200)));
  }, [entries, permission, playReminderSound]);

  useEffect(() => {
    checkReminders();
    const timer = window.setInterval(checkReminders, 30000);
    return () => window.clearInterval(timer);
  }, [checkReminders]);

  const openScreen = (next: Screen) => { setPreviousScreen(screen); setScreen(next); window.scrollTo({ top: 0, behavior: "smooth" }); };
  const openCreate = () => openScreen("create");
  const startEditor = (type: RecordType) => {
    setEditorType(type); setDraftText(""); setDraftDate(type === "task" ? today : ""); setDraftTime(""); setEditingId(null);
    openScreen("editor");
  };
  const editEntry = (entry: Entry) => {
    setEditorType(entry.type); setDraftText(entry.text); setDraftDate(entry.date ?? ""); setDraftTime(entry.time ?? ""); setEditingId(entry.id);
    openScreen("editor");
  };
  const openEntry = (entry: Entry) => {
    if (entry.type === "idea" && entry.status === "active" && !entry.reviewedAt && entry.revisitDate && entry.revisitDate <= today) {
      persistEntries((current) => current.map((item) => item.id === entry.id ? {
        ...item, reviewedAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      } : item));
    }
    setSelectedId(entry.id); openScreen("details");
  };
  const selectedEntry = entries.find((entry) => entry.id === selectedId) ?? null;

  const saveEntry = () => {
    const text = draftText.trim();
    if (!text) { setToast("Напишите или надиктуйте текст"); return; }
    if (editorType === "task" && !draftDate) { setToast("Выберите дату задачи"); return; }
    const now = new Date().toISOString();
    if (editingId) {
      persistEntries((current) => current.map((entry) => entry.id === editingId ? {
        ...entry, type: editorType, text, date: editorType === "task" ? draftDate : undefined,
        time: editorType === "task" && draftTime ? draftTime : undefined,
        revisitDate: editorType === "idea" ? (entry.revisitDate ?? ideaRevisitDate(new Date(entry.createdAt))) : undefined,
        reviewedAt: editorType === "idea" ? entry.reviewedAt : undefined,
        updatedAt: now,
      } : entry));
      setSelectedId(editingId); setToast("Изменения сохранены"); setScreen("details");
    } else {
      const entry: Entry = {
        id: crypto.randomUUID(), type: editorType, text, createdAt: now, updatedAt: now, status: "active",
        date: editorType === "task" ? draftDate : undefined,
        time: editorType === "task" && draftTime ? draftTime : undefined,
        revisitDate: editorType === "idea" ? ideaRevisitDate() : undefined,
      };
      persistEntries((current) => [entry, ...current]);
      setToast(`${TYPE_LABELS[editorType]} сохранена`); setScreen("today");
    }
  };

  const deleteEntry = () => {
    if (!selectedEntry) return;
    persistEntries((current) => current.filter((entry) => entry.id !== selectedEntry.id));
    setConfirmDelete(false); setSelectedId(null); setToast("Запись удалена"); setScreen("records");
  };

  const toggleComplete = (entry: Entry) => {
    const completed = entry.status !== "completed";
    persistEntries((current) => current.map((item) => item.id === entry.id ? {
      ...item, status: completed ? "completed" : "active", completedAt: completed ? new Date().toISOString() : undefined, updatedAt: new Date().toISOString(),
    } : item));
    setToast(completed ? "Задача выполнена" : "Задача снова активна");
  };

  const remindIdeaAgain = (entry: Entry) => {
    persistEntries((current) => current.map((item) => item.id === entry.id ? {
      ...item, revisitDate: ideaRevisitDate(), reviewedAt: undefined, updatedAt: new Date().toISOString(),
    } : item));
    setToast("Напомним об идее через 7 дней");
  };

  const toggleSpeech = () => {
    if (speechState === "listening") { recognitionRef.current?.stop(); return; }
    const Recognition = getSpeechRecognition();
    if (!Recognition) { setSpeechState("unsupported"); return; }
    const recognition = new Recognition(); recognition.lang = "ru-RU"; recognition.interimResults = false; recognition.continuous = false;
    recognition.onresult = (event) => {
      const transcript = event.results[0]?.[0]?.transcript?.trim();
      if (transcript) setDraftText((value) => `${value}${value ? " " : ""}${transcript}`);
    };
    recognition.onerror = () => setSpeechState("error");
    recognition.onend = () => setSpeechState((state) => state === "error" ? "error" : "idle");
    recognitionRef.current = recognition; setSpeechState("listening");
    try { recognition.start(); } catch { setSpeechState("error"); }
  };

  const enableNotifications = async () => {
    if (!("Notification" in window)) { setPermission("unsupported"); setReminderInfo(true); return; }
    const result = await Notification.requestPermission(); setPermission(result); setReminderInfo(true);
    if (result === "granted") { setToast("Напоминания включены"); playReminderSound(); }
  };

  const installApp = async () => {
    if (!installPrompt) { setReminderInfo(true); return; }
    const prompt = installPrompt as Event & { prompt(): Promise<void> };
    await prompt.prompt(); setInstallPrompt(null);
  };

  const todayTasks = sortEntries(entries.filter((entry) => entry.type === "task" && entry.status === "active" && entry.date && entry.date <= today));
  const dueIdeas = sortEntries(entries.filter((entry) => entry.type === "idea" && entry.status === "active" && !entry.reviewedAt && entry.revisitDate && entry.revisitDate <= today));
  const filteredEntries = sortEntries(entries.filter((entry) => {
    if (filter === "all") return entry.status === "active";
    if (filter === "completed") return entry.type === "task" && entry.status === "completed";
    return entry.type === filter && entry.status === "active";
  }));

  const calendarCells = useMemo(() => {
    const year = calendarMonth.getFullYear(); const month = calendarMonth.getMonth();
    const firstOffset = (new Date(year, month, 1).getDay() + 6) % 7;
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const cells: Array<{ date: string; day: number } | null> = Array.from({ length: firstOffset }, () => null);
    for (let day = 1; day <= daysInMonth; day += 1) cells.push({ date: localDateKey(new Date(year, month, day)), day });
    while (cells.length % 7) cells.push(null);
    return cells;
  }, [calendarMonth]);
  const datesWithTasks = new Set(entries.filter((entry) => entry.type === "task" && entry.date).map((entry) => entry.date as string));
  const calendarEntries = sortEntries(entries.filter((entry) => entry.type === "task" && entry.date === calendarDate));

  return (
    <main className="app-shell">
      <div className="app-frame">
        {screen === "today" && (
          <section className="screen" aria-labelledby="today-title">
            <header className="page-header">
              <div><h1 id="today-title">Сегодня</h1><p className="date-heading">{formatLongDate(new Date())}</p></div>
              <button className="icon-button" onClick={() => setReminderInfo(true)} aria-label="Настройки напоминаний"><Settings2 /></button>
            </header>

            <section className="section-block" aria-labelledby="tasks-title">
              <div className="section-heading"><span className="section-icon"><ClipboardList /></span><h2 id="tasks-title">Задачи</h2><span className="count-badge">{todayTasks.length}</span></div>
              {todayTasks.length ? <div className="card-stack">{todayTasks.map((entry) => <EntryCard key={entry.id} entry={entry} today={today} onOpen={openEntry} />)}</div> : <div className="empty-card"><CheckCircle2 /><strong>На сегодня всё спокойно</strong><span>Новых и просроченных задач нет.</span></div>}
            </section>

            <section className="section-block" aria-labelledby="ideas-title">
              <div className="section-heading"><span className="section-icon"><Lightbulb /></span><h2 id="ideas-title">Идеи</h2><span className="count-badge">{dueIdeas.length}</span></div>
              {dueIdeas.length ? <div className="card-stack">{dueIdeas.map((entry) => <EntryCard key={entry.id} entry={entry} today={today} onOpen={openEntry} />)}</div> : <div className="empty-card"><Lightbulb /><strong>Идеи ещё созревают</strong><span>Здесь появятся идеи, к которым пора вернуться.</span></div>}
            </section>

            <button className="primary-button create-main" onClick={openCreate}><Pencil />Создать запись</button>
          </section>
        )}

        {screen === "create" && (
          <section className="screen" aria-labelledby="create-title">
            <PageTop title="Создать запись" subtitle="Что хотите сохранить?" onBack={() => setScreen(previousScreen === "editor" ? "today" : previousScreen)} />
            <div className="creation-list">
              {(["note", "idea", "task"] as RecordType[]).map((type) => (
                <button key={type} className="creation-card" onClick={() => startEditor(type)}>
                  <span className="creation-icon"><IconForType type={type} size={30} /></span>
                  <span><strong>{TYPE_LABELS[type]}</strong><small>{TYPE_HELP[type]}</small></span><ChevronRight />
                </button>
              ))}
            </div>
          </section>
        )}

        {screen === "editor" && (
          <section className="screen editor-screen" aria-labelledby="editor-title">
            <header className="editor-header">
              <button className="icon-button bare" onClick={() => setScreen(editingId ? "details" : "create")} aria-label="Назад"><ArrowLeft /></button>
              <h1 id="editor-title">{editingId ? `Изменить: ${TYPE_LABELS[editorType].toLowerCase()}` : `Новая ${TYPE_LABELS[editorType].toLowerCase()}`}</h1>
              <button className="text-button" onClick={saveEntry}><Save size={18} />Сохранить</button>
            </header>
            <div className="editor-box">
              <label className="sr-only" htmlFor="entry-text">Текст записи</label>
              <textarea id="entry-text" autoFocus value={draftText} onChange={(event) => setDraftText(event.target.value)} placeholder="Напишите, что важно…" />
              <button className={`mic-button ${speechState === "listening" ? "is-listening" : ""}`} onClick={toggleSpeech} aria-label={speechState === "listening" ? "Остановить голосовой ввод" : "Начать голосовой ввод"} aria-pressed={speechState === "listening"}>
                {speechState === "listening" ? <MicOff /> : <Mic />}
              </button>
            </div>
            <p className={`input-help ${speechState === "unsupported" || speechState === "error" ? "help-warning" : ""}`}>
              {speechState === "listening" && "Слушаю… говорите спокойно"}
              {speechState === "unsupported" && "В этом браузере голосовой ввод недоступен. Используйте диктовку на клавиатуре телефона."}
              {speechState === "error" && "Не удалось включить микрофон. Проверьте разрешение браузера или используйте клавиатуру."}
              {speechState === "idle" && "Можно написать или надиктовать — аудио не сохраняется"}
            </p>
            {editorType === "task" && <div className="form-card"><h2>Когда напомнить</h2><label>Дата<input type="date" min={today} value={draftDate} onInput={(event) => setDraftDate(event.currentTarget.value)} /></label><label>Время <span>(необязательно)</span><input type="time" value={draftTime} onInput={(event) => setDraftTime(event.currentTarget.value)} /></label><p><Bell size={17} /> Часовой пояс берётся с этого устройства.</p></div>}
            {editorType === "idea" && <div className="info-card"><BellRing /><div><strong>Вернём идею через 7 дней</strong><span>{formatDateKey(ideaRevisitDate())} она появится на экране «Сегодня».</span></div></div>}
            <div className="type-picker"><h2>Тип записи</h2><div>{(["note", "idea", "task"] as RecordType[]).map((type) => <button key={type} className={editorType === type ? "active" : ""} onClick={() => { setEditorType(type); if (type === "task" && !draftDate) setDraftDate(today); }}><IconForType type={type} size={18} />{TYPE_LABELS[type]}</button>)}</div></div>
            <button className="primary-button editor-save" onClick={saveEntry}><Save />Сохранить</button>
          </section>
        )}

        {screen === "records" && (
          <section className="screen" aria-labelledby="records-title">
            <PageTop title="Все записи" subtitle={`${entries.length} ${entries.length === 1 ? "запись" : "записей"}`} />
            <div className="filter-row" role="tablist" aria-label="Фильтр записей">
              {([ ["all", "Актуальные"], ["note", "Заметки"], ["idea", "Идеи"], ["task", "Задачи"], ["completed", "История"] ] as [Filter, string][]).map(([value, label]) => <button key={value} role="tab" aria-selected={filter === value} className={filter === value ? "active" : ""} onClick={() => setFilter(value)}>{label}</button>)}
            </div>
            {filteredEntries.length ? <div className="card-stack records-stack">{filteredEntries.map((entry) => <EntryCard key={entry.id} entry={entry} today={today} onOpen={openEntry} />)}</div> : <div className="empty-state"><BookOpen /><h2>Здесь пока пусто</h2><p>Создайте запись — она сохранится только на этом устройстве.</p><button className="secondary-button" onClick={openCreate}><Plus />Создать запись</button></div>}
          </section>
        )}

        {screen === "calendar" && (
          <section className="screen" aria-labelledby="calendar-title">
            <PageTop title="Календарь" subtitle="Задачи по датам" />
            <div className="calendar-card">
              <div className="calendar-head"><button className="icon-button bare" onClick={() => setCalendarMonth(new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() - 1, 1))} aria-label="Предыдущий месяц"><ChevronLeft /></button><h2>{new Intl.DateTimeFormat("ru-RU", { month: "long", year: "numeric" }).format(calendarMonth)}</h2><button className="icon-button bare" onClick={() => setCalendarMonth(new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() + 1, 1))} aria-label="Следующий месяц"><ChevronRight /></button></div>
              <div className="weekdays" aria-hidden="true">{["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"].map((day) => <span key={day}>{day}</span>)}</div>
              <div className="calendar-grid">{calendarCells.map((cell, index) => cell ? <button key={cell.date} className={`${cell.date === today ? "today" : ""} ${cell.date === calendarDate ? "selected" : ""}`} onClick={() => setCalendarDate(cell.date)} aria-label={formatDateKey(cell.date)} aria-pressed={cell.date === calendarDate}><span>{cell.day}</span>{datesWithTasks.has(cell.date) && <i aria-label="Есть задачи" />}</button> : <span key={`empty-${index}`} />)}</div>
            </div>
            <section className="section-block calendar-list"><div className="section-heading"><h2>{formatDateKey(calendarDate)}</h2><span className="count-badge">{calendarEntries.length}</span></div>{calendarEntries.length ? <div className="card-stack">{calendarEntries.map((entry) => <EntryCard key={entry.id} entry={entry} today={today} onOpen={openEntry} />)}</div> : <div className="empty-card"><CalendarDays /><strong>Задач нет</strong><span>Можно запланировать новую на эту дату.</span></div>}<button className="secondary-button full" onClick={() => { setEditorType("task"); setDraftText(""); setDraftDate(calendarDate); setDraftTime(""); setEditingId(null); openScreen("editor"); }}><Plus />Добавить задачу</button></section>
          </section>
        )}

        {screen === "details" && selectedEntry && (
          <section className="screen" aria-labelledby="details-title">
            <PageTop title={TYPE_LABELS[selectedEntry.type]} subtitle={selectedEntry.status === "completed" ? "В истории" : "Актуальная запись"} onBack={() => setScreen(previousScreen === "editor" ? "records" : previousScreen)} />
            <article className="detail-card"><div className={`entry-icon entry-icon-${selectedEntry.type}`}><IconForType type={selectedEntry.type} /></div><p id="details-title">{selectedEntry.text}</p><dl><div><dt>Создано</dt><dd>{new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(selectedEntry.createdAt))}</dd></div>{selectedEntry.type === "task" && <div><dt>Срок</dt><dd>{formatDateKey(selectedEntry.date)}{selectedEntry.time ? ` в ${selectedEntry.time}` : ""}</dd></div>}{selectedEntry.type === "idea" && <div><dt>Напоминание</dt><dd>{selectedEntry.reviewedAt ? "Идея просмотрена" : formatDateKey(selectedEntry.revisitDate)}</dd></div>}{selectedEntry.completedAt && <div><dt>Выполнено</dt><dd>{new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" }).format(new Date(selectedEntry.completedAt))}</dd></div>}</dl><StatusBadge entry={selectedEntry} today={today} /></article>
            {selectedEntry.type === "task" && <button className={selectedEntry.status === "completed" ? "secondary-button full" : "primary-button full"} onClick={() => toggleComplete(selectedEntry)}>{selectedEntry.status === "completed" ? <RotateCcw /> : <Check />} {selectedEntry.status === "completed" ? "Вернуть в активные" : "Отметить выполненной"}</button>}
            {selectedEntry.type === "idea" && <button className="primary-button full" onClick={() => remindIdeaAgain(selectedEntry)}><BellRing />Напомнить ещё через 7 дней</button>}
            <div className="detail-actions"><button className="secondary-button" onClick={() => editEntry(selectedEntry)}><Pencil />Изменить</button><button className="danger-button" onClick={() => setConfirmDelete(true)}><Trash2 />Удалить</button></div>
          </section>
        )}

        {screen !== "editor" && screen !== "details" && (
          <nav className="bottom-nav" aria-label="Основная навигация">
            <NavButton label="Сегодня" active={screen === "today"} onClick={() => setScreen("today")} icon={<Home />} />
            <NavButton label="Записи" active={screen === "records"} onClick={() => setScreen("records")} icon={<ListFilter />} />
            <button className={`nav-create ${screen === "create" ? "active" : ""}`} onClick={openCreate} aria-label="Создать запись"><Plus /><span>Создать</span></button>
            <NavButton label="Календарь" active={screen === "calendar"} onClick={() => setScreen("calendar")} icon={<CalendarDays />} />
          </nav>
        )}
      </div>

      {toast && <div className="toast" role="status"><CheckCircle2 />{toast}</div>}
      {confirmDelete && <Modal title="Удалить запись?" onClose={() => setConfirmDelete(false)}><p>Запись исчезнет с этого устройства. Отменить удаление будет нельзя.</p><div className="modal-actions"><button className="secondary-button" onClick={() => setConfirmDelete(false)}>Оставить</button><button className="danger-button" onClick={deleteEntry}><Trash2 />Удалить</button></div></Modal>}
      {reminderInfo && <Modal title="Напоминания" onClose={() => setReminderInfo(false)}><div className="modal-copy"><p><strong>Данные остаются на устройстве.</strong> Приложение проверяет сроки, пока оно открыто, и всегда показывает их на экране «Сегодня».</p><p>Уведомления и звук зависят от браузера и настроек телефона. На iPhone установите приложение на экран «Домой» и разрешите уведомления; iOS может не запускать локальные напоминания, когда приложение полностью закрыто.</p></div><div className="modal-actions vertical"><button className="primary-button" onClick={enableNotifications} disabled={permission === "granted"}><Bell />{permission === "granted" ? "Уведомления разрешены" : permission === "denied" ? "Разрешение отключено" : "Разрешить уведомления"}</button><button className="secondary-button" onClick={installApp}><Plus />Установить приложение</button></div>{permission === "denied" && <p className="permission-note">Откройте настройки сайта в браузере и включите уведомления вручную.</p>}</Modal>}
    </main>
  );
}

function PageTop({ title, subtitle, onBack }: { title: string; subtitle?: string; onBack?: () => void }) {
  return <header className="page-top">{onBack && <button className="icon-button bare" onClick={onBack} aria-label="Назад"><ArrowLeft /></button>}<div><h1>{title}</h1>{subtitle && <p>{subtitle}</p>}</div></header>;
}

function NavButton({ label, active, onClick, icon }: { label: string; active: boolean; onClick: () => void; icon: React.ReactNode }) {
  return <button className={active ? "active" : ""} aria-current={active ? "page" : undefined} onClick={onClick}>{icon}<span>{label}</span></button>;
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) onClose(); }}><section className="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title"><header><h2 id="modal-title">{title}</h2><button className="icon-button bare" onClick={onClose} aria-label="Закрыть"><X /></button></header>{children}</section></div>;
}
