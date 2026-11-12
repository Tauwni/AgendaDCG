// Agenda DCG — Devoirs et évaluations : préparation des PDF, création, modification, fiche détaillée.
// Les fichiers de /js sont chargés dans l'ordre indiqué dans index.html et partagent les mêmes variables.

async function preparePdf(picked, status) {
  const notes = [];
  const images = picked.filter((f) => PdfTools.isImage(f));
  const pdfs = picked.filter((f) => PdfTools.isPdf(f));
  if (picked.length > images.length + pdfs.length) notes.push("fichiers ignorés : PDF, PNG ou JPG seulement");
  let file;
  if (pdfs.length) {
    if (pdfs.length > 1 || images.length) notes.push(`un seul PDF par case : « ${pdfs[0].name} » est utilisé`);
    file = pdfs[0];
    if (file.size > MAX_INPUT_MB * 1024 * 1024) throw new Error(`« ${file.name} » dépasse ${MAX_INPUT_MB} Mo`);
    status("Compression…");
    try {
      const res = await PdfTools.compressPdf(file, (k, n) => status(`Compression · image ${k}/${n}`));
      if (res.compressed) { notes.push(`compressé : ${size(res.before)} → ${size(res.after)}`); file = res.file; }
      else if (file.size > 1024 * 1024) notes.push(res.reason);
    } catch { /* compression is best effort: the original is sent */ }
  } else if (images.length) {
    file = await PdfTools.imagesToPdf(images, (i, n) => status(n > 1 ? `Conversion des photos ${i}/${n}…` : "Conversion en PDF…"));
    notes.push(images.length > 1 ? `${images.length} photos réunies en un PDF` : "photo convertie en PDF");
  } else {
    throw new Error("Choisis un PDF, un PNG ou un JPG");
  }
  if (file.size > MAX_PDF_MB * 1024 * 1024) throw new Error(`« ${file.name} » dépasse encore ${MAX_PDF_MB} Mo après compression`);
  return { file, notes };
}

function putWithProgress(url, file, onProgress) {
  return new Promise((resolve, reject) => {
    const x = new XMLHttpRequest();
    x.open("PUT", url);
    x.setRequestHeader("content-type", "application/pdf");
    x.upload.onprogress = (e) => { if (e.lengthComputable) onProgress(e.loaded / e.total); };
    x.onload = () => {
      if (x.status >= 200 && x.status < 300) return resolve();
      let msg = "Envoi refusé";
      try { msg = JSON.parse(x.responseText).error || msg; } catch {}
      reject(new Error(msg));
    };
    x.onerror = () => reject(new Error("Connexion perdue pendant l'envoi"));
    x.send(file);
  });
}

