// Agenda DCG — Onglet Cours : bibliothèque de chapitres, PDF, recherche dans le texte.
// Les fichiers de /js sont chargés dans l'ordre indiqué dans index.html et partagent les mêmes variables.

let coursQuery = "";
function renderCours() {
  const page = $("#page-cours");
  page.innerHTML = `
    <div class="page-head">
      <div><h1 class="page-title">Cours</h1><div class="page-sub">Fiches, sujets types et corrigés, rangés par matière</div></div>
      <span style="display:flex;gap:8px;align-items:center">${state.profile?.admin ? `<button class="link" data-act="importFolder">Importer un dossier</button>` : ""}<button class="icon-btn" data-act="newChapter" aria-label="Nouveau chapitre">${ICON.plus}</button></span>
    </div>
    <input class="search" type="search" placeholder="Rechercher un chapitre, ou un mot dans les cours" value="${esc(coursQuery)}">
    <div class="section" id="coursResults"></div>
    <div class="section" id="textResults"></div>`;
  const draw = () => {
    const box = page.querySelector("#coursResults");
    const q = coursQuery;
    if (q.trim()) {
      const hits = state.chapters.filter((c) => norm(c.title).includes(norm(q)) || norm(c.subject).includes(norm(q)));
      box.innerHTML = hits.length ? `<div class="group">${hits.map((c) => `
        <button class="nav-row" data-chapter="${c.id}"><span class="nav-body"><b>${isRevised(c.id) ? "✓ " : ""}${esc(c.title)}</b><small>${esc(c.subject)}</small><span class="chips">${slotChips(c)}</span></span>${ICON.chevron}</button>`).join("")}</div>`
        : `<div class="empty">Aucun résultat</div>`;
    } else {
      const subjects = allSubjects().filter((s) => chaptersOf(s).length);
      box.innerHTML = subjects.length ? `<div class="group">${subjects.map((s) => `
        <button class="nav-row" data-subject="${esc(s)}"><span class="folder">${ICON.folder}</span><span class="nav-body"><b>${esc(s)}</b><small>${plural(chaptersOf(s).length, "chapitre")} · ${subjectProgress(s).done} révisé${subjectProgress(s).done > 1 ? "s" : ""}</small>${progressBar(subjectProgress(s).pct)}</span>${ICON.chevron}</button>`).join("")}</div>`
        : `<button class="invite" data-act="newChapter">${ICON.plus}<span>La bibliothèque est vide. <b>Ajouter le premier chapitre</b></span></button>`;
    }
    box.querySelectorAll("[data-subject]").forEach((b) => b.onclick = () => openFolder(b.dataset.subject));
    box.querySelectorAll("[data-chapter]").forEach((b) => b.onclick = () => openChapter(b.dataset.chapter, () => closeSheet(), "Fermer"));
    box.querySelectorAll("[data-act=newChapter]").forEach((b) => b.onclick = () => openChapterEdit(null, {}));
  };
  draw();
  let timer;
  const text = () => { clearTimeout(timer); timer = setTimeout(() => searchText(page.querySelector("#textResults")), 450); };
  text();
  page.querySelector(".search").addEventListener("input", (ev) => { coursQuery = ev.target.value; draw(); text(); });
  page.querySelector(".page-head [data-act=newChapter]").onclick = () => openChapterEdit(null, {});
  const imp = page.querySelector("[data-act=importFolder]"); if (imp) imp.onclick = pickImportFolder;
}

/* Recherche d'un mot dans le texte des PDF. Le texte de chaque PDF est extrait une seule fois
   (par le premier appareil qui en a besoin) puis gardé sur le serveur pour toute la classe. */
