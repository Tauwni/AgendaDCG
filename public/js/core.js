// Agenda DCG — Cœur : état, outils, appels au serveur.
// Les fichiers de /js sont chargés dans l'ordre indiqué dans index.html et partagent les mêmes variables.

const COLORS = ["red", "orange", "yellow", "green", "blue", "purple", "brown"];
const MONTHS = ["janvier","février","mars","avril","mai","juin","juillet","août","septembre","octobre","novembre","décembre"];
const MONTHS_SHORT = ["janv.","févr.","mars","avr.","mai","juin","juil.","août","sept.","oct.","nov.","déc."];
const DAYS = ["dimanche","lundi","mardi","mercredi","jeudi","vendredi","samedi"];
const $ = (s) => document.querySelector(s);
const EASE = "cubic-bezier(.32,.72,0,1)";
const reducedMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
const isPhone = () => matchMedia("(max-width: 700px)").matches;

const KINDS = {
  eval: { label: "Évaluation", icon: `<path d="M9 4h6v3H9z"/><path d="M15 5.5h2A1.5 1.5 0 0118.5 7v12A1.5 1.5 0 0117 20.5H7A1.5 1.5 0 015.5 19V7A1.5 1.5 0 017 5.5h2"/><path d="M9 13l2 2 4-4"/>` },
  examen: { label: "Examen blanc", icon: `<circle cx="12" cy="13" r="7.5"/><path d="M12 9.5V13l2.5 2M10 2.5h4"/>` },
  devoir: { label: "Devoir", icon: `<path d="M15.5 4.5l4 4L9 19l-5 1 1-5z"/><path d="M13 7l4 4"/>` },
  exercice: { label: "Exercice", icon: `<path d="M5 4.5h11.5A2.5 2.5 0 0119 7v13H7.5A2.5 2.5 0 015 17.5z"/><path d="M5 17.5A2.5 2.5 0 017.5 15H19M9 8.5h6M9 11.5h4"/>` },
  cours: { label: "Cours", icon: `<path d="M2.5 9L12 4.5 21.5 9 12 13.5z"/><path d="M6.5 11v4.5c0 1.5 2.5 3 5.5 3s5.5-1.5 5.5-3V11M21.5 9v5"/>` },
  revision: { label: "Révision", icon: `<path d="M20 11.5a8 8 0 10-2.3 5.6"/><path d="M20 5v6.5h-6.5"/>` },
  autre: { label: "Autre", icon: `<circle cx="6" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="18" cy="12" r="1.3"/>` },
};
const DEADLINE = new Set(["eval", "examen", "devoir", "exercice"]);
const kindIcon = (k, cls = "kind-ico") => `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${(KINDS[k] || KINDS.eval).icon}</svg>`;
const kindLabel = (k) => (KINDS[k] || KINDS.eval).label;

const state = {
  events: [], chapters: [], profile: null, tab: "today",
  view: (() => { try { const v = localStorage.getItem("agenda_view"); return ["week", "cahier"].includes(v) ? v : "month"; } catch { return "month"; } })(),
  month: firstOfMonth(new Date()), weekStart: mondayOf(new Date()), selected: iso(new Date()),
};

function iso(d) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; }
function parse(s) { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); }
function firstOfMonth(d) { return new Date(d.getFullYear(), d.getMonth(), 1); }
function mondayOf(d) { const x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x; }
function addDays(d, n) { const x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); x.setDate(x.getDate() + n); return x; }
function weekNumber(d) { const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())); t.setUTCDate(t.getUTCDate() + 4 - (t.getUTCDay() || 7)); const y0 = new Date(Date.UTC(t.getUTCFullYear(), 0, 1)); return Math.ceil(((t - y0) / 864e5 + 1) / 7); }
function esc(s) { return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }
function longDate(s) { const d = parse(s); return `${DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`; }
function dayMonth(s) { const d = parse(s); return `${DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}`; }
function shortDate(s) { const d = parse(s); return `${DAYS[d.getDay()].slice(0, 3)}. ${d.getDate()} ${MONTHS_SHORT[d.getMonth()]}`; }
function size(n) { return n > 1048576 ? (n / 1048576).toFixed(1).replace(".", ",") + " Mo" : Math.max(1, Math.round(n / 1024)) + " Ko"; }
function ago(t) { const d = new Date(t); return d.toLocaleDateString("fr-FR", { day: "numeric", month: "short" }) + " à " + d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }); }
const daysBetween = (a, b) => Math.round((parse(b) - parse(a)) / 864e5);
const col = (c) => `var(--${COLORS.includes(c) ? c : "blue"})`;
const fr = (n, d = 1) => Number(n).toLocaleString("fr-FR", { maximumFractionDigits: d, minimumFractionDigits: 0 });
const plural = (n, w) => `${n} ${w}${n > 1 ? "s" : ""}`;

const holidayCache = {};
function holidaysOf(year) {
  if (holidayCache[year]) return holidayCache[year];
  const a = year % 19, b = Math.floor(year / 100), c = year % 100, d = Math.floor(b / 4), e = b % 4;
  const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
  const easter = new Date(year, month - 1, day);
  const list = {
    [`${year}-01-01`]: "Jour de l'an", [iso(addDays(easter, 1))]: "Lundi de Pâques", [`${year}-05-01`]: "Fête du Travail",
    [`${year}-05-08`]: "Victoire 1945", [iso(addDays(easter, 39))]: "Ascension", [iso(addDays(easter, 50))]: "Lundi de Pentecôte",
    [`${year}-07-14`]: "Fête nationale", [`${year}-08-15`]: "Assomption", [`${year}-11-01`]: "Toussaint",
    [`${year}-11-11`]: "Armistice 1918", [`${year}-12-25`]: "Noël",
  };
  return (holidayCache[year] = list);
}
const holiday = (date) => holidaysOf(Number(date.slice(0, 4)))[date];
