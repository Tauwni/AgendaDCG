// Agenda DCG — Annonce à la classe et questions sous les devoirs.
// Les fichiers de /js sont chargés dans l'ordre indiqué dans index.html et partagent les mêmes variables.
// (Fonctions ajoutées après le tag git « avant-questions-annonces ».)

/* ---------- Annonce à toute la classe ---------- */
let announce = null, announceAt = 0;
const announceSeen = () => { try { return localStorage.getItem("announce-seen") || ""; } catch { return ""; } };
function loadAnnounce(force) {
  if (!force && Date.now() - announceAt < 5 * 60000) return;
  announceAt = Date.now();
  api("announce").then((a) => { const changed = (a?.id || "") !== (announce?.id || ""); announce = a?.id ? a : null; if (changed && state.tab === "today") renderToday(); }).catch(() => {});
}
function announceBanner() {
  loadAnnounce();
  if (!announce || announceSeen() === announce.id) return "";
  return `<div class="section"><div class="group" style="padding:14px 16px;border-left:4px solid var(--accent)">
    <div style="display:flex;gap:10px;align-items:flex-start"><span style="font-size:20px">📣</span>
      <span style="flex:1"><b>Annonce</b><div style="margin-top:4px;line-height:1.4">${esc(announce.text)}</div><small style="color:var(--text2)">${esc(announce.by)} · ${ago(announce.at)}</small></span>
      <button class="link" data-announce-hide aria-label="Masquer l'annonce">OK</button></div></div></div>`;
}
const announceAdmin = () => !state.profile?.admin ? "" : `
    <div class="section"><h2>Annonce à la classe</h2>
      <div class="group" style="padding:12px 14px;display:flex;flex-direction:column;gap:8px">
        <textarea data-announce-text rows="3" maxlength="400" placeholder="Ex : le contrôle de vendredi est décalé à lundi" style="width:100%;border:0;background:transparent;resize:vertical;font:inherit;color:inherit;outline:none">${esc(announce?.text || "")}</textarea>
      </div>
      <div style="display:flex;gap:8px;margin-top:8px"><button class="btn-row blue" style="flex:1" data-announce-send>Publier</button>${announce ? `<button class="btn-row" style="flex:1" data-announce-clear>Retirer l'annonce</button>` : ""}</div>
      <p class="page-sub" style="margin-top:8px">Elle s'affiche en haut de l'accueil de tout le monde, avec une notification pour ceux qui les ont activées.</p></div>`;
document.addEventListener("click", async (e) => {
  if (e.target.closest("[data-announce-hide]")) { try { localStorage.setItem("announce-seen", announce?.id || ""); } catch {} renderToday(); return; }
  const send = e.target.closest("[data-announce-send]"), clear = e.target.closest("[data-announce-clear]");
  if (!send && !clear) return;
  const text = clear ? "" : document.querySelector("[data-announce-text]").value.trim();
  if (send && !text) { toast("Écris ton annonce"); return; }
  if (send && !confirm("Publier cette annonce pour toute la classe ?")) return;
  try {
    const a = await api("announce", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ text }) });
    announce = a?.id ? a : null; announceAt = Date.now();
    toast(announce ? "Annonce publiée" : "Annonce retirée"); renderSettings();
  } catch (err) { toast(err.message); }
});

/* ---------- Questions sous un devoir ---------- */
function commentsBlock(e) {
  const list = e.comments || [], me = state.profile?.name;
  return `<div>
    <div class="label">Questions${list.length ? ` · ${list.length}` : ""}</div>
    <div class="group">
      ${list.map((c) => `<div class="set-row" style="align-items:flex-start"><span style="flex:1;min-width:0"><b>${esc(c.by)}</b> <small style="color:var(--text2)">${ago(c.at)}</small><div style="margin-top:2px;line-height:1.4;overflow-wrap:anywhere">${esc(c.text)}</div></span>${c.by === me || state.profile?.admin ? `<button class="link" data-comment-del="${c.id}" data-event-id="${e.id}" aria-label="Supprimer mon message">Suppr.</button>` : ""}</div>`).join("") || `<div class="hint">Une question sur ce devoir ? Pose-la ici, toute la classe la verra.</div>`}
      <div style="display:flex;gap:8px;padding:8px 12px;border-top:.5px solid var(--line)"><input data-comment-text maxlength="500" placeholder="Écrire une question ou une réponse…" style="flex:1;min-width:0;border:0;background:transparent;font:inherit;color:inherit;outline:none"><button class="link" data-comment-send="${e.id}"><b>Envoyer</b></button></div>
    </div></div>`;
}
async function sendComment(eventId) {
  const input = document.querySelector("[data-comment-text]"), text = input?.value.trim();
  if (!text) return;
  try { const ev = await api(`events/${eventId}/comments`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text }) }); upsert(ev); openDetail(ev.id); }
  catch (err) { toast(err.message); }
}
document.addEventListener("click", async (e) => {
  const s = e.target.closest("[data-comment-send]");
  if (s) return sendComment(s.dataset.commentSend);
  const d = e.target.closest("[data-comment-del]");
  if (!d || !confirm("Supprimer ce message ?")) return;
  try { const ev = await api(`events/${d.dataset.eventId}/comments/${d.dataset.commentDel}`, { method: "DELETE" }); upsert(ev); openDetail(ev.id); }
  catch (err) { toast(err.message); }
});
document.addEventListener("keydown", (e) => { if (e.key === "Enter" && e.target.matches?.("[data-comment-text]")) { const b = document.querySelector("[data-comment-send]"); if (b) sendComment(b.dataset.commentSend); } });