/** Joint des photos/PDF à un devoir : les photos sont réunies en un PDF, rangé avec le devoir (pas dans les cours). */
async function attachFiles(eventId, picked, status = () => {}) {
  const { file } = await preparePdf(picked, status);
  const base = { event: eventId, by: getName(), name: file.name };
  const post = (path, body) => api(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const start = await post("files/start", { ...base, size: file.size });
  await putWithProgress(start.uploadUrl, file, (p) => status(`Envoi ${Math.round(p * 100)} %`));
  const ev = await post("files/finish", { ...base, key: start.key });
  upsert(ev);
  return ev;
}
const attachmentRows = (e) => (e.attachments || []).map((f) => `<a class="nav-row" href="/api/files/${f.key}" target="_blank" rel="noopener"><span class="folder">${ICON.folder}</span><span class="nav-body"><b>${esc(f.name)}</b><small>${size(f.size || 0)} · ajouté par ${esc(f.uploadedBy || "?")}</small></span>${ICON.chevron}</a>`).join("");

async function uploadToSlot(chapterId, slot, f, onProgress, hash) {
  const base = { chapter: chapterId, slot, by: getName(), name: f.name };
  const post = (path, body) => api(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const start = await post("files/start", { ...base, size: f.size });
  await putWithProgress(start.uploadUrl, f, onProgress);
  return post("files/finish", { ...base, key: start.key, hash });
}


function openSheet(html) {
  const current = $("#sheetRoot .backdrop:not(.closing)");
  if (current) {
    const sheet = current.querySelector(".sheet");
    const h0 = sheet.offsetHeight;
    sheet.innerHTML = `<div class="grabber"></div>${html}`;
    sheet.scrollTop = 0;
    bindSheetDrag(current);
    if (!reducedMotion()) {
      const h1 = sheet.offsetHeight;
      sheet.animate([{ height: `${h0}px` }, { height: `${h1}px` }], { duration: 380, easing: EASE });
      [...sheet.children].forEach((c) => c.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 260, easing: "ease-out" }));
    }
    return current;
  }
  $("#sheetRoot").insertAdjacentHTML("beforeend", `<div class="backdrop"><div class="sheet" role="dialog" aria-modal="true"><div class="grabber"></div>${html}</div></div>`);
  const bd = $("#sheetRoot .backdrop:not(.closing)");
  bd.addEventListener("click", (e) => { if (e.target === bd) closeSheet(); });
  bindSheetDrag(bd);
  if (!reducedMotion()) {
    const sheet = bd.querySelector(".sheet");
    bd.animate([{ backgroundColor: "rgba(0,0,0,0)" }, { backgroundColor: "rgba(0,0,0,.35)" }], { duration: 350, easing: "ease-out" });
    sheet.animate(isPhone()
      ? [{ transform: "translateY(100%)" }, { transform: "none" }]
      : [{ transform: "scale(.94)", opacity: 0 }, { transform: "none", opacity: 1 }], { duration: isPhone() ? 480 : 340, easing: EASE });
  }
  return bd;
}

function closeSheet(dragged) {
  const fromY = typeof dragged === "number" ? dragged : 0;
  const bd = $("#sheetRoot .backdrop:not(.closing)");
  if (!bd) return;
  bd.classList.add("closing");
  if (reducedMotion()) { bd.remove(); return; }
  const sheet = bd.querySelector(".sheet");
  const d = isPhone() ? 320 : 200;
  sheet.animate(isPhone()
    ? [{ transform: `translateY(${fromY}px)` }, { transform: "translateY(100%)" }]
    : [{ transform: "none", opacity: 1 }, { transform: "scale(.96)", opacity: 0 }], { duration: d, easing: isPhone() ? EASE : "ease-in", fill: "forwards" });
  bd.animate([{ backgroundColor: "rgba(0,0,0,.35)" }, { backgroundColor: "rgba(0,0,0,0)" }], { duration: d, easing: "ease-out", fill: "forwards" });
  setTimeout(() => bd.remove(), d + 20);
}

function bindSheetDrag(bd) {
  const sheet = bd.querySelector(".sheet");
  const handles = [sheet.querySelector(".grabber"), sheet.querySelector(".sheet-head")].filter(Boolean);
  let y0 = null, dy = 0;
  for (const h of handles) {
    h.addEventListener("touchstart", (e) => { if (e.target.closest("button")) return; y0 = e.touches[0].clientY; dy = 0; }, { passive: true });
    h.addEventListener("touchmove", (e) => {
      if (y0 === null) return;
      dy = Math.max(0, e.touches[0].clientY - y0);
      sheet.style.transform = `translateY(${dy}px)`;
    }, { passive: true });
    h.addEventListener("touchend", () => {
      if (y0 === null) return;
      y0 = null;
      sheet.style.transform = "";
      if (dy > 110) closeSheet(dy);
      else if (dy > 0) sheet.animate([{ transform: `translateY(${dy}px)` }, { transform: "none" }], { duration: 380, easing: EASE });
    });
  }
}
document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeSheet(); });


