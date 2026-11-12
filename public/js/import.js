// Agenda DCG — Import d'un dossier entier de cours (réservé au compte administrateur).
// Les fichiers de /js sont chargés dans l'ordre indiqué dans index.html et partagent les mêmes variables.
//
// Dossier attendu : DCG / matière / chapitre / fiche, sujet, corrigé, exercice du prof (PDF).
// Rien n'est jamais remplacé : un PDF déjà en ligne (même contenu) ou un emplacement déjà occupé est ignoré.

const IMPORT_SLOTS = [["cours", "Fiche de cours"], ["sujet", "Sujet"], ["corrige", "Corrigé"], ["topexo", "Exercice du prof (TOP EXO)"], ["", "Ignorer"]];

function guessSlot(name) {
  const n = norm(name);
  if (/corrig|correction/.test(n)) return "corrige";
  if (/sujet|annale|examen|epreuve/.test(n)) return "sujet";
  if (/exo|exercice|\btd\b|top|application|entrainement/.test(n)) return "topexo";
  if (/fiche|cours|synthese|resume|lecon/.test(n)) return "cours";
  return "";
}
function guessSubject(folder) {
  const n = norm(folder), ue = n.match(/ue\s*(\d+)/);
  const all = allSubjects();
  if (ue) { const hit = all.find((s) => norm(s).match(/ue\s*(\d+)/)?.[1] === ue[1]); if (hit) return hit; }
  let best = null, score = 0;
  for (const s of all) {
    const words = norm(s.split(" · ").pop()).split(/[^a-z0-9]+/).filter((w) => w.length > 3);
    const sc = words.filter((w) => n.includes(w) || n.includes(w.slice(0, 5))).length;
    if (sc > score) { score = sc; best = s; }
  }
  return best || folder;
}
const chapterNumber = (t) => norm(t).match(/(?:chapitres?|chap|ch)\.?\s*(\d+)/)?.[1] || null;
function guessChapter(subject, folder) {
  const list = chaptersOf(subject), n = norm(folder), num = chapterNumber(folder);
  return list.find((c) => norm(c.title) === n)
    || (num && list.find((c) => chapterNumber(c.title) === num && !/\d+\s*(a|-|–)\s*\d+/.test(norm(c.title))))
    || list.find((c) => norm(c.title).includes(n) || n.includes(norm(c.title)))
    || null;
}
async function fileHash(file) {
  const buf = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function pickImportFolder() {
  const input = document.createElement("input");
  input.type = "file"; input.multiple = true; input.webkitdirectory = true;
  input.onchange = () => {
    const pdfs = [...input.files].filter((f) => /\.pdf$/i.test(f.name) && !f.name.startsWith("."));
    if (!pdfs.length) { toast("Aucun PDF dans ce dossier"); return; }
    openImport(pdfs);
  };
  input.click();
}

function openImport(pdfs) {
  // Un groupe = un dossier de chapitre (le dossier qui contient le PDF) ; la matière = le dossier au-dessus.
  const groups = new Map();
  for (const f of pdfs) {
    const parts = (f.webkitRelativePath || f.name).split("/");
    const chapterFolder = parts.length >= 2 ? parts[parts.length - 2] : f.name.replace(/\.pdf$/i, "");
    const subjectFolder = parts.length >= 3 ? parts[parts.length - 3] : chapterFolder;
    const id = parts.slice(0, -1).join("/");
    if (!groups.has(id)) {
      const subject = guessSubject(subjectFolder);
      groups.set(id, { id, folder: chapterFolder, subject, chapter: guessChapter(subject, chapterFolder)?.id || "", files: [] });
    }
    groups.get(id).files.push({ file: f, slot: guessSlot(f.name), status: "" });
  }
  const list = [...groups.values()].sort((a, b) => a.id.localeCompare(b.id, "fr", { numeric: true }));
  const subjects = () => [...new Set([...allSubjects(), ...list.map((g) => g.subject)])];

  const draw = () => {
    const total = list.reduce((n, g) => n + g.files.filter((f) => f.slot).length, 0);
    const bd = openSheet(`
      <div class="sheet-head"><button class="link" data-act="close">Annuler</button><h3>Importer un dossier</h3><button class="link" data-act="go"><b>Importer</b></button></div>
      <div class="sheet-body">
        <div class="detail-sub">${plural(pdfs.length, "PDF")} trouvé${pdfs.length > 1 ? "s" : ""} dans ${plural(list.length, "dossier")}. Vérifie le rangement proposé, corrige si besoin, puis touche Importer. Les PDF déjà en ligne sont ignorés et rien n'est remplacé.</div>
        ${list.map((g, gi) => `
          <div class="label">${esc(g.folder)}</div>
          <div class="group" style="padding:10px 14px;display:flex;flex-direction:column;gap:8px">
            <select class="search" data-g="${gi}" data-f="subject">${subjects().map((s) => `<option${s === g.subject ? " selected" : ""}>${esc(s)}</option>`).join("")}</select>
            <select class="search" data-g="${gi}" data-f="chapter"><option value="">Nouveau chapitre : ${esc(g.folder)}</option>${chaptersOf(g.subject).map((c) => `<option value="${c.id}"${c.id === g.chapter ? " selected" : ""}>Chapitre existant : ${esc(c.title)}</option>`).join("")}</select>
            ${g.files.map((f, fi) => `<div style="display:flex;gap:8px;align-items:center"><span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:14px">${esc(f.file.name)}${f.status ? `<br><small style="color:var(--text2)">${esc(f.status)}</small>` : ""}</span>
              <select data-g="${gi}" data-file="${fi}" style="max-width:48%">${IMPORT_SLOTS.map(([k, l]) => `<option value="${k}"${k === f.slot ? " selected" : ""}>${l}</option>`).join("")}</select></div>`).join("")}
          </div>`).join("")}
        <div class="detail-sub" data-progress>${total} PDF à ranger. Ceux marqués « Ignorer » ne seront pas envoyés.</div>
      </div>`);
    bd.querySelector("[data-act=close]").onclick = () => closeSheet();
    bd.querySelectorAll("select[data-f=subject]").forEach((s) => s.onchange = () => { const g = list[s.dataset.g]; g.subject = s.value; g.chapter = guessChapter(g.subject, g.folder)?.id || ""; draw(); });
    bd.querySelectorAll("select[data-f=chapter]").forEach((s) => s.onchange = () => { list[s.dataset.g].chapter = s.value; });
    bd.querySelectorAll("select[data-file]").forEach((s) => s.onchange = () => { list[s.dataset.g].files[s.dataset.file].slot = s.value; });
    bd.querySelector("[data-act=go]").onclick = () => run(bd);
  };

  const run = async (bd) => {
    const go = bd.querySelector("[data-act=go]"), progress = bd.querySelector("[data-progress]");
    go.disabled = true; bd.querySelectorAll("select").forEach((s) => s.disabled = true);
    const known = new Set(state.chapters.flatMap((c) => Object.values(c.files || {}).filter(Boolean).map((f) => f.hash).filter(Boolean)));
    const count = { added: 0, same: 0, busy: 0, ignored: 0, failed: 0 };
    const todo = list.reduce((n, g) => n + g.files.length, 0); let done = 0;
    for (const g of list) {
      let ch = g.chapter ? state.chapters.find((c) => c.id === g.chapter) : null;
      for (const f of g.files) {
        progress.textContent = `Import ${++done}/${todo} : ${f.file.name}…`;
        try {
          if (!f.slot) { f.status = "Ignoré"; count.ignored++; continue; }
          const hash = await fileHash(f.file);
          if (known.has(hash)) { f.status = "Déjà en ligne : ignoré"; count.same++; continue; }
          if (ch?.files?.[f.slot]) { f.status = "Emplacement déjà occupé : ignoré"; count.busy++; continue; }
          if (!ch) { // le chapitre n'est créé que s'il y a vraiment un PDF à y mettre
            ch = await api("chapters", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ subject: g.subject, title: g.folder }) });
            upsertChapter(ch); g.chapter = ch.id;
          }
          const { file } = await preparePdf([f.file], () => {});
          ch = await uploadToSlot(ch.id, f.slot, file, (p) => { progress.textContent = `Import ${done}/${todo} : ${f.file.name} (${Math.round(p * 100)} %)`; }, hash);
          upsertChapter(ch); known.add(hash);
          f.status = "Ajouté ✓"; count.added++;
        } catch (err) { f.status = "Échec : " + err.message; count.failed++; }
      }
    }
    render();
    draw();
    const bd2 = document.querySelector("#sheetRoot .sheet-body") || document.body;
    const out = bd2.querySelector("[data-progress]");
    if (out) out.innerHTML = `<b>Import terminé.</b> ${count.added} ajouté${count.added > 1 ? "s" : ""} · ${count.same} déjà en ligne · ${count.busy} emplacement${count.busy > 1 ? "s" : ""} déjà occupé${count.busy > 1 ? "s" : ""} · ${count.ignored} ignoré${count.ignored > 1 ? "s" : ""}${count.failed ? ` · ${count.failed} en échec` : ""}`;
    const again = document.querySelector("#sheetRoot [data-act=go]"); if (again) again.remove();
    const close = document.querySelector("#sheetRoot [data-act=close]"); if (close) close.textContent = "Fermer";
    toast(`Import terminé : ${count.added} PDF ajouté${count.added > 1 ? "s" : ""}`);
  };
  draw();
}