let textSubject = "", textRun = 0;
async function searchText(box) {
  const q = coursQuery.trim(), run = ++textRun;
  if (q.length < 2) { box.innerHTML = ""; return; }
  const subjects = allSubjects().filter((s) => chaptersOf(s).length);
  const head = `<h2>Dans le texte des cours</h2><select class="search" data-text-subject style="margin-bottom:8px"><option value="">Toutes les matières</option>${subjects.map((s) => `<option${s === textSubject ? " selected" : ""}>${esc(s)}</option>`).join("")}</select>`;
  const show = (body) => { if (run !== textRun) return; box.innerHTML = head + body; box.querySelector("[data-text-subject]").onchange = (e) => { textSubject = e.target.value; searchText(box); }; box.querySelectorAll("[data-chapter]").forEach((b) => b.onclick = () => openChapter(b.dataset.chapter, () => closeSheet(), "Fermer")); };
  show(`<div class="hint">Recherche…</div>`);
  try {
    const find = () => api(`search?q=${encodeURIComponent(q)}&subject=${encodeURIComponent(textSubject)}`);
    let r = await find();
    if (r.missing.length && window.Lecteur?.extract) {
      for (let i = 0; i < r.missing.length && run === textRun; i++) {
        show(`<div class="hint">Préparation de la recherche : lecture des PDF ${i + 1}/${r.missing.length}… (une seule fois)</div>`);
        const key = r.missing[i];
        const txt = await window.Lecteur.extract(`/api/files/${encodeURIComponent(key)}`).catch(() => "");
        await api("search/index", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ key, text: txt }) }).catch(() => {});
      }
      if (run !== textRun) return;
      r = await find();
    }
    const label = (slot) => SLOTS.find(([k]) => k === slot)?.[1] || slot;
    show(r.results.length ? r.results.map((x) => `<div class="label">${esc(x.subject.split(" · ")[0])} · ${esc(x.title)} · ${esc(label(x.slot))} · ${x.count} fois</div>
      <div class="group"><button class="nav-row" data-chapter="${x.chapter}"><span class="nav-body">${x.hits.map((h) => `<small>…${esc(h.before)}<mark>${esc(h.match)}</mark>${esc(h.after)}…</small>`).join("")}</span>${ICON.chevron}</button></div>`).join("")
      : `<div class="hint">Ce mot n'apparaît dans aucun cours${textSubject ? " de cette matière" : ""}.</div>`);
  } catch (err) { show(`<div class="hint">${esc(err.message)}</div>`); }
}

function slotRows(ch, { editable }) {
  return SLOTS.filter(([k]) => editable || !OPTIONAL_SLOTS.has(k) || ch.files[k]).map(([k, label]) => {
    const f = ch.files[k];
    if (f) {
      return `<div class="file">
        <span class="ico">PDF</span>
        <a href="/api/files/${encodeURIComponent(f.key)}" target="_blank" rel="noopener"><div class="n">${label}</div><div class="m">${esc(f.name)} · ${size(f.size)} · ${esc(f.uploadedBy)}</div></a>
        <button class="mini" data-listen="${esc(f.key)}" data-title="${esc(label + " · " + ch.title)}" aria-label="Écouter ${label}" title="Écouter">🎧</button>
        ${f.locked ? `<span class="mini" title="PDF officiel, non supprimable">🔒</span>` : editable ? `<label class="mini" title="Remplacer">Remplacer<input type="file" accept="${ACCEPT}" multiple data-slot="${k}"></label>
        <button class="del" data-del="${k}" aria-label="Supprimer ${label}">${ICON.close}</button>` : ""}
      </div>`;
    }
    return editable
      ? `<label class="upload slot-empty"><span class="ico ghost">PDF</span><span class="slot-text"><b>${label}</b><span data-status="${k}">Ajouter un PDF ou des photos</span></span><input type="file" accept="${ACCEPT}" multiple data-slot="${k}"></label>`
      : `<div class="file missing"><span class="ico ghost">PDF</span><div class="n-wrap"><div class="n">${label}</div><div class="m">Pas encore ajouté</div></div></div>`;
  }).join("");
}