const ICON = {
  folder: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M3 6.5A2.5 2.5 0 015.5 4h3.6c.6 0 1.2.2 1.6.6L12 6h6.5A2.5 2.5 0 0121 8.5v9a2.5 2.5 0 01-2.5 2.5h-13A2.5 2.5 0 013 17.5z"/></svg>`,
  chevron: `<svg class="chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg>`,
  back: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>`,
  plus: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>`,
  close: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>`,
  check: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>`,
};
const ACCEPT = "application/pdf,.pdf,image/png,image/jpeg,image/heic,.png,.jpg,.jpeg,.heic";
const slotChips = (ch) => SLOTS.filter(([k]) => !OPTIONAL_SLOTS.has(k) || ch.files[k]).map(([k, label]) => `<span class="chip ${ch.files[k] ? "on" : ""}">${ch.files[k] ? ICON.check : ""}${k === "topexo" ? "TOP EXO" : label.split(" ")[0]}</span>`).join("");


function upsert(ev) {
  const i = state.events.findIndex((x) => x.id === ev.id);
  if (i >= 0) state.events[i] = ev; else state.events.push(ev);
  state.events.sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
  render();
}

function openEdit(ev, date, draft) {
  const base = ev || { kind: state.tab === "today" ? "devoir" : "eval", title: "", subject: "", date: date || state.selected, time: "", color: "blue", notes: "", chapters: [] };
  const d = draft || { ...base, kind: base.kind || "eval", chapters: [...(base.chapters || [])] };
  const bd = openSheet(`
    <div class="sheet-head">
      <button class="link" data-act="cancel">Annuler</button>
      <h3>${ev ? "Modifier" : "Nouveau"}</h3>
      <button class="link bold" data-act="save">${ev ? "OK" : "Ajouter"}</button>
    </div>
    <div class="sheet-body">
      <div class="kinds" role="radiogroup" aria-label="Type">
        ${Object.entries(KINDS).map(([k, v]) => `<button type="button" role="radio" aria-checked="${d.kind === k}" data-kind="${k}" class="${d.kind === k ? "on" : ""}">${kindIcon(k, "")}${v.label}</button>`).join("")}
      </div>
      <div class="group">
        <input name="title" placeholder="Titre (ex : Contrôle chapitre 3)" maxlength="120" value="${esc(d.title)}">
      </div>
      <div>
        <div class="label">Matière</div>
        <div class="group" id="subjectPick" role="radiogroup" aria-label="Matière"></div>
      </div>
      <div class="group">
        <div class="row"><span>Date</span><input type="date" name="date" value="${esc(d.date)}"></div>
        <div class="row"><span>Heure <span style="color:var(--text2)">(facultatif)</span></span><input type="time" name="time" value="${esc(d.time)}"></div>
      </div>
      <div id="dateInfo"></div>
      <div>
        <div class="label">Sujet ou consignes en photo / PDF <span style="color:var(--text2);text-transform:none">(facultatif)</span></div>
        <label class="group upload" style="cursor:pointer">📷<span>Prendre le sujet en photo</span><input type="file" id="cameraInput" accept="image/*" capture="environment" hidden></label>
        <label class="group upload" style="cursor:pointer;margin-top:8px">${ICON.plus}<span id="attachLabel">Joindre une photo ou un PDF</span><input type="file" id="attachInput" accept="application/pdf,image/png,image/jpeg,image/heic,image/webp" multiple hidden></label>
      </div>
      <div>
        <div class="label">Chapitres concernés</div>
        <div class="group" id="chapterPick"></div>
      </div>
      <div>
        <div class="label">Couleur</div>
        <div class="group swatches">${COLORS.map((c) => `<button type="button" class="swatch ${c === d.color ? "on" : ""}" data-color="${c}" style="--c:var(--${c})" aria-label="${c}"></button>`).join("")}</div>
      </div>
      <div class="group"><textarea name="notes" rows="3" placeholder="Notes (consignes, pages, durée…)" maxlength="2000">${esc(d.notes)}</textarea></div>
    </div>`);

  const field = (n) => bd.querySelector(`[name=${n}]`);
  const sync = () => { for (const n of ["title", "date", "time", "notes"]) d[n] = field(n).value; };
  const drawSubjects = () => {
    const list = courseSubjects(d.subject ? [d.subject] : []);
    const row = (value, label) => `<button type="button" class="subj-opt ${sameSubject(d.subject, value) ? "on" : ""}" role="radio" aria-checked="${sameSubject(d.subject, value)}" data-subject="${esc(value)}"><span>${esc(label)}</span>${ICON.check}</button>`;
    bd.querySelector("#subjectPick").innerHTML = list.map((s) => row(s, s)).join("") + row("", "Aucune matière")
      + (list.length ? "" : `<div class="hint">Aucune matière n'a encore de cours. Ajoute des chapitres dans l'onglet Cours.</div>`);
    bd.querySelectorAll("#subjectPick [data-subject]").forEach((b) => b.onclick = () => {
      d.subject = b.dataset.subject;
      if (d.subject && !d.chapters.every((id) => sameSubject(chapterById(id)?.subject, d.subject))) d.chapters = d.chapters.filter((id) => sameSubject(chapterById(id)?.subject, d.subject));
      drawSubjects();
      drawChapters();
      if (!classFor(d.date, d.subject) && d.subject && DEADLINE.has(d.kind)) { const n = nextClasses(d.subject)[0]; if (n) { d.date = n.date; field("date").value = n.date; } }
      autoSlot();
      drawDateInfo();
    });
  };
  const drawDateInfo = () => {
    const fer = d.date && holiday(d.date);
    const c = classFor(d.date, d.subject);
    const next = d.subject ? nextClasses(d.subject).filter((x) => x.date !== d.date).slice(0, 3) : [];
    bd.querySelector("#dateInfo").innerHTML = (fer ? `<div class="holiday-row" style="padding-left:16px">Attention : ${esc(fer)}, jour férié</div>` : "")
      + (c ? `<div class="class-slot" style="--c:${col(c.color)}">Rangé dans le cours de <b>${esc(c.title)}</b> · ${esc(c.time)}–${esc(c.end)}</div>` : "")
      + (next.length ? `<div class="quick-dates"><span>Prochains cours :</span>${next.map((x) => `<button type="button" data-qdate="${x.date}">${esc(shortDate(x.date))}</button>`).join("")}</div>` : "");
    bd.querySelectorAll("[data-qdate]").forEach((b) => b.onclick = () => { d.date = b.dataset.qdate; field("date").value = d.date; autoSlot(); drawDateInfo(); });
  };
  /* Si la date tombe sur un cours de la matière : heure et couleur du cours, pour que le devoir s'affiche dans sa case. */
  const autoSlot = () => {
    const c = classFor(d.date, d.subject);
    if (!c) return;
    if (!d.time || d.time < c.time || d.time >= c.end) { d.time = c.time; field("time").value = c.time; }
    d.color = c.color;
    bd.querySelectorAll(".swatch").forEach((x) => x.classList.toggle("on", x.dataset.color === c.color));
  };
  let pending = [];
  bd.querySelector("#cameraInput").onchange = (ev) => {
    pending = [...pending, ...ev.target.files];
    bd.querySelector("#attachLabel").textContent = `${pending.length} photo${pending.length > 1 ? "s" : ""} prête${pending.length > 1 ? "s" : ""} · reprendre une photo pour ajouter une page`;
  };
  bd.querySelector("#attachInput").onchange = (ev) => {
    pending = [...ev.target.files];
    bd.querySelector("#attachLabel").textContent = pending.length ? `${pending.length} fichier${pending.length > 1 ? "s" : ""} prêt${pending.length > 1 ? "s" : ""} à envoyer` : "Joindre une photo ou un PDF";
  };

  const drawChapters = () => {
    const box = bd.querySelector("#chapterPick");
    const list = d.subject.trim() ? chaptersOf(d.subject) : [];
    const others = d.chapters.map(chapterById).filter((c) => c && !list.includes(c));
    const rows = [...list, ...others].map((c) => `
      <label class="pick">
        <input type="checkbox" value="${c.id}" ${d.chapters.includes(c.id) ? "checked" : ""}>
        <span class="tick">${ICON.check}</span>
        <span class="pick-body"><span class="pick-title">${esc(c.title)}</span>${others.includes(c) ? `<span class="pick-sub">${esc(c.subject)}</span>` : ""}<span class="chips">${slotChips(c)}</span></span>
      </label>`).join("");
    const empty = !d.subject.trim()
      ? `<div class="hint">Choisis d'abord la matière pour voir ses chapitres.</div>`
      : list.length ? "" : `<div class="hint">Aucun chapitre en ${esc(d.subject)} pour l'instant.</div>`;
    box.innerHTML = `${rows}${empty}<button type="button" class="upload" data-act="newChapter">${ICON.plus}<span>Nouveau chapitre${d.subject.trim() ? ` en ${esc(d.subject)}` : ""}</span></button>`;
    box.querySelectorAll(".pick input").forEach((cb) => cb.onchange = () => {
      d.chapters = cb.checked ? [...new Set([...d.chapters, cb.value])] : d.chapters.filter((x) => x !== cb.value);
    });
    box.querySelector("[data-act=newChapter]").onclick = () => {
      sync();
      openChapterEdit(null, {
        subject: d.subject,
        onDone: (ch) => { d.subject = ch.subject; d.chapters = [...new Set([...d.chapters, ch.id])]; openEdit(ev, date, d); },
        onCancel: () => openEdit(ev, date, d),
      });
    };
  };
  drawSubjects();
  drawChapters();
  drawDateInfo();
  field("date").addEventListener("change", () => { d.date = field("date").value; autoSlot(); drawDateInfo(); });

  bd.querySelectorAll("[data-kind]").forEach((b) => b.onclick = () => {
    d.kind = b.dataset.kind;
    bd.querySelectorAll("[data-kind]").forEach((x) => { x.classList.toggle("on", x === b); x.setAttribute("aria-checked", x === b); });
  });
  bd.querySelectorAll(".swatch").forEach((s) => s.onclick = () => {
    d.color = s.dataset.color;
    bd.querySelectorAll(".swatch").forEach((x) => x.classList.toggle("on", x === s));
  });
  bd.querySelector("[data-act=cancel]").onclick = () => ev ? openDetail(ev.id) : closeSheet();
  bd.querySelector("[data-act=save]").onclick = async (btn) => {
    sync();
    if (!d.title.trim()) return toast("Ajoute un titre");
    btn.target.innerHTML = `<span class="spinner"></span>`;
    try {
      const body = { kind: d.kind, title: d.title, subject: canonicalSubject(d.subject), date: d.date, time: d.time, notes: d.notes, color: d.color, chapters: d.chapters, by: getName() };
      const saved = await send(ev ? `events/${ev.id}` : "events", ev ? "PUT" : "POST", body);
      state.selected = saved.date;
      state.month = firstOfMonth(parse(saved.date));
      state.weekStart = mondayOf(parse(saved.date));
      upsert(saved);
      if (pending.length) await attachFiles(saved.id, pending, (m) => { btn.target.innerHTML = `<span class="spinner"></span>`; toast(m); });
      openDetail(saved.id);
      toast(ev ? "Modifié" : `${kindLabel(saved.kind)} ajouté${["eval", "revision"].includes(saved.kind) ? "e" : ""}`);
    } catch (err) { toast(err.message); btn.target.textContent = ev ? "OK" : "Ajouter"; }
  };
  if (!draft) field("title").focus();
}

