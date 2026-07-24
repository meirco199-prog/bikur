// אחסון פשוט בקובץ JSON — בלי מסד נתונים, בלי שרתים.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', 'data');
const FILE = path.join(DATA_DIR, 'store.json');

const EMPTY = { tasks: [], reminders: [], events: [], nextId: 1, lastBriefDate: null };

let state = null;

function load() {
  if (state) return state;
  try {
    state = { ...EMPTY, ...JSON.parse(fs.readFileSync(FILE, 'utf8')) };
  } catch {
    state = { ...EMPTY };
  }
  return state;
}

function save() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
  fs.renameSync(tmp, FILE);
}

function nextId() {
  const s = load();
  return s.nextId++;
}

// --- משימות ---
export function addTask(text) {
  const s = load();
  const task = { id: nextId(), text, done: false, created: Date.now() };
  s.tasks.push(task);
  save();
  return task;
}

export function listTasks() {
  return load().tasks;
}

export function openTasks() {
  return load().tasks.filter(t => !t.done);
}

// index = מספר סידורי ברשימת המשימות הפתוחות (1-based)
export function completeTask(index) {
  const open = openTasks();
  const task = open[index - 1];
  if (!task) return null;
  task.done = true;
  task.doneAt = Date.now();
  save();
  return task;
}

export function deleteTask(index) {
  const s = load();
  const open = openTasks();
  const task = open[index - 1];
  if (!task) return null;
  s.tasks = s.tasks.filter(t => t.id !== task.id);
  save();
  return task;
}

export function clearDoneTasks() {
  const s = load();
  const n = s.tasks.filter(t => t.done).length;
  s.tasks = s.tasks.filter(t => !t.done);
  save();
  return n;
}

// --- תזכורות ---
export function addReminder(text, at, recurringDaily = false) {
  const s = load();
  const r = { id: nextId(), text, at: at.getTime(), recurringDaily, created: Date.now() };
  s.reminders.push(r);
  save();
  return r;
}

export function listReminders() {
  return load().reminders.slice().sort((a, b) => a.at - b.at);
}

export function dueReminders(now = Date.now()) {
  return load().reminders.filter(r => r.at <= now);
}

export function markReminderFired(id, now = Date.now()) {
  const s = load();
  const r = s.reminders.find(x => x.id === id);
  if (!r) return;
  if (r.recurringDaily) {
    // מקדם ליום הבא באותה שעה
    while (r.at <= now) r.at += 86400000;
  } else {
    s.reminders = s.reminders.filter(x => x.id !== id);
  }
  save();
}

export function deleteReminder(index) {
  const s = load();
  const sorted = listReminders();
  const r = sorted[index - 1];
  if (!r) return null;
  s.reminders = s.reminders.filter(x => x.id !== r.id);
  save();
  return r;
}

// --- אירועים (יומן) ---
export function addEvent(text, at) {
  const s = load();
  const e = { id: nextId(), text, at: at.getTime(), created: Date.now() };
  s.events.push(e);
  save();
  return e;
}

export function eventsBetween(from, to) {
  return load().events
    .filter(e => e.at >= from && e.at < to)
    .sort((a, b) => a.at - b.at);
}

export function deleteEvent(index, from, to) {
  const s = load();
  const inRange = eventsBetween(from, to);
  const e = inRange[index - 1];
  if (!e) return null;
  s.events = s.events.filter(x => x.id !== e.id);
  save();
  return e;
}

export function upcomingEvents(now = Date.now()) {
  return load().events.filter(e => e.at >= now - 3600000).sort((a, b) => a.at - b.at);
}

export function pruneOldEvents(now = Date.now()) {
  const s = load();
  const cutoff = now - 7 * 86400000;
  const before = s.events.length;
  s.events = s.events.filter(e => e.at >= cutoff);
  if (s.events.length !== before) save();
}

// --- סיכום בוקר ---
export function getLastBriefDate() {
  return load().lastBriefDate;
}

export function setLastBriefDate(d) {
  load().lastBriefDate = d;
  save();
}