function openFolder(subject) {
  const list = chaptersOf(subject);
  if (!list.length) { closeSheet(); return; }
  const name = list[0].subject;
  const bd = openSheet(`
    <div class="sheet-head">
      <button class="link back" data-act="back">${ICON.back}Cours</button>
      <h3></h3>
      <button class="link bold" data-act="new" aria-label="Nouveau chapitre">${ICON.plus}</button>
    </div>
    <div class="sheet-body">
      <h2 class="folder-title">${esc(name)}</h2>
      <div class="group">${list.map((c) => `
        <button class="nav-row" data-chapter="${c.id}"><span class="nav-body"><b>${isRevised(c.id) ? "✓ " : ""}${esc(c.title)}</b><span class="chips">${slotChips(c)}</span></span>${ICON.chevron}</button>`).join("")}</div>
    </div>`);
  bd.querySelector("[data-act=back]").onclick = () => closeSheet();
  bd.querySelector("[data-act=new]").onclick = () => openChapterEdit(null, { subject: name, onCancel: () => openFolder(name) });
  bd.querySelectorAll("[data-chapter]").forEach((b) => b.onclick = () => openChapter(b.dataset.chapter, () => openFolder(name), name));
}

function openChapter(id, back, backLabel) {
  const c = chapterById(id);
  if (!c) return back ? back() : closeSheet();
  const goBack = back || (() => openFolder(c.subject));
  const label = backLabel || c.subject;
  const uses = usedBy(c.id);
  const hist = [...(c.history || [])].reverse().slice(0, 6);
  const bd = openSheet(`
    <div class="sheet-head">
      <button class="link back" data-act="back">${ICON.back}<span class="back-label">${esc(label)}</span></button>
      <h3></h3>
      <button class="link" data-act="edit">Renommer</button>
    </div>
    <div class="sheet-body">
      <div>
        <div class="detail-sub">${esc(c.subject)}</div>
        <h2 class="folder-title">${esc(c.title)}</h2>
      </div>
      <div class="group">${slotRows(c, { editable: true })}</div>
      <button class="btn-row ${isRevised(c.id) ? "" : "blue"}" data-revised="${c.id}">${isRevised(c.id) ? "✓ Révisé · annuler" : "Marquer comme révisé"}</button>
      ${c.files.sujet ? `<button class="btn-row" data-open-exam="${c.id}">⏱ Faire ce sujet en examen blanc</button>` : ""}
      ${uses.length ? `<div><div class="label">Utilisé dans</div><div class="group">${uses.map((e) => `
        <button class="nav-row" data-event="${e.id}"><span class="nav-body"><b>${esc(e.title)}</b><small>${kindLabel(e.kind)} · ${shortDate(e.date)}</small></span>${ICON.chevron}</button>`).join("")}</div></div>` : ""}
      <div>
        <div class="label">Historique</div>
        <div class="group history">${hist.map((h) => `<div><b>${esc(h.by)}</b> ${esc(h.action)} · ${ago(h.at)}</div>`).join("")}</div>
      </div>
      ${Object.values(c.files).some((f) => f?.locked) ? "" : `<button class="btn-row" data-act="delete">Supprimer le chapitre</button>`}
    </div>`);

  bd.querySelector("[data-act=back]").onclick = goBack;
  bd.querySelector("[data-act=edit]").onclick = () => openChapterEdit(c, { onCancel: () => openChapter(c.id, back, backLabel) });
  bd.querySelectorAll("[data-event]").forEach((b) => b.onclick = () => openDetail(b.dataset.event));
  const delBtn = bd.querySelector("[data-act=delete]"); if (delBtn) delBtn.onclick = async () => {
    const warn = uses.length ? ` Il sera retiré de ${uses.length} éval${uses.length > 1 ? "s" : ""} ou exercice${uses.length > 1 ? "s" : ""}.` : "";
    if (!confirm(`Supprimer « ${c.title} » et ses PDF pour toute la classe ?${warn}`)) return;
    try {
      await api(`chapters/${c.id}?by=${encodeURIComponent(getName())}`, { method: "DELETE" });
      state.chapters = state.chapters.filter((x) => x.id !== c.id);
      state.events = state.events.map((e) => ({ ...e, chapters: (e.chapters || []).filter((x) => x !== c.id) }));
      render(); toast("Chapitre supprimé");
      chaptersOf(c.subject).length ? openFolder(c.subject) : closeSheet();
    } catch (err) { toast(err.message); }
  };
  bd.querySelectorAll("[data-del]").forEach((b) => b.onclick = async () => {
    const slot = b.dataset.del;
    const label = SLOTS.find(([k]) => k === slot)[1];
    if (!confirm(`Supprimer « ${label} » de ce chapitre ?`)) return;
    try {
      upsertChapter(await api(`files/${encodeURIComponent(c.files[slot].key)}?chapter=${c.id}&slot=${slot}&by=${encodeURIComponent(getName())}`, { method: "DELETE" }));
      render(); openChapter(c.id, back, backLabel);
    } catch (err) { toast(err.message); }
  });
  bd.querySelectorAll("input[data-slot]").forEach((input) => input.onchange = async () => {
    const slot = input.dataset.slot;
    const holder = input.closest(".file, .upload");
    const status = (text) => {
      let s = holder.querySelector("[data-status]") || holder.querySelector(".m");
      if (s) s.innerHTML = `<span class="spinner"></span> ${esc(text)}`;
    };
    try {
      const { file, notes } = await preparePdf([...input.files], status);
      status("Envoi…");
      const saved = await uploadToSlot(c.id, slot, file, (p) => status(`Envoi · ${Math.round(p * 100)} %`));
      upsertChapter(saved); render();
      openChapter(c.id, back, backLabel);
      toast([`${SLOTS.find(([k]) => k === slot)[1]} ajouté${slot === "cours" ? "e" : ""}`, ...notes].join(" · "));
    } catch (err) { toast(err.message); openChapter(c.id, back, backLabel); }
  });
}

