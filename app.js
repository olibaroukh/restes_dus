/* Restes dus des franchisés — Optical Center.
 * Code public (aucune donnée ni clé ici). Les données sont dans le Worker suivi-stats-api (Cloudflare),
 * accessibles seulement après connexion Zimbra. Même session que Suivi Stats (olibaroukh.github.io).
 * L'extraction Cosium est lue sur l'ordinateur : seuls les dossiers à justifier sont envoyés,
 * sans n° de Sécurité sociale. */
(function () {
  'use strict';

  // ---------- Lecture de l'extraction Cosium « Liste des règlements » ----------
  const JOURS_MIN = 45, JOURS_MAX = 365;
  function lignesCSV(texte) {
    const out = []; let ligne = [], champ = '', guil = false;
    texte = texte.replace(/^\uFEFF/, '');
    for (let i = 0; i < texte.length; i++) {
      const c = texte[i];
      if (guil) {
        if (c === '"') { if (texte[i + 1] === '"') { champ += '"'; i++; } else guil = false; }
        else champ += c;
      } else if (c === '"') guil = true;
      else if (c === ';') { ligne.push(champ); champ = ''; }
      else if (c === '\n' || c === '\r') { if (c === '\r' && texte[i + 1] === '\n') i++; ligne.push(champ); out.push(ligne); ligne = []; champ = ''; }
      else champ += c;
    }
    if (champ || ligne.length) { ligne.push(champ); out.push(ligne); }
    return out;
  }
  const dateISO = s => { const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(s || '').trim()); return m ? `${m[3]}-${m[2]}-${m[1]}` : ''; };
  const montant = s => { const v = parseFloat(String(s || '').replace(/[\s\u00a0]/g, '').replace(',', '.')); return isFinite(v) ? v : 0; };
  const jours = (a, b) => Math.round((Date.parse(a) - Date.parse(b)) / 86400000);
  const codeNorm = c => String(c == null ? '' : c).trim().replace(/^0+(?=\d)/, '');

  function lireExtraction(texte) {
    const L = lignesCSV(texte);
    let dateEdition = '';
    for (const l of L.slice(0, 5)) { const m = /Date Edition\s*:\s*(\d{2}\/\d{2}\/\d{4})/i.exec(l.join(' ')); if (m) { dateEdition = dateISO(m[1]); break; } }
    const iEnt = L.findIndex(l => l[0] && /^N° facture$/i.test(l[0].trim()));
    if (iEnt < 0) throw new Error('Ce fichier ne ressemble pas à l’extraction « Liste des règlements » (en-tête « N° facture » introuvable).');
    if (!dateEdition) throw new Error('Date d’édition introuvable en haut du fichier.');
    const ent = L[iEnt].map(x => x.trim()), col = n => ent.indexOf(n);
    const C = { fact: col('N° facture'), date: col('Date'), centre: col('Centre'), client: col('Client'), tp: col('TP'), type: col('Type'), mt: col('Montant'), ncli: col('N° client'), vend: col('RefVendeur') };
    for (const [k, v] of Object.entries(C)) if (v < 0 && k !== 'vend' && k !== 'ncli') throw new Error('Colonne manquante dans le fichier : ' + k);
    const lignes = [];
    for (const l of L.slice(iEnt + 1)) {
      if (!l || l.length < 5) continue;
      const type = (l[C.type] || '').trim();
      if (type === 'TOTAL') break;                       // récapitulatif en fin de fichier
      const centre = (l[C.centre] || '').trim(), date = dateISO(l[C.date]);
      if (!centre || !date) continue;
      lignes.push({ centre: codeNorm(centre), facture: (l[C.fact] || '').trim(), date, client: (l[C.client] || '').trim(), organisme: (l[C.tp] || '').trim(),
        type, montant: montant(l[C.mt]), ncli: C.ncli >= 0 ? (l[C.ncli] || '').trim() : '', vendeur: C.vend >= 0 ? (l[C.vend] || '').trim() : '' });
    }
    const centres = [...new Set(lignes.map(x => x.centre))];
    const parCentre = {};
    for (const c of centres) {
      const ls = lignes.filter(x => x.centre === c);
      const retenues = ls.filter(x => { const a = jours(dateEdition, x.date); return a > JOURS_MIN && a <= JOURS_MAX; });
      const dossiers = new Map();
      for (const x of retenues) {
        const f = (/F\d+/.exec(x.facture) || /D\d+/.exec(x.facture) || [x.facture.replace(/<[^>]*>/g, ' ').trim()])[0];
        const cle = f ? 'F:' + f : `C:${x.ncli || x.client}:${x.date}`;
        if (!dossiers.has(cle)) dossiers.set(cle, { cle, facture: f, client: x.client, lignes: [] });
        dossiers.get(cle).lignes.push({ date: x.date, type: x.type, organisme: x.organisme, montant: x.montant, vendeur: x.vendeur });
      }
      parCentre[c] = {
        dossiers: [...dossiers.values()].sort((a, b) => a.lignes[0].date.localeCompare(b.lignes[0].date)),
        nbLignes: ls.length, nbRetenues: retenues.length,
        recents: ls.filter(x => jours(dateEdition, x.date) <= JOURS_MIN).length,
        anciens: ls.filter(x => jours(dateEdition, x.date) > JOURS_MAX).length,
      };
    }
    return { dateEdition, centres, parCentre };
  }
  if (typeof module !== 'undefined') { module.exports = { lireExtraction }; return; }

  // ---------- Appli ----------
  const VERSION_CODE = '2026.11.17-2';   // à incrémenter avec version.json à chaque modification
  const API = 'https://suivi-stats-api.oli-baroukh.workers.dev';
  const CLE_SESSION = 'suiviStatsSession';
  const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const norm = s => String(s == null ? '' : s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
  const eur = v => (v || 0).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
  const dateFr = s => { if (!s) return ''; const [a, m, j] = String(s).slice(0, 10).split('-'); return j ? `${j}/${m}/${a}` : s; };
  const auj = () => new Date().toISOString().slice(0, 10);
  const totalDossier = d => d.lignes.reduce((a, l) => a + l.montant, 0);
  const etatJustif = j => !j || !j.motif ? 'afaire' : (j.dateAction && j.dateAction < auj() ? 'expire' : 'justifie');

  let session = null;
  try { const x = JSON.parse(localStorage.getItem(CLE_SESSION) || 'null'); if (x && x.jeton) session = x; } catch (e) {}
  const S = { moi: null, motifs: [], magasins: [], code: null, donnees: null, suivi: null, comptes: null };

  async function appel(chemin, opts) {
    if (!session) throw new Error('Connexion requise');
    const r = await fetch(API + chemin, { ...(opts || {}), headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + session.jeton } });
    const d = await r.json().catch(() => ({}));
    if (r.status === 401) { afficherConnexion('Session expirée : reconnectez-vous.'); throw new Error('Session expirée'); }
    if (!r.ok || d.ok === false) throw new Error(d.erreur || ('Erreur ' + r.status));
    return d;
  }

  // ---------- Connexion ----------
  function afficherConnexion(msg) {
    $('#ecran-connexion').hidden = false; $('#principal').hidden = true; $('#onglets').hidden = true; $('#lien-deconnexion').hidden = true;
    if (session && session.profil) $('#cx-user').value = session.profil.email;
    $('#cx-info').textContent = msg || '';
  }
  async function connecter() {
    $('#cx-info').textContent = 'Connexion…';
    try {
      const r = await fetch(API + '/auth/connexion', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifiant: $('#cx-user').value.trim(), motDePasse: $('#cx-pass').value }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d.ok) throw new Error(d.erreur || 'Connexion impossible');
      session = { jeton: d.session, expire: Date.now() + d.expireDansMs - 60000, debut: Date.now(), profil: d.profil };
      localStorage.setItem(CLE_SESSION, JSON.stringify(session));
      $('#cx-pass').value = '';
      await demarrer();
    } catch (e) { $('#cx-info').textContent = e.message; }
  }
  async function demarrer() {
    try {
      const d = await appel('/restes-dus/moi');
      S.moi = d.moi; S.motifs = d.motifs; S.magasins = d.magasins;
    } catch (e) { return afficherConnexion(e.message === 'Session expirée' ? 'Session expirée : reconnectez-vous.' : e.message); }
    $('#ecran-connexion').hidden = true; $('#principal').hidden = false; $('#onglets').hidden = false; $('#lien-deconnexion').hidden = false;
    $('#qui').textContent = (S.moi.nom || S.moi.email) + (S.moi.admin ? ' · administrateur' : '');
    $$('.admin-seul').forEach(b => b.hidden = !S.moi.admin);
    $('#onglets [data-vue=magasin]').textContent = S.moi.admin ? 'Magasins' : 'Mes restes dus';
    const sel = $('#mg-choix');
    sel.innerHTML = (S.moi.admin ? '<option value="">— Choisir un magasin —</option>' : '') + S.magasins.map(m => `<option value="${esc(m.code)}">${esc(m.magasin || m.code)} (${esc(m.code)})${S.moi.admin ? ' · ' + esc(m.groupe) : ''}</option>`).join('');
    sel.hidden = S.magasins.length < 2 && !S.moi.admin;
    if (!S.magasins.length) { $('#mg-dossiers').innerHTML = '<p class="muted">Aucun magasin n’est rattaché à votre compte. Contactez Olivier Baroukh.</p>'; $('#depot').hidden = true; }
    if (S.moi.admin) vue('suivi'); else if (S.magasins.length) choisirMagasin(S.magasins[0].code);
  }

  function vue(v) {
    $$('#onglets button').forEach(b => b.classList.toggle('actif', b.dataset.vue === v));
    $$('.vue').forEach(s => s.classList.toggle('actif', s.id === 'vue-' + v));
    if (v === 'suivi') chargerSuivi();
    if (v === 'comptes') chargerComptes();
  }

  // ---------- Magasin ----------
  async function choisirMagasin(code) {
    S.code = code || null; $('#mg-choix').value = code || '';
    const m = S.magasins.find(x => x.code === code);
    $('#mg-titre').textContent = m ? `Restes dus – ${m.magasin || m.code}` : 'Restes dus';
    $('#depot').hidden = !code; $('#depot-info').textContent = '';
    if (!code) { $('#mg-resume').innerHTML = ''; $('#mg-dossiers').innerHTML = ''; $('#mg-filtres').hidden = true; return; }
    $('#mg-dossiers').innerHTML = '<p class="muted">Chargement…</p>';
    try { S.donnees = await appel('/restes-dus/magasin?code=' + encodeURIComponent(code)); rendreMagasin(); }
    catch (e) { $('#mg-dossiers').innerHTML = `<p class="ko">${esc(e.message)}</p>`; }
  }

  function rendreMagasin() {
    const d = S.donnees, dep = d.depot;
    if (!dep) {
      $('#mg-resume').innerHTML = ''; $('#mg-filtres').hidden = true;
      $('#mg-dossiers').innerHTML = '<p class="muted">Aucune extraction déposée pour l’instant.</p>';
      return;
    }
    const ds = dep.dossiers, etat = c => etatJustif(d.justifs[c.cle]);
    const nbJ = ds.filter(x => etat(x) === 'justifie').length, tot = ds.reduce((a, x) => a + totalDossier(x), 0);
    const totNJ = ds.filter(x => etat(x) !== 'justifie').reduce((a, x) => a + totalDossier(x), 0);
    $('#mg-resume').innerHTML = `
      <div class="vignette"><span>Extraction du</span><b>${dateFr(dep.dateEdition)}</b><span class="petit">déposée le ${dateFr(dep.le)}</span></div>
      <div class="vignette"><span>Dossiers à justifier</span><b>${ds.length}</b><span class="petit">${eur(tot)}</span></div>
      <div class="vignette ${nbJ === ds.length ? 'ok' : 'ko'}"><span>Justifiés</span><b>${nbJ} / ${ds.length}</b><span class="petit">reste ${eur(totNJ)}</span></div>`;
    $('#mg-filtres').hidden = !ds.length;
    const q = norm($('#mg-q').value), afaire = $('#mg-afaire').checked;
    const liste = ds.filter(x => (!afaire || etat(x) !== 'justifie') && (!q || norm([x.facture, x.client, ...x.lignes.map(l => l.organisme + ' ' + l.type)].join(' ')).includes(q)));
    if (!ds.length) { $('#mg-dossiers').innerHTML = '<p class="ok">Aucun dossier à justifier dans cette extraction. 👍</p>'; return; }
    if (!liste.length) { $('#mg-dossiers').innerHTML = `<p class="ok">${afaire ? 'Tous les dossiers sont justifiés. 👍' : 'Aucun dossier ne correspond à la recherche.'}</p>`; return; }
    const opts = j => '<option value="">— Motif —</option>' + S.motifs.map(m => `<option${j && j.motif === m ? ' selected' : ''}>${esc(m)}</option>`).join('');
    $('#mg-dossiers').innerHTML = liste.map(x => {
      const j = d.justifs[x.cle] || {}, e = etat(x);
      const lib = e === 'justifie' ? `<span class="etat ok">✓ Justifié${j.majLe ? ' le ' + dateFr(j.majLe) : ''}</span>` : e === 'expire' ? '<span class="etat attention">Date d’action dépassée : mettez à jour la justification</span>' : '<span class="etat ko">À justifier</span>';
      return `<div class="dossier ${e}" data-cle="${esc(x.cle)}">
        <div>
          <div class="tete"><span>${esc(x.facture || 'Sans n° de facture')} · ${esc(x.client)}</span><span class="montant">${eur(totalDossier(x))}</span></div>
          <table>${x.lignes.map(l => `<tr><td>${dateFr(l.date)}</td><td>${esc(l.type)}</td><td>${esc(l.organisme)}</td><td class="num">${eur(l.montant)}</td></tr>`).join('')}</table>
        </div>
        <div class="saisie">
          <select class="j-motif">${opts(j)}</select>
          <input type="date" class="j-date" value="${esc(j.dateAction || '')}" title="Date d’action prévue">
          <textarea class="j-com" placeholder="Commentaire (facultatif)" maxlength="1000">${esc(j.commentaire || '')}</textarea>
          <div class="etat-l">${lib}</div>
        </div></div>`;
    }).join('');
    $$('#mg-dossiers .dossier').forEach(el => {
      const env = () => enregistrer(el);
      el.querySelector('.j-motif').onchange = env; el.querySelector('.j-date').onchange = env; el.querySelector('.j-com').onchange = env;
    });
  }

  async function enregistrer(el) {
    const cle = el.dataset.cle, motif = el.querySelector('.j-motif').value, dateAction = el.querySelector('.j-date').value, commentaire = el.querySelector('.j-com').value.trim();
    const zone = el.querySelector('.etat-l'); zone.innerHTML = '<span class="etat muted">Enregistrement…</span>';
    try {
      const r = await appel('/restes-dus/justif', { method: 'PUT', body: JSON.stringify({ code: S.code, cle, motif, dateAction, commentaire }) });
      S.donnees.justifs[cle] = { motif, dateAction, commentaire, majLe: r.majLe, par: r.par };
      const e = etatJustif(S.donnees.justifs[cle]);
      el.className = 'dossier ' + e;
      zone.innerHTML = e === 'justifie' ? '<span class="etat ok">✓ Enregistré</span>' : e === 'expire' ? '<span class="etat attention">Enregistré, mais la date d’action est dépassée</span>' : '<span class="etat ko">Enregistré – choisissez un motif</span>';
      // Résumé mis à jour sans faire disparaître la ligne en cours de saisie
      const ds = S.donnees.depot.dossiers, nbJ = ds.filter(x => etatJustif(S.donnees.justifs[x.cle]) === 'justifie').length;
      const v = $$('#mg-resume .vignette')[2];
      if (v) { v.className = 'vignette ' + (nbJ === ds.length ? 'ok' : 'ko'); v.querySelector('b').textContent = `${nbJ} / ${ds.length}`;
        v.querySelector('.petit').textContent = 'reste ' + eur(ds.filter(x => etatJustif(S.donnees.justifs[x.cle]) !== 'justifie').reduce((a, x) => a + totalDossier(x), 0)); }
    } catch (e) { zone.innerHTML = `<span class="etat ko">Non enregistré : ${esc(e.message)}</span>`; }
  }

  async function deposer(fichier) {
    const info = $('#depot-info');
    if (!fichier) return;
    info.className = 'petit'; info.textContent = 'Lecture du fichier…';
    try {
      const ex = lireExtraction(await fichier.text());
      if (!ex.centres.length) throw new Error('Aucune ligne de règlement dans ce fichier.');
      if (ex.centres.length > 1) throw new Error('Le fichier contient plusieurs centres (' + ex.centres.join(', ') + ') : déposez une extraction par magasin.');
      const centre = ex.centres[0], p = ex.parCentre[centre];
      if (centre !== S.code) {
        const autre = S.magasins.find(m => m.code === centre);
        if (!autre) throw new Error(`Ce fichier concerne le centre ${centre}, qui ne fait pas partie de vos magasins.`);
        if (!confirm(`Ce fichier concerne ${autre.magasin || centre} (${centre}). Le déposer pour ce magasin ?`)) { info.textContent = ''; return; }
      }
      let r;
      try { r = await appel('/restes-dus/depot', { method: 'POST', body: JSON.stringify({ code: centre, dateEdition: ex.dateEdition, nbLignes: p.nbLignes, dossiers: p.dossiers }) }); }
      catch (e) {
        if (!/plus récente/.test(e.message) || !confirm(e.message + ' Remplacer quand même par ce fichier plus ancien ?')) throw e;
        r = await appel('/restes-dus/depot', { method: 'POST', body: JSON.stringify({ code: centre, dateEdition: ex.dateEdition, nbLignes: p.nbLignes, dossiers: p.dossiers, forcer: true }) });
      }
      await choisirMagasin(centre);
      info.className = 'petit ok';
      info.textContent = `Extraction du ${dateFr(ex.dateEdition)} enregistrée : ${p.nbLignes} lignes lues, ${p.nbRetenues} à justifier (${r.dossiers} dossiers) · ${p.recents} de moins de ${JOURS_MIN} jours et ${p.anciens} de plus d’un an non demandées`
        + (r.regles ? ` · ${r.regles} dossier(s) justifié(s) précédemment ne figurent plus dans l’extraction (réglés).` : '.');
    } catch (e) { info.className = 'petit ko'; info.textContent = e.message; }
  }

  // ---------- Suivi (administrateurs) ----------
  let triSuivi = { k: 'nonJustifie', sens: -1 };
  async function chargerSuivi() {
    $('#sv-table').innerHTML = '<tr><td class="muted">Chargement…</td></tr>';
    try {
      const [s, c] = await Promise.all([appel('/restes-dus/suivi'), appel('/restes-dus/comptes')]);
      S.suivi = s.suivi; S.comptes = c.comptes; rendreSuivi();
    } catch (e) { $('#sv-table').innerHTML = `<tr><td class="ko">${esc(e.message)}</td></tr>`; }
  }
  function rendreSuivi() {
    const parCode = new Map(S.suivi.map(x => [x.code, x]));
    // Magasins rattachés à un compte mais sans dépôt
    for (const c of S.comptes || []) for (const code of c.codes) if (!parCode.has(code)) {
      const m = S.magasins.find(x => x.code === code) || { code };
      parCode.set(code, { ...m, nb: null, montant: null, nbJustifies: null, montantJustifie: null });
    }
    const lignes = [...parCode.values()].map(x => ({ ...x, nonJustifie: x.montant == null ? -1 : x.montant - x.montantJustifie, pct: x.nb ? x.nbJustifies / x.nb : (x.nb === 0 ? 1 : -1) }));
    const T = lignes.filter(x => x.nb != null), tot = T.reduce((a, x) => a + x.montant, 0), totJ = T.reduce((a, x) => a + x.montantJustifie, 0);
    $('#sv-resume').innerHTML = `
      <div class="vignette"><span>Magasins avec dépôt</span><b>${T.length} / ${lignes.length}</b></div>
      <div class="vignette"><span>Dossiers</span><b>${T.reduce((a, x) => a + x.nb, 0)}</b><span class="petit">${eur(tot)}</span></div>
      <div class="vignette ${totJ >= tot ? 'ok' : 'ko'}"><span>Justifiés</span><b>${T.reduce((a, x) => a + x.nbJustifies, 0)}</b><span class="petit">${eur(totJ)} · reste ${eur(tot - totJ)}</span></div>`;
    const k = triSuivi.k, s = triSuivi.sens;
    lignes.sort((a, b) => { const va = a[k], vb = b[k]; return (typeof va === 'number' && typeof vb === 'number' ? va - vb : String(va || '').localeCompare(String(vb || ''))) * s; });
    const th = (cle, lib, num) => `<th data-k="${cle}" class="${num ? 'num' : ''}">${lib}${k === cle ? (s > 0 ? ' ▲' : ' ▼') : ''}</th>`;
    $('#sv-table').innerHTML = `<thead><tr>${th('magasin', 'Magasin')}${th('groupe', 'Franchisé')}${th('dateEdition', 'Extraction du')}${th('le', 'Déposée le')}${th('nb', 'Dossiers', 1)}${th('montant', 'Montant', 1)}${th('pct', 'Justifiés', 1)}${th('nonJustifie', 'Non justifié', 1)}<th>Principaux motifs</th></tr></thead><tbody>` +
      lignes.map(x => x.nb == null
        ? `<tr class="cliquable" data-code="${esc(x.code)}"><td>${esc(x.magasin || '')} <span class="muted">${esc(x.code)}</span></td><td>${esc(x.groupe || '')}</td><td colspan="7" class="muted">Aucun dépôt</td></tr>`
        : `<tr class="cliquable" data-code="${esc(x.code)}"><td>${esc(x.magasin)} <span class="muted">${esc(x.code)}</span></td><td>${esc(x.groupe)}</td><td>${dateFr(x.dateEdition)}</td><td>${dateFr(x.le)}</td>
          <td class="num">${x.nb}</td><td class="num">${eur(x.montant)}</td>
          <td class="num">${x.nbJustifies} / ${x.nb}<div class="barre"><i style="width:${Math.round((x.nb ? x.nbJustifies / x.nb : 1) * 100)}%"></i></div></td>
          <td class="num ${x.nonJustifie > 0 ? 'ko' : 'ok'}">${eur(x.nonJustifie)}</td>
          <td class="petit">${Object.entries(x.parMotif || {}).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([m, v]) => `${esc(m)} (${eur(v)})`).join('<br>')}</td></tr>`).join('') + '</tbody>';
    $$('#sv-table th[data-k]').forEach(t => t.onclick = () => { triSuivi = { k: t.dataset.k, sens: triSuivi.k === t.dataset.k ? -triSuivi.sens : 1 }; rendreSuivi(); });
    $$('#sv-table tr.cliquable').forEach(t => t.onclick = () => { vue('magasin'); choisirMagasin(t.dataset.code); });
  }

  // ---------- Comptes (administrateurs) ----------
  let choixCodes = new Set(), emailEdite = null;
  async function chargerComptes() {
    try { S.comptes = (await appel('/restes-dus/comptes')).comptes; rendreComptes(); } catch (e) { $('#cp-info').textContent = e.message; }
  }
  function rendreChoixMagasins() {
    const q = norm($('#cp-q').value);
    const liste = S.magasins.filter(m => choixCodes.has(m.code) || !q || norm(m.code + ' ' + m.magasin + ' ' + m.groupe).includes(q)).slice(0, 300);
    $('#cp-magasins').innerHTML = liste.map(m => `<label><input type="checkbox" value="${esc(m.code)}"${choixCodes.has(m.code) ? ' checked' : ''}> ${esc(m.magasin)} <span class="muted">${esc(m.code)} · ${esc(m.groupe)}</span></label>`).join('') || '<p class="muted petit">Aucun magasin.</p>';
    $$('#cp-magasins input').forEach(c => c.onchange = () => { c.checked ? choixCodes.add(c.value) : choixCodes.delete(c.value); });
  }
  function rendreComptes() {
    rendreChoixMagasins();
    const nomMag = c => (S.magasins.find(m => m.code === c) || {}).magasin || c;
    $('#cp-table').innerHTML = '<thead><tr><th>Adresse</th><th>Nom</th><th>Magasins</th><th>Actif</th><th></th></tr></thead><tbody>' +
      (S.comptes || []).map(c => `<tr><td>${esc(c.email)}</td><td>${esc(c.nom || '')}</td><td class="petit">${c.codes.map(x => esc(nomMag(x)) + ' <span class="muted">' + esc(x) + '</span>').join('<br>')}</td>
        <td>${c.actif ? '✓' : '<span class="ko">non</span>'}</td>
        <td><button data-e="${esc(c.email)}" class="cp-mod">Modifier</button> <button data-e="${esc(c.email)}" class="cp-act">${c.actif ? 'Désactiver' : 'Réactiver'}</button> <button data-e="${esc(c.email)}" class="cp-sup">Supprimer</button></td></tr>`).join('') + '</tbody>';
    $$('.cp-mod').forEach(b => b.onclick = () => { const c = S.comptes.find(x => x.email === b.dataset.e); emailEdite = c.email; $('#cp-email').value = c.email; $('#cp-nom').value = c.nom || ''; choixCodes = new Set(c.codes); $('#cp-q').value = ''; rendreChoixMagasins(); $('#cp-info').textContent = 'Modification de ' + c.email; window.scrollTo(0, 0); });
    $$('.cp-act').forEach(b => b.onclick = async () => { const c = S.comptes.find(x => x.email === b.dataset.e); try { await appel('/restes-dus/comptes', { method: 'PUT', body: JSON.stringify({ ...c, actif: !c.actif }) }); chargerComptes(); } catch (e) { $('#cp-info').textContent = e.message; } });
    $$('.cp-sup').forEach(b => b.onclick = async () => { if (!confirm('Supprimer le compte ' + b.dataset.e + ' ? Les justifications déjà saisies sont conservées.')) return; try { await appel('/restes-dus/comptes/supprimer', { method: 'POST', body: JSON.stringify({ email: b.dataset.e }) }); chargerComptes(); } catch (e) { $('#cp-info').textContent = e.message; } });
  }
  function viderCompte() { emailEdite = null; $('#cp-email').value = ''; $('#cp-nom').value = ''; $('#cp-q').value = ''; choixCodes = new Set(); $('#cp-info').textContent = ''; rendreChoixMagasins(); }
  async function enregistrerCompte() {
    const email = $('#cp-email').value.trim().toLowerCase();
    try {
      if (emailEdite && emailEdite !== email) await appel('/restes-dus/comptes/supprimer', { method: 'POST', body: JSON.stringify({ email: emailEdite }) });
      const ex = (S.comptes || []).find(x => x.email === email);
      await appel('/restes-dus/comptes', { method: 'PUT', body: JSON.stringify({ email, nom: $('#cp-nom').value.trim(), codes: [...choixCodes], actif: ex ? ex.actif : true }) });
      viderCompte(); $('#cp-info').textContent = 'Compte enregistré : ' + email; chargerComptes();
    } catch (e) { $('#cp-info').textContent = e.message; }
  }

  // ---------- Version ----------
  let version = null;
  async function verifierVersion() {
    try {
      const v = (await (await fetch('version.json?t=' + Date.now(), { cache: 'no-store' })).json()).version;
      if (!version) {
        version = v; $('#version').textContent = 'version ' + v;
        // Page servie par une ancienne copie (fichier app.js plus ancien que version.json) : bandeau tout de suite
        if (VERSION_CODE && VERSION_CODE !== v) $('#bandeau-maj').hidden = false;
      } else if (v !== version) $('#bandeau-maj').hidden = false;
    } catch (e) {}
  }

  // ---------- Démarrage ----------
  $('#btn-connexion').onclick = connecter;
  $('#cx-pass').onkeydown = e => { if (e.key === 'Enter') connecter(); };
  $('#lien-deconnexion').onclick = e => { e.preventDefault(); localStorage.removeItem(CLE_SESSION); session = null; location.reload(); };
  $$('#onglets button').forEach(b => b.onclick = () => vue(b.dataset.vue));
  $('#mg-choix').onchange = () => choisirMagasin($('#mg-choix').value);
  $('#mg-afaire').onchange = rendreMagasin; $('#mg-q').oninput = rendreMagasin;
  const zone = $('#depot'), fic = $('#fichier');
  zone.onclick = () => fic.click(); zone.onkeydown = e => { if (e.key === 'Enter') fic.click(); };
  fic.onchange = () => { deposer(fic.files[0]); fic.value = ''; };
  zone.ondragover = e => { e.preventDefault(); zone.classList.add('survol'); };
  zone.ondragleave = () => zone.classList.remove('survol');
  zone.ondrop = e => { e.preventDefault(); zone.classList.remove('survol'); deposer(e.dataTransfer.files[0]); };
  $('#cp-q').oninput = rendreChoixMagasins; $('#cp-enregistrer').onclick = enregistrerCompte; $('#cp-vider').onclick = viderCompte;
  // Mise à jour : le service worker relit les fichiers sur le réseau, puis la page est rechargée
  $('#btn-maj').onclick = async () => {
    $('#btn-maj').disabled = true; $('#btn-maj').textContent = 'Mise à jour…';
    try { const reg = await navigator.serviceWorker.getRegistration(); if (reg) await reg.update(); } catch (e) {}
    location.reload();
  };
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(e => console.warn('service worker', e));
  verifierVersion(); setInterval(verifierVersion, 180000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) verifierVersion(); });
  if (session && session.expire > Date.now()) demarrer(); else afficherConnexion();
})();
