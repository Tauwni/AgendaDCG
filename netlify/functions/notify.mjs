import { KINDS, events, profiles, pushLog, listAll, pushReady, sendPush, parisNow, addDays, frDate, describe } from "../lib/shared.mjs";

const list = (items) => items.slice(0, 3).map(describe).join("\n") + (items.length > 3 ? `\n+ ${items.length - 3} autre${items.length > 4 ? "s" : ""}` : "");

async function once(key, send) {
  const log = pushLog();
  if (await log.get(key)) return false;
  await log.setJSON(key, { at: new Date().toISOString() });
  await send();
  return true;
}

export async function runNotifications(now = parisNow(), push = sendPush) {
  if (push === sendPush && !pushReady()) return { skipped: "push non configuré" };
  const [all, people] = await Promise.all([listAll(events()), listAll(profiles())]);
  const sent = [];
  const pending = (p, e) => !(p.done || []).includes(e.id);

  for (const p of people.filter((x) => x.subs?.length)) {
    const prefs = p.prefs || {};

    if (now.hour === 7 && prefs.daily) {
      const today = all.filter((e) => e.date === now.iso && pending(p, e));
      if (today.length) {
        const ok = await once(`daily-${p.id}-${now.iso}`, () =>
          push(p, { title: `Aujourd'hui · ${today.length} élément${today.length > 1 ? "s" : ""}`, body: list(today), url: "/?tab=today", tag: `daily-${now.iso}` }));
        if (ok) sent.push(`daily ${p.id}`);
      }
    }

    if (now.hour === 19) {
      for (const d of prefs.before || []) {
        const target = addDays(now.iso, d);
        for (const e of all.filter((x) => x.date === target && KINDS[x.kind]?.deadline && pending(p, x))) {
          const when = d === 1 ? "Demain" : `Dans ${d} jours`;
          const ok = await once(`before-${p.id}-${e.id}-${d}`, () =>
            push(p, { title: `${when} : ${KINDS[e.kind].label.toLowerCase()}`, body: `${describe(e)} · ${frDate(e.date)}`, url: `/?event=${e.id}`, tag: `before-${e.id}-${d}` }));
          if (ok) sent.push(`before ${p.id} ${e.id} J-${d}`);
        }
      }
    }

    if (now.weekday === "Sun" && now.hour === 18 && prefs.weekly) {
      const end = addDays(now.iso, 7);
      const week = all.filter((e) => e.date > now.iso && e.date <= end && pending(p, e));
      const ok = await once(`weekly-${p.id}-${now.iso}`, () =>
        push(p, {
          title: week.length ? `Ta semaine · ${week.length} élément${week.length > 1 ? "s" : ""}` : "Ta semaine",
          body: week.length ? list(week) : "Rien de prévu cette semaine.",
          url: "/?tab=agenda", tag: `weekly-${now.iso}`,
        }));
      if (ok) sent.push(`weekly ${p.id}`);
    }
  }
  return { at: now, sent };
}

export default async () => {
  const result = await runNotifications();
  console.log(JSON.stringify(result));
};

export const config = { schedule: "2 * * * *" };