function openChapterEdit(ch, opts = {}) {
  const d = { subject: ch ? ch.subject : (opts.subject || ""), title: ch ? ch.title : "" };
  const bd = openSheet(`
    <div class="sheet-head">
      <button class="link" data-act="cancel">Annuler</button>
      <h3>${ch ? "Renommer le chapitre" : "Nouveau chapitre"}</h3>
      <button class="link bold" data-act="save">${ch ? "OK" : "Créer"}</button>
    </div>
    <div class="sheet-body">
      <div class="group">
        <input name="subject" placeholder="Matière" maxlength="60" list="subjectList" autocomplete="off" value="${esc(d.subject)}">
        <input name="title" placeholder="Chapitre (ex : Chapitre 4 – La TVA)" maxlength="120" value="${esc(d.title)}">
      </div>
      ${subjectDatalist()}
      ${ch ? "" : `<div class="label" style="margin-top:-8px">Tu ajouteras ensuite la fiche de cours, le sujet type et son corrigé.</div>`}
    </div>`);
  const field = (n) => bd.querySelector(`[name=${n}]`);
  bd.querySelector("[data-act=cancel]").onclick = () => (opts.onCancel ? opts.onCancel() : closeSheet());
  bd.querySelector("[data-act=save]").onclick = async (btn) => {
    const body = { subject: canonicalSubject(field("subject").value), title: field("title").value, by: getName() };
    if (!body.subject.trim()) return toast("Choisis la matière");
    if (!body.title.trim()) return toast("Donne un nom au chapitre");
    btn.target.innerHTML = `<span class="spinner"></span>`;
    try {
      const saved = await api(ch ? `chapters/${ch.id}` : "chapters", { method: ch ? "PUT" : "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      upsertChapter(saved); render();
      toast(ch ? "Chapitre renommé" : "Chapitre créé");
      if (opts.onDone) opts.onDone(saved);
      else openChapter(saved.id);
    } catch (err) { toast(err.message); btn.target.textContent = ch ? "OK" : "Créer"; }
  };
  (d.subject ? field("title") : field("subject")).focus();
}
