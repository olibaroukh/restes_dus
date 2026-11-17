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
    const C = { fact: col('N° facture'), date: col('Date'), centre: col('Centre'), client: col('Client'), tp: col('TP'), type: col('Type'), mt: col('Montant'), ncli: col('N° client'), vend: col('RefVendeur'), cree: col('Créé Par') };
    for (const [k, v] of Object.entries(C)) if (v < 0 && !['vend', 'ncli', 'cree'].includes(k)) throw new Error('Colonne manquante dans le fichier : ' + k);
    const lignes = [];
    for (const l of L.slice(iEnt + 1)) {
      if (!l || l.length < 5) continue;
      const type = (l[C.type] || '').trim();
      if (type === 'TOTAL') break;                       // récapitulatif en fin de fichier
      const centre = (l[C.centre] || '').trim(), date = dateISO(l[C.date]);
      if (!centre || !date) continue;
      lignes.push({ centre: codeNorm(centre), facture: (l[C.fact] || '').trim(), date, client: (l[C.client] || '').trim(), organisme: (l[C.tp] || '').trim(),
        type, montant: montant(l[C.mt]), ncli: C.ncli >= 0 ? (l[C.ncli] || '').trim() : '', vendeur: ((C.vend >= 0 ? l[C.vend] : '') || (C.cree >= 0 ? l[C.cree] : '') || '').trim() });   // vendeur, sinon personne qui a saisi le règlement
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
  const VERSION_CODE = '2026.11.18-3';   // à incrémenter avec version.json à chaque modification
  const API = 'https://suivi-stats-api.oli-baroukh.workers.dev';
  const CLE_SESSION = 'suiviStatsSession';
  const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const norm = s => String(s == null ? '' : s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
  const eur = v => (v || 0).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
  const dateFr = s => { if (!s) return ''; const [a, m, j] = String(s).slice(0, 10).split('-'); return j ? `${j}/${m}/${a}` : s; };
  const auj = () => new Date().toISOString().slice(0, 10);
  const totalDossier = d => d.lignes.reduce((a, l) => a + l.montant, 0);
  // États d'un dossier : afaire (pas de motif), refuse (motif refusé par le franchisé), expire (date d'action dépassée),
  // justifie (motif saisi ; « accepte » si le franchisé l'a accepté). Seuls justifie / accepte comptent comme justifiés.
  const etatJustif = j => !j || !j.motif ? 'afaire' : j.decision === 'refuse' ? 'refuse' : (j.dateAction && j.dateAction < auj() ? 'expire' : (j.decision === 'accepte' ? 'accepte' : 'justifie'));
  const estOK = e => e === 'justifie' || e === 'accepte';
  const DELAI_ACTION_JOURS = 30;   // date d'action proposée automatiquement au choix du motif
  const dansJours = n => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
  const nomPers = e => String(e || '').split('@')[0].split(/[._-]+/).filter(Boolean).map(x => x[0].toUpperCase() + x.slice(1)).join(' ');
  const franchise = () => S.moi && (S.moi.admin || S.moi.franchise);

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
    $$('.franchise-seul').forEach(b => b.hidden = !franchise());
    $('#onglets [data-vue=magasin]').textContent = franchise() ? 'Magasins' : 'Mes restes dus';
    $('#sv-titre').textContent = S.moi.admin ? 'Suivi des franchisés' : 'Suivi de mes magasins';
    const sel = $('#mg-choix');
    sel.innerHTML = (S.moi.admin ? '<option value="">— Choisir un magasin —</option>' : '') + S.magasins.map(m => `<option value="${esc(m.code)}">${esc(m.magasin || m.code)} (${esc(m.code)})${S.moi.admin ? ' · ' + esc(m.groupe) : ''}</option>`).join('');
    sel.hidden = S.magasins.length < 2 && !S.moi.admin;
    if (!S.magasins.length) { $('#mg-dossiers').innerHTML = '<p class="muted">Aucun magasin n’est rattaché à votre compte. Contactez Olivier Baroukh.</p>'; $('#depot').hidden = true; }
    if (S.magasins.length && !S.moi.admin) choisirMagasin(S.magasins[0].code);
    if (franchise()) vue('suivi');
  }

  function vue(v) {
    $$('#onglets button').forEach(b => b.classList.toggle('actif', b.dataset.vue === v));
    $$('.vue').forEach(s => s.classList.toggle('actif', s.id === 'vue-' + v));
    if (v === 'suivi') chargerSuivi();
    if (v === 'comptes') chargerComptes();
    if (v === 'recap') chargerRecap();
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

  function resumeMagasin() {
    const d = S.donnees, ds = d.depot.dossiers, etat = c => etatJustif(d.justifs[c.cle]);
    const tot = ds.reduce((a, x) => a + totalDossier(x), 0), somme = f => ds.filter(f).reduce((a, x) => a + totalDossier(x), 0);
    const ok = ds.filter(x => estOK(etat(x))), ref = ds.filter(x => etat(x) === 'refuse'), aval = ds.filter(x => etat(x) === 'justifie');
    $('#mg-resume').innerHTML = `
      <div class="vignette"><span>Extraction du</span><b>${dateFr(d.depot.dateEdition)}</b><span class="petit">déposée le ${dateFr(d.depot.le)}</span></div>
      <div class="vignette"><span>Dossiers à justifier</span><b>${ds.length}</b><span class="petit">${eur(tot)}</span></div>
      <div class="vignette ${ok.length === ds.length ? 'ok' : 'ko'}"><span>Justifiés</span><b>${ok.length} / ${ds.length}</b><span class="petit">reste ${eur(tot - somme(x => estOK(etat(x))))}</span></div>
      <div class="vignette ${ref.length ? 'ko' : ''}"><span>Motifs refusés</span><b>${ref.length}</b><span class="petit">${eur(somme(x => etat(x) === 'refuse'))}</span></div>
      ${franchise() ? `<div class="vignette"><span>À valider</span><b>${aval.length}</b><span class="petit">${eur(somme(x => etat(x) === 'justifie'))}</span></div>` : ''}`;
  }

  function rendreMagasin() {
    const d = S.donnees, dep = d.depot;
    if (!dep) {
      $('#mg-resume').innerHTML = ''; $('#mg-filtres').hidden = true;
      $('#mg-dossiers').innerHTML = '<p class="muted">Aucune extraction déposée pour l’instant.</p>';
      return;
    }
    const ds = dep.dossiers, etat = c => etatJustif(d.justifs[c.cle]);
    resumeMagasin();
    $('#mg-filtres').hidden = !ds.length;
    $('#mg-statut').querySelector('[value=avalider]').hidden = !franchise();
    const q = norm($('#mg-q').value), f = $('#mg-statut').value;
    const garde = e => f === 'tous' || (f === 'afaire' && !estOK(e)) || (f === 'refuse' && e === 'refuse') || (f === 'avalider' && e === 'justifie') || (f === 'ok' && estOK(e));
    const liste = ds.filter(x => garde(etat(x)) && (!q || norm([x.facture, x.client, ...x.lignes.map(l => l.organisme + ' ' + l.type + ' ' + l.vendeur)].join(' ')).includes(q)));
    if (!ds.length) { $('#mg-dossiers').innerHTML = '<p class="ok">Aucun dossier à justifier dans cette extraction. 👍</p>'; return; }
    if (!liste.length) { $('#mg-dossiers').innerHTML = `<p class="ok">${f === 'afaire' ? 'Tous les dossiers sont justifiés. 👍' : 'Aucun dossier ne correspond.'}</p>`; return; }
    $('#mg-dossiers').innerHTML = liste.map(x => carteDossier(x, d.justifs[x.cle] || {})).join('');
    $$('#mg-dossiers .dossier').forEach(brancherDossier);
  }

  function libelleEtat(j) {
    const e = etatJustif(j), qui = j.par ? ` par ${esc(nomPers(j.par))}` : '';
    const saisi = j.majLe ? ` · motif saisi le ${dateFr(j.majLe)}${qui}` : '';
    if (e === 'afaire') return '<span class="etat ko">À justifier</span>';
    if (e === 'refuse') return `<span class="etat ko">✗ Motif refusé par ${esc(nomPers(j.decisionPar) || 'le franchisé')} le ${dateFr(j.decisionLe)}${j.decisionCom ? ' : « ' + esc(j.decisionCom) + ' »' : ''} — à reprendre</span>`;
    if (e === 'expire') return `<span class="etat attention">Date d’action dépassée : mettez à jour la justification${saisi}</span>`;
    if (e === 'accepte') return `<span class="etat ok">✓ Accepté par ${esc(nomPers(j.decisionPar) || 'le franchisé')} le ${dateFr(j.decisionLe)}${saisi}</span>`;
    return `<span class="etat ok">✓ Justifié${saisi}${franchise() ? ' · <b class="attention">à valider</b>' : ''}</span>`;
  }

  function carteDossier(x, j) {
    const e = etatJustif(j);
    const opts = '<option value="">— Motif —</option>' + S.motifs.map(m => `<option${j.motif === m ? ' selected' : ''}>${esc(m)}</option>`).join('');
    const boutons = franchise() && j.motif ? `<div class="decision">
        <button class="d-ok${j.decision === 'accepte' ? ' choisi' : ''}">✓ Accepter</button>
        <button class="d-ko${j.decision === 'refuse' ? ' choisi' : ''}">✗ Refuser</button>
        ${j.decision ? '<button class="lien d-rien">Annuler la décision</button>' : ''}</div>` : '';
    return `<div class="dossier ${e}" data-cle="${esc(x.cle)}">
      <div>
        <div class="tete"><span>${esc(x.facture || 'Sans n° de facture')} · ${esc(x.client)}</span><span class="montant">${eur(totalDossier(x))}</span></div>
        <table>${x.lignes.map(l => `<tr><td>${dateFr(l.date)}</td><td>${esc(l.type)}</td><td>${esc(l.organisme)}</td><td class="muted">${esc(l.vendeur)}</td><td class="num">${eur(l.montant)}</td></tr>`).join('')}</table>
      </div>
      <div class="saisie">
        <select class="j-motif">${opts}</select>
        <input type="date" class="j-date" value="${esc(j.dateAction || '')}" title="Date d’action prévue (proposée automatiquement à ${DELAI_ACTION_JOURS} jours)">
        <textarea class="j-com" placeholder="Commentaire (facultatif)" maxlength="1000">${esc(j.commentaire || '')}</textarea>
        <div class="etat-l">${libelleEtat(j)}</div>
        ${boutons}
      </div></div>`;
  }

  function remplacerCarte(el, cle) {
    const x = S.donnees.depot.dossiers.find(y => y.cle === cle);
    const tmp = document.createElement('div'); tmp.innerHTML = carteDossier(x, S.donnees.justifs[cle] || {});
    const n = tmp.firstElementChild; el.replaceWith(n); brancherDossier(n); resumeMagasin();
  }

  function brancherDossier(el) {
    const cle = el.dataset.cle, motif = el.querySelector('.j-motif'), date = el.querySelector('.j-date');
    motif.onchange = () => { if (motif.value && !date.value) date.value = dansJours(DELAI_ACTION_JOURS); if (!motif.value) date.value = ''; enregistrer(el); };
    date.onchange = () => enregistrer(el); el.querySelector('.j-com').onchange = () => enregistrer(el);
    const ok = el.querySelector('.d-ok'), ko = el.querySelector('.d-ko'), rien = el.querySelector('.d-rien');
    if (ok) ok.onclick = () => decider(el, cle, 'accepte', '');
    if (ko) ko.onclick = () => { const c = prompt('Motif refusé : expliquez ce qui ne va pas (le magasin le verra)', ''); if (c === null) return; decider(el, cle, 'refuse', c.trim()); };
    if (rien) rien.onclick = () => decider(el, cle, '', '');
  }

  async function decider(el, cle, decision, commentaire) {
    const zone = el.querySelector('.etat-l'); zone.innerHTML = '<span class="etat muted">Enregistrement…</span>';
    try {
      const r = await appel('/restes-dus/decision', { method: 'PUT', body: JSON.stringify({ code: S.code, cle, decision, commentaire }) });
      Object.assign(S.donnees.justifs[cle], { decision, decisionCom: commentaire, decisionPar: decision ? r.decisionPar : '', decisionLe: decision ? r.decisionLe : '' });
      remplacerCarte(el, cle);
    } catch (e) { zone.innerHTML = `<span class="etat ko">Non enregistré : ${esc(e.message)}</span>`; }
  }

  async function enregistrer(el) {
    const cle = el.dataset.cle, motif = el.querySelector('.j-motif').value, dateAction = el.querySelector('.j-date').value, commentaire = el.querySelector('.j-com').value.trim();
    const zone = el.querySelector('.etat-l'); zone.innerHTML = '<span class="etat muted">Enregistrement…</span>';
    try {
      const r = await appel('/restes-dus/justif', { method: 'PUT', body: JSON.stringify({ code: S.code, cle, motif, dateAction, commentaire }) });
      const anc = S.donnees.justifs[cle] || {};
      S.donnees.justifs[cle] = { ...anc, motif, dateAction, commentaire, majLe: r.majLe, par: r.par, ...(r.decisionEffacee ? { decision: '', decisionCom: '', decisionPar: '', decisionLe: '' } : {}) };
      remplacerCarte(el, cle);   // la carte reste affichée même si elle ne correspond plus au filtre
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
      const [s, c] = await Promise.all([appel('/restes-dus/suivi'), S.moi.admin ? appel('/restes-dus/comptes') : Promise.resolve({ comptes: [{ codes: S.magasins.map(m => m.code) }] })]);
      S.suivi = s.suivi; S.comptes = S.moi.admin ? c.comptes : null; S.comptesSuivi = c.comptes; rendreSuivi();
    } catch (e) { $('#sv-table').innerHTML = `<tr><td class="ko">${esc(e.message)}</td></tr>`; }
  }
  function rendreSuivi() {
    const parCode = new Map(S.suivi.map(x => [x.code, x]));
    // Magasins rattachés à un compte mais sans dépôt
    for (const c of S.comptesSuivi || []) for (const code of c.codes) if (!parCode.has(code)) {
      const m = S.magasins.find(x => x.code === code) || { code };
      parCode.set(code, { ...m, nb: null, montant: null, nbJustifies: null, montantJustifie: null });
    }
    const lignes = [...parCode.values()].map(x => ({ ...x, nonJustifie: x.montant == null ? -1 : x.montant - x.montantJustifie, pct: x.nb ? x.nbJustifies / x.nb : (x.nb === 0 ? 1 : -1) }));
    const T = lignes.filter(x => x.nb != null), tot = T.reduce((a, x) => a + x.montant, 0), totJ = T.reduce((a, x) => a + x.montantJustifie, 0);
    $('#sv-resume').innerHTML = `
      <div class="vignette"><span>Magasins avec dépôt</span><b>${T.length} / ${lignes.length}</b></div>
      <div class="vignette"><span>Dossiers</span><b>${T.reduce((a, x) => a + x.nb, 0)}</b><span class="petit">${eur(tot)}</span></div>
      <div class="vignette ${totJ >= tot ? 'ok' : 'ko'}"><span>Justifiés</span><b>${T.reduce((a, x) => a + x.nbJustifies, 0)}</b><span class="petit">${eur(totJ)} · reste ${eur(tot - totJ)}</span></div>
      <div class="vignette"><span>Motifs refusés</span><b>${T.reduce((a, x) => a + (x.nbRefuses || 0), 0)}</b><span class="petit">${eur(T.reduce((a, x) => a + (x.montantRefuse || 0), 0))}</span></div>`;
    const k = triSuivi.k, s = triSuivi.sens;
    lignes.sort((a, b) => { const va = a[k], vb = b[k]; return (typeof va === 'number' && typeof vb === 'number' ? va - vb : String(va || '').localeCompare(String(vb || ''))) * s; });
    const th = (cle, lib, num) => `<th data-k="${cle}" class="${num ? 'num' : ''}">${lib}${k === cle ? (s > 0 ? ' ▲' : ' ▼') : ''}</th>`;
    $('#sv-table').innerHTML = `<thead><tr>${th('magasin', 'Magasin')}${th('groupe', 'Franchisé')}${th('dateEdition', 'Extraction du')}${th('le', 'Déposée le')}${th('nb', 'Dossiers', 1)}${th('montant', 'Montant', 1)}${th('pct', 'Justifiés', 1)}${th('nonJustifie', 'Non justifié', 1)}${th('montantRefuse', 'dont refusé', 1)}<th>Principaux motifs</th></tr></thead><tbody>` +
      lignes.map(x => x.nb == null
        ? `<tr class="cliquable" data-code="${esc(x.code)}"><td>${esc(x.magasin || '')} <span class="muted">${esc(x.code)}</span></td><td>${esc(x.groupe || '')}</td><td colspan="8" class="muted">Aucun dépôt</td></tr>`
        : `<tr class="cliquable" data-code="${esc(x.code)}"><td>${esc(x.magasin)} <span class="muted">${esc(x.code)}</span></td><td>${esc(x.groupe)}</td><td>${dateFr(x.dateEdition)}</td><td>${dateFr(x.le)}</td>
          <td class="num">${x.nb}</td><td class="num">${eur(x.montant)}</td>
          <td class="num">${x.nbJustifies} / ${x.nb}<div class="barre"><i style="width:${Math.round((x.nb ? x.nbJustifies / x.nb : 1) * 100)}%"></i></div></td>
          <td class="num ${x.nonJustifie > 0 ? 'ko' : 'ok'}">${eur(x.nonJustifie)}</td>
          <td class="num ${x.montantRefuse > 0 ? 'ko' : ''}">${x.nbRefuses ? eur(x.montantRefuse) : '–'}</td>
          <td class="petit">${Object.entries(x.parMotif || {}).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([m, v]) => `${esc(m)} (${eur(v)})`).join('<br>')}</td></tr>`).join('') + '</tbody>';
    $$('#sv-table th[data-k]').forEach(t => t.onclick = () => { triSuivi = { k: t.dataset.k, sens: triSuivi.k === t.dataset.k ? -triSuivi.sens : 1 }; rendreSuivi(); });
    $$('#sv-table tr.cliquable').forEach(t => t.onclick = () => { vue('magasin'); choisirMagasin(t.dataset.code); });
  }

  // ---------- Récapitulatifs (franchisé, administrateurs) ----------
  async function chargerRecap() {
    $('#rc-tables').innerHTML = '<p class="muted">Chargement…</p>';
    try {
      S.detail = (await appel('/restes-dus/detail')).magasins;
      const sel = $('#rc-magasin'), avant = sel.value;
      sel.innerHTML = `<option value="">Tous ${S.moi.admin ? 'les' : 'mes'} magasins (${S.detail.length})</option>` + S.detail.slice().sort((a, b) => (a.magasin || '').localeCompare(b.magasin || '')).map(m => `<option value="${esc(m.code)}">${esc(m.magasin || m.code)} (${esc(m.code)})</option>`).join('');
      sel.value = S.detail.some(m => m.code === avant) ? avant : (S.code && S.detail.some(m => m.code === S.code) && !S.moi.admin ? S.code : '');
      rendreRecap();
    } catch (e) { $('#rc-tables').innerHTML = `<p class="ko">${esc(e.message)}</p>`; }
  }
  function rendreRecap() {
    const code = $('#rc-magasin').value, mags = (S.detail || []).filter(m => !code || m.code === code);
    if (!mags.length) { $('#rc-resume').innerHTML = ''; $('#rc-tables').innerHTML = '<p class="muted">Aucune extraction déposée.</p>'; return; }
    // Une ligne de règlement = une entrée, avec l'état de son dossier
    const L = [];
    for (const m of mags) for (const x of m.dossiers) {
      const j = m.justifs[x.cle] || {}, e = etatJustif(j);
      const cat = estOK(e) ? 'ok' : e === 'refuse' ? 'ref' : 'sans';
      for (const l of x.lignes) L.push({ ...l, cat, motif: j.motif || '(aucun motif)', magasin: m.magasin || m.code, dossier: m.code + '|' + x.cle });
    }
    const tot = k => L.filter(l => !k || l.cat === k).reduce((a, l) => a + l.montant, 0);
    $('#rc-resume').innerHTML = `
      <div class="vignette"><span>Restes dus à justifier</span><b>${eur(tot())}</b><span class="petit">${new Set(L.map(l => l.dossier)).size} dossiers · ${L.length} lignes</span></div>
      <div class="vignette ok"><span>Justifiés</span><b>${eur(tot('ok'))}</b></div>
      <div class="vignette ${tot('ref') ? 'ko' : ''}"><span>Motifs refusés</span><b>${eur(tot('ref'))}</b></div>
      <div class="vignette ${tot('sans') ? 'ko' : ''}"><span>Sans justification</span><b>${eur(tot('sans'))}</b></div>`;
    const bloc = (titre, cle, libVide) => {
      const g = new Map();
      for (const l of L) { const k = l[cle] || libVide; if (!g.has(k)) g.set(k, { n: new Set(), t: 0, ok: 0, ref: 0, sans: 0 }); const x = g.get(k); x.n.add(l.dossier); x.t += l.montant; x[l.cat] += l.montant; }
      const rows = [...g.entries()].sort((a, b) => b[1].t - a[1].t);
      const td = (v, cls) => `<td class="num ${v > 0 && cls ? cls : ''}">${v ? eur(v) : '–'}</td>`;
      return `<div class="bloc"><h3>${titre}</h3><table class="tableau"><thead><tr><th>${titre}</th><th class="num">Dossiers</th><th class="num">Montant</th><th class="num">Justifié</th><th class="num">Refusé</th><th class="num">Sans justif.</th></tr></thead><tbody>` +
        rows.map(([k, x]) => `<tr><td>${esc(k)}</td><td class="num">${x.n.size}</td><td class="num">${eur(x.t)}</td>${td(x.ok, 'ok')}${td(x.ref, 'ko')}${td(x.sans, 'ko')}</tr>`).join('') +
        `</tbody><tfoot><tr><td>Total</td><td class="num">${new Set(L.map(l => l.dossier)).size}</td><td class="num">${eur(tot())}</td>${td(tot('ok'))}${td(tot('ref'))}${td(tot('sans'))}</tr></tfoot></table></div>`;
    };
    $('#rc-tables').innerHTML = bloc('Mutuelle / organisme', 'organisme', '(sans organisme : chèque, virement…)') + bloc('Collaborateur', 'vendeur', '(non renseigné)')
      + bloc('Type de règlement', 'type', '(non renseigné)') + bloc('Motif', 'motif', '(aucun motif)') + (mags.length > 1 ? bloc('Magasin', 'magasin', '?') : '');
  }

  // ---------- Comptes (administrateurs) ----------
  // Franchisé : on choisit le groupe, ses magasins viennent du référentiel (franchises actives du groupe), automatiquement.
  // Magasin : on choisit le groupe pour filtrer, puis on coche le ou les magasins.
  let choixCodes = new Set(), emailEdite = null;
  const groupes = () => [...new Set(S.magasins.map(m => m.groupe).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  const magsGroupe = g => S.magasins.filter(m => m.groupe === g);
  async function chargerComptes() {
    try { S.comptes = (await appel('/restes-dus/comptes')).comptes; rendreComptes(); } catch (e) { $('#cp-info').textContent = e.message; }
  }
  function remplirGroupes() {
    const sel = $('#cp-groupe'), v = sel.value;
    sel.innerHTML = '<option value="">— Choisir le groupe —</option>' + groupes().map(g => `<option value="${esc(g)}">${esc(g)} (${magsGroupe(g).length} magasin${magsGroupe(g).length > 1 ? 's' : ''})</option>`).join('');
    sel.value = v;
  }
  function remplirMagasins() {
    const sel = $('#cp-magasin'), v = sel.value;
    sel.innerHTML = '<option value="">— Choisir le magasin —</option>' + S.magasins.slice().sort((a, b) => (a.magasin || '').localeCompare(b.magasin || ''))
      .map(m => `<option value="${esc(m.code)}">${esc(m.magasin || m.code)} · ${esc(m.code)}</option>`).join('');
    sel.value = v;
  }
  function rendreChoixMagasins() {
    const g = $('#cp-groupe').value, role = $('#cp-role').value;
    $('#cp-q').hidden = true;
    $('#cp-bloc-groupe').hidden = role === 'magasin'; $('#cp-bloc-magasin').hidden = role !== 'magasin';
    if (role === 'magasin') {
      // Un compte magasin = un magasin franchisé actif, choisi par son nom et son code site
      const m = S.magasins.find(x => x.code === $('#cp-magasin').value);
      $('#cp-lib-mag').textContent = 'Magasin de ce compte';
      $('#cp-magasins').innerHTML = m ? `<div class="petit">✓ ${esc(m.magasin)} <span class="muted">${esc(m.code)} · ${esc(m.groupe)}</span></div>` : '<p class="muted petit">Choisissez le magasin.</p>';
      return;
    }
    if (role === 'franchise') {
      $('#cp-lib-mag').textContent = 'Magasins du groupe (automatique, d’après le référentiel)';
      $('#cp-magasins').innerHTML = !g ? '<p class="muted petit">Choisissez le groupe : ses magasins s’afficheront ici.</p>'
        : magsGroupe(g).map(m => `<div class="petit">✓ ${esc(m.magasin)} <span class="muted">${esc(m.code)}</span></div>`).join('');
      return;
    }
    $('#cp-lib-mag').textContent = 'Magasin(s) de ce compte';
    const q = norm($('#cp-q').value);
    const liste = S.magasins.filter(m => choixCodes.has(m.code) || ((!g || m.groupe === g) && (!q || norm(m.code + ' ' + m.magasin + ' ' + m.groupe).includes(q)))).slice(0, 300);
    $('#cp-magasins').innerHTML = liste.map(m => `<label><input type="checkbox" value="${esc(m.code)}"${choixCodes.has(m.code) ? ' checked' : ''}> ${esc(m.magasin)} <span class="muted">${esc(m.code)} · ${esc(m.groupe)}</span></label>`).join('') || '<p class="muted petit">Aucun magasin.</p>';
    $$('#cp-magasins input').forEach(c => c.onchange = () => { c.checked ? choixCodes.add(c.value) : choixCodes.delete(c.value); });
  }
  function rendreComptes() {
    remplirGroupes(); remplirMagasins(); rendreChoixMagasins();
    const nomMag = c => (S.magasins.find(m => m.code === c) || {}).magasin || c;
    const magsCompte = c => [...new Set([...(c.groupe ? c.magasinsGroupe || [] : []), ...c.codes])];
    $('#cp-table').innerHTML = '<thead><tr><th>Groupe</th><th>Adresse</th><th>Nom</th><th>Type</th><th>Magasins</th><th>Actif</th><th></th></tr></thead><tbody>' +
      (S.comptes || []).map(c => `<tr><td>${esc(c.groupe || (S.magasins.find(m => m.code === c.codes[0]) || {}).groupe || '–')}</td><td>${esc(c.email)}</td><td>${esc(c.nom || '')}</td><td>${c.role === 'magasin' ? 'Magasin' : 'Franchisé'}</td>
        <td class="petit">${magsCompte(c).map(x => esc(nomMag(x)) + ' <span class="muted">' + esc(x) + '</span>').join('<br>') || '<span class="ko">aucun magasin actif</span>'}${c.groupe ? '<br><span class="muted">(magasins du groupe, automatique)</span>' : ''}</td>
        <td>${c.actif ? '✓' : '<span class="ko">non</span>'}</td>
        <td><button data-e="${esc(c.email)}" class="cp-mod">Modifier</button> <button data-e="${esc(c.email)}" class="cp-act">${c.actif ? 'Désactiver' : 'Réactiver'}</button> <button data-e="${esc(c.email)}" class="cp-sup">Supprimer</button></td></tr>`).join('') + '</tbody>';
    $$('.cp-mod').forEach(b => b.onclick = () => {
      const c = S.comptes.find(x => x.email === b.dataset.e); emailEdite = c.email;
      $('#cp-email').value = c.email; $('#cp-nom').value = c.nom || ''; $('#cp-role').value = c.role === 'magasin' ? 'magasin' : 'franchise';
      // groupe : celui du compte, sinon celui de ses magasins (anciens comptes ou comptes magasin)
      $('#cp-groupe').value = c.groupe || ((S.magasins.find(m => m.code === c.codes[0]) || {}).groupe || '');
      $('#cp-magasin').value = c.role === 'magasin' ? (c.codes[0] || '') : '';
      choixCodes = new Set(c.role === 'magasin' ? c.codes : []); $('#cp-q').value = ''; rendreChoixMagasins();
      $('#cp-info').textContent = 'Modification de ' + c.email; window.scrollTo(0, 0);
    });
    $$('.cp-act').forEach(b => b.onclick = async () => { const c = S.comptes.find(x => x.email === b.dataset.e); try { await appel('/restes-dus/comptes', { method: 'PUT', body: JSON.stringify({ ...c, actif: !c.actif }) }); chargerComptes(); } catch (e) { $('#cp-info').textContent = e.message; } });
    $$('.cp-sup').forEach(b => b.onclick = async () => { if (!confirm('Supprimer le compte ' + b.dataset.e + ' ? Les justifications déjà saisies sont conservées.')) return; try { await appel('/restes-dus/comptes/supprimer', { method: 'POST', body: JSON.stringify({ email: b.dataset.e }) }); chargerComptes(); } catch (e) { $('#cp-info').textContent = e.message; } });
  }
  function viderCompte() { emailEdite = null; $('#cp-role').value = 'franchise'; $('#cp-groupe').value = ''; $('#cp-magasin').value = ''; $('#cp-email').value = ''; $('#cp-nom').value = ''; $('#cp-q').value = ''; choixCodes = new Set(); $('#cp-info').textContent = ''; rendreChoixMagasins(); }
  async function enregistrerCompte() {
    const email = $('#cp-email').value.trim().toLowerCase(), role = $('#cp-role').value, groupe = $('#cp-groupe').value;
    try {
      if (role === 'franchise' && !groupe) throw new Error('Choisissez le groupe du franchisé.');
      const mag = $('#cp-magasin').value;
      if (role === 'magasin' && !mag) throw new Error('Choisissez le magasin.');
      if (emailEdite && emailEdite !== email) await appel('/restes-dus/comptes/supprimer', { method: 'POST', body: JSON.stringify({ email: emailEdite }) });
      const ex = (S.comptes || []).find(x => x.email === email);
      await appel('/restes-dus/comptes', { method: 'PUT', body: JSON.stringify({ email, nom: $('#cp-nom').value.trim(), role, groupe: role === 'franchise' ? groupe : '', codes: role === 'magasin' ? [mag] : [], actif: ex ? ex.actif : true }) });
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
        if (VERSION_CODE && VERSION_CODE !== v && !sessionStorage.getItem('rdMaj:' + v)) $('#bandeau-maj').hidden = false;
      } else if (v !== version) $('#bandeau-maj').hidden = false;
    } catch (e) {}
  }

  // ---------- Démarrage ----------
  $('#btn-connexion').onclick = connecter;
  $('#cx-pass').onkeydown = e => { if (e.key === 'Enter') connecter(); };
  $('#lien-deconnexion').onclick = e => { e.preventDefault(); localStorage.removeItem(CLE_SESSION); session = null; location.reload(); };
  $$('#onglets button').forEach(b => b.onclick = () => vue(b.dataset.vue));
  $('#mg-choix').onchange = () => choisirMagasin($('#mg-choix').value);
  $('#mg-statut').onchange = rendreMagasin; $('#rc-magasin').onchange = rendreRecap; $('#mg-q').oninput = rendreMagasin;
  const zone = $('#depot'), fic = $('#fichier');
  zone.onclick = () => fic.click(); zone.onkeydown = e => { if (e.key === 'Enter') fic.click(); };
  fic.onchange = () => { deposer(fic.files[0]); fic.value = ''; };
  zone.ondragover = e => { e.preventDefault(); zone.classList.add('survol'); };
  zone.ondragleave = () => zone.classList.remove('survol');
  zone.ondrop = e => { e.preventDefault(); zone.classList.remove('survol'); deposer(e.dataTransfer.files[0]); };
  $('#cp-q').oninput = rendreChoixMagasins; $('#cp-groupe').onchange = rendreChoixMagasins;
  // Choix du magasin : adresse e-mail du référentiel proposée si le champ est vide
  $('#cp-magasin').onchange = () => { const m = S.magasins.find(x => x.code === $('#cp-magasin').value); if (m && m.email && !$('#cp-email').value.trim()) $('#cp-email').value = m.email; rendreChoixMagasins(); }; $('#cp-role').onchange = rendreChoixMagasins; $('#cp-enregistrer').onclick = enregistrerCompte; $('#cp-vider').onclick = viderCompte;
  // Mise à jour : le service worker relit les fichiers sur le réseau, puis la page est rechargée
  $('#btn-maj').onclick = async () => {
    $('#btn-maj').disabled = true; $('#btn-maj').textContent = 'Mise à jour…';
    try { const reg = await navigator.serviceWorker.getRegistration(); if (reg) await reg.update(); } catch (e) {}
    // Garde-fou : une seule relance automatique par version (pas de boucle si la publication GitHub n'est pas finie)
    try { const v = (await (await fetch('version.json?t=' + Date.now(), { cache: 'no-store' })).json()).version; sessionStorage.setItem('rdMaj:' + v, '1'); } catch (e) {}
    location.reload();
  };
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(e => console.warn('service worker', e));
  verifierVersion(); setInterval(verifierVersion, 180000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) verifierVersion(); });
  if (session && session.expire > Date.now()) demarrer(); else afficherConnexion();
})();