function openDetail(id) {
  if (String(id).startsWith("edt:")) return openClass(id);
  const e = state.events.find((x) => x.id === id);
  if (!e) return closeSheet();
  const kind = e.kind || "eval";
  const hist = [...e.history].reverse().slice(0, 8);
  const linked = (e.chapters || []).map(chapterById).filter(Boolean)
    .sort((a, b) => a.subject.localeCompare(b.subject, "fr") || a.title.localeCompare(b.title, "fr", { numeric: true }));
  const fer = holiday(e.date);
  const done = isDone(e.id);
  const bd = openSheet(`
    <div class="sheet-head">
      <button class="link" data-act="close">Fermer</button>
      <h3></h3>
      <button class="link" data-act="edit">Modifier</button>
    </div>
    <div class="sheet-body">
      <div>
        <span class="kind-badge" style="--c:${col(e.color)}">${kindIcon(kind)}${kindLabel(kind)}</span>
        <h2 class="detail-title" style="--c:${col(e.color)}"><span class="bar"></span><span>${esc(e.title)}</span></h2>
        <div class="detail-sub">${esc(e.subject ? e.subject + " · " : "")}${longDate(e.date)}${e.time ? " à " + esc(e.time) : ""}${fer ? ` · férié (${esc(fer)})` : ""}</div>
      </div>
      <button class="btn-row ${done ? "" : "blue"}" data-act="done">${done ? "Remettre à faire" : "Marquer comme fait"}</button>
      ${e.notes ? `<div><div class="label">Notes</div><div class="group notes">${esc(e.notes)}</div></div>` : ""}
      ${classFor(e.date, e.subject) ? `<div class="class-slot" style="--c:${col(e.color)}">Pendant le cours de <b>${esc(classFor(e.date, e.subject).title)}</b> · ${esc(classFor(e.date, e.subject).time)}–${esc(classFor(e.date, e.subject).end)}</div>` : ""}
      <div>
        <div class="label">Sujet et fichiers (${(e.attachments || []).length})</div>
        <div class="group">${attachmentRows(e)}<label class="upload" style="cursor:pointer">📷<span>Prendre le sujet en photo</span><input type="file" data-act="attach" accept="image/*" capture="environment" hidden></label><label class="upload" style="cursor:pointer">${ICON.plus}<span>Ajouter une photo ou un PDF</span><input type="file" data-act="attach" accept="application/pdf,image/png,image/jpeg,image/heic,image/webp" multiple hidden></label></div>
      </div>
      <div>
        <div class="label">Chapitres (${linked.length})</div>
        ${linked.length ? linked.map((c) => `
          <div class="group chapter-card">
            <button class="chapter-head" data-chapter="${c.id}"><span><b>${esc(c.title)}</b>${sameSubject(c.subject, e.subject) ? "" : `<small>${esc(c.subject)}</small>`}</span>${ICON.chevron}</button>
            ${slotRows(c, { editable: false })}
          </div>`).join("") : `<div class="group"><div class="hint">Aucun chapitre lié. Touche « Modifier » pour en choisir dans la bibliothèque.</div></div>`}
      </div>
      ${commentsBlock(e)}
      <div>
        <div class="label">Historique</div>
        <div class="group history">${hist.map((h) => `<div><b>${esc(h.by)}</b> ${esc(h.action)} · ${ago(h.at)}</div>`).join("")}</div>
      </div>
      <button class="btn-row" data-act="delete">Supprimer</button>
    </div>`);

  bd.querySelector("[data-act=close]").onclick = closeSheet;
  bd.querySelectorAll("[data-act=attach]").forEach((inp) => inp.onchange = async (x) => {
    const files = [...x.target.files];
    if (!files.length) return;
    try { await attachFiles(e.id, files, (m) => toast(m)); toast("Fichier ajouté"); openDetail(e.id); render(); }
    catch (err) { toast(err.message); }
  });
  bd.querySelector("[data-act=edit]").onclick = () => openEdit(e);
  bd.querySelector("[data-act=done]").onclick = async () => { await toggleDone(e.id); openDetail(e.id); };
  bd.querySelectorAll("[data-chapter]").forEach((b) => b.onclick = () => openChapter(b.dataset.chapter, () => openDetail(e.id), "Retour"));
  bd.querySelector("[data-act=delete]").onclick = async () => {
    if (!confirm(`Supprimer « ${e.title} » pour toute la classe ? Les chapitres restent dans la bibliothèque.`)) return;
    try {
      await api(`events/${e.id}?by=${encodeURIComponent(getName())}`, { method: "DELETE" });
      state.events = state.events.filter((x) => x.id !== e.id);
      closeSheet(); render(); toast("Supprimé");
    } catch (err) { toast(err.message); }
  };
}
