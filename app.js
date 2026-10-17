/* Foulée — interface */
(function () {
  const { iso, parseISO, addDays, mondayOf, fmtPace, fmtTime, km1 } = P;
  const KEY = 'foulee.v1';
  const $ = s => document.querySelector(s);
  const app = $('#app');

  /* ---------- État ---------- */
  const fresh = () => ({ v: 1, name: '', runs: [], profile: null, plan: null, done: {}, seen: [], note: '', moves: {}, geo: null, wx: null, recap: null, base: null, lastBackup: 0 });
  let S;
  try { S = Object.assign(fresh(), JSON.parse(localStorage.getItem(KEY) || '{}')); } catch (e) { S = fresh(); }
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) { } };
  const ui = { tab: 'today', step: S.plan ? null : 0, D: null, open: null, sheet: null };

  const stravaRuns = () => S.runs.map(r => ({ date: r[0], km: r[1], sec: r[2] }));
  function allRuns() { // courses Strava + séances saisies à la main
    const out = stravaRuns(); const dates = new Set(out.map(r => r.date));
    Object.entries(S.done).forEach(([id, d]) => { const dt = dateOf(id); if (!d.skipped && d.km > 0 && d.sec > 0 && !dates.has(dt)) out.push({ date: dt, km: d.km, sec: d.sec }); });
    return out;
  }
  const allSessions = () => (S.plan ? S.plan.weeks.flatMap(w => w.sessions) : []);
  const dateOf = id => { const s = allSessions().find(x => x.id === id); return s ? s.date : id; };
  const isDone = id => S.done[id] && !S.done[id].skipped;

  /* ---------- Plan / adaptation ---------- */
  function mergePlan(np, today) {
    const t = iso(today), keep = new Set();
    const byMon = new Map();
    S.plan.weeks.forEach(w => {
      const ss = w.sessions.filter(s => s.date < t || (s.date === t && isDone(s.id)) || (S.moves[s.id] && s.id < t && !isDone(s.id)));
      ss.forEach(s => keep.add(s.id));
      if (ss.length) byMon.set(w.monday, { ...w, sessions: ss });
    });
    np.weeks.forEach(w => {
      const ss = w.sessions.filter(s => !keep.has(s.id));
      if (!ss.length) return;
      const ex = byMon.get(w.monday);
      if (ex) ex.sessions = ex.sessions.concat(ss).sort((a, b) => (a.date < b.date ? -1 : 1));
      else byMon.set(w.monday, { ...w, sessions: ss });
    });
    return { createdAt: S.plan.createdAt, weeks: applyMoves([...byMon.values()]), info: np.info };
  }
  /* Applique les séances décalées par l'utilisatrice et regroupe par semaine */
  function applyMoves(weeks) {
    const byMon = new Map(weeks.map(w => [w.monday, { ...w, sessions: [] }]));
    weeks.forEach(w => w.sessions.forEach(s => {
      if (S.moves[s.id] && s.type !== 'race') s.date = S.moves[s.id];
      const m = iso(mondayOf(parseISO(s.date)));
      if (!byMon.has(m)) byMon.set(m, { n: 0, monday: m, phase: 'Progression', msg: 'Une semaine de plus dans les jambes 💪', km: 0, sessions: [] });
      byMon.get(m).sessions.push(s);
    }));
    const out = [...byMon.values()].filter(w => w.sessions.length).sort((a, b) => (a.monday < b.monday ? -1 : 1));
    out.forEach(w => { w.sessions.sort((a, b) => (a.date < b.date ? -1 : 1)); w.km = P.r05(w.sessions.reduce((s, x) => s + x.km, 0)); });
    return out;
  }
  function moveSession(id, date) {
    const s = allSessions().find(x => x.id === id);
    if (!s || date < iso(new Date())) return false;
    if (allSessions().some(x => x.id !== id && x.date === date)) { toast('Il y a déjà une séance ce jour-là 🙈'); return false; }
    S.moves[id] = date;
    S.plan.weeks = applyMoves(S.plan.weeks); save();
    return true;
  }
  function replan() {
    const today = new Date();
    const adj = P.computeAdjust(S.plan, S.done, today);
    const np = P.generatePlan(S.profile, allRuns(), today, adj);
    S.plan = mergePlan(np, today);
    S.note = adj.note;
  }
  function buildPlan() {
    S.plan = P.generatePlan(S.profile, allRuns(), new Date(), { vol: 1 });
    S.done = {}; S.note = ''; S.moves = {}; S.recap = null;
    S.base = { pred: S.plan.info.predicted, target: S.profile.goal.target || null };
  }
  function autoMatch() { // marque les séances faites d'après Strava
    let n = 0; const t = iso(new Date());
    allSessions().forEach(s => {
      if (s.date > t || isDone(s.id) || s.type === 'race') return;
      const r = S.runs.filter(x => x[0] === s.date).sort((a, b) => b[1] - a[1])[0];
      if (r && r[1] >= s.km * 0.6) { S.done[s.id] = { km: r[1], sec: r[2], auto: true }; n++; }
    });
    return n;
  }

  /* ---------- Jeu : XP, niveaux, badges ---------- */
  const TITLES = ['Petite foulée', 'Trotteuse', 'Gazelle', 'Lièvre', 'Renarde', 'Guépard', 'Fusée', 'Légende'];
  function stats() {
    const ses = allSessions().filter(s => isDone(s.id));
    let xp = 0, km = 0;
    ses.forEach(s => { const k = S.done[s.id].km || s.km; km += k; xp += Math.round(k * 10) + (['tempo', 'interval', 'racepace', 'fartlek'].includes(s.type) ? 20 : 0) + (s.type === 'race' ? 200 : 0); });
    const level = Math.floor(Math.sqrt(xp / 60)) + 1, lo = 60 * (level - 1) ** 2, hi = 60 * level ** 2;
    // série de semaines
    const t = iso(new Date()), ws = S.plan ? S.plan.weeks : [];
    let streak = 0, perfect = 0;
    ws.forEach(w => { const d = w.sessions.filter(s => isDone(s.id)).length; if (w.sessions.length && d === w.sessions.length) perfect++; });
    const past = ws.filter(w => iso(addDays(parseISO(w.monday), 6)) < t);
    for (let i = past.length - 1; i >= 0; i--) {
      const w = past[i], d = w.sessions.filter(s => isDone(s.id)).length;
      if (d >= Math.ceil(w.sessions.length * 0.75)) streak++; else break;
    }
    const cur = ws.find(w => w.monday === iso(mondayOf(new Date())));
    if (cur && cur.sessions.length && cur.sessions.every(s => isDone(s.id))) streak++;
    const life = S.runs.reduce((s, r) => s + r[1], 0);
    return { xp, km, level, lo, hi, title: TITLES[Math.min(level - 1, TITLES.length - 1)], streak, perfect, count: ses.length, ses, life };
  }
  const BADGES = [
    ['🐣', 'Première séance', s => s.count >= 1], ['🖐️', '5 séances', s => s.count >= 5], ['🎖️', '20 séances', s => s.count >= 20],
    ['👟', '50 km dans le plan', s => s.km >= 50], ['🚀', '150 km dans le plan', s => s.km >= 150],
    ['🔥', 'Série de 3 semaines', s => s.streak >= 3], ['⭐', 'Semaine parfaite', s => s.perfect >= 1],
    ['🏔️', 'Sortie longue 10 km+', s => s.ses.some(x => x.type === 'long' && (S.done[x.id].km || x.km) >= 10)],
    ['⚡', 'Première séance rapide', s => s.ses.some(x => ['interval', 'tempo', 'racepace', 'fartlek'].includes(x.type))],
    ['🏁', 'Jour J accompli', s => s.ses.some(x => x.type === 'race')],
    ['📈', '500 km Strava', s => s.life >= 500], ['🌍', '1000 km Strava', s => s.life >= 1000]
  ];
  function checkBadges() {
    const st = stats(), fresh = [];
    BADGES.forEach(b => { if (b[2](st) && !S.seen.includes(b[1])) { S.seen.push(b[1]); fresh.push(b); } });
    return fresh;
  }

  /* ---------- Utilitaires UI ---------- */
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const dFmt = (s, o) => parseISO(s).toLocaleDateString('fr-FR', o || { weekday: 'short', day: 'numeric', month: 'short' });
  let tt; function toast(m, ms) { const t = $('#toast'); t.textContent = m; t.classList.add('show'); clearTimeout(tt); tt = setTimeout(() => t.classList.remove('show'), ms || 3500); }
  function confetti() {
    const c = $('#fx'), x = c.getContext('2d'); c.width = innerWidth; c.height = innerHeight;
    const cols = ['#ff6b5b', '#ffc83d', '#37c9a0', '#4cb4ff', '#8e5bff'];
    const ps = Array.from({ length: 120 }, () => ({ x: innerWidth / 2, y: innerHeight * .6, vx: (Math.random() - .5) * 14, vy: -Math.random() * 16 - 4, r: Math.random() * 6 + 3, c: cols[Math.random() * 5 | 0], a: Math.random() * 6 }));
    let f = 0;
    (function step() {
      x.clearRect(0, 0, c.width, c.height);
      ps.forEach(p => { p.vy += .45; p.x += p.vx; p.y += p.vy; p.a += .2; x.fillStyle = p.c; x.save(); x.translate(p.x, p.y); x.rotate(p.a); x.fillRect(-p.r, -p.r / 2, p.r * 2, p.r); x.restore(); });
      if (++f < 110) requestAnimationFrame(step); else x.clearRect(0, 0, c.width, c.height);
    })();
  }
  const raceLabel = d => d == 21.1 ? 'Semi-marathon' : d == 42.2 ? 'Marathon' : d + ' km';
  const FOCUS = {
    habit: ['🌱', 'Prendre l\'habitude', 'Courir régulièrement, sans pression'],
    forme: ['😎', 'Rester en forme', 'Entretenir mon niveau tranquillement'],
    distance: ['🏔️', 'Aller plus loin', 'Augmenter peu à peu mes distances'],
    vitesse: ['⚡', 'Être plus rapide', 'Plus de fractionné et d\'allure']
  };
  const DAYN = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];

  /* ---------- Onboarding ---------- */
  function initDraft(step) {
    const g = (S.profile && S.profile.goal) || {};
    ui.D = {
      name: S.name, level: (S.profile && S.profile.level) || 'regulier', goalType: g.type || 'race', dist: g.dist || 10, date: g.date || '',
      th: g.target ? Math.floor(g.target / 3600) : '', tm: g.target ? Math.round(g.target % 3600 / 60) : '', focus: g.focus || 'habit',
      days: (S.profile && S.profile.days) || [1, 3, 5], imported: S.runs.length ? S.runs.length : 0, msg: ''
    };
    ui.step = step;
  }
  function onbView() {
    const D = ui.D, st = ui.step;
    const dots = `<div class="dots">${[0, 1, 2, 3, 4].map(i => `<i class="${i === st ? 'on' : ''}"></i>`).join('')}</div>`;
    let body = '';
    if (st === 0) body = `
      <div class="mascot">🦊</div><h1>Salut ! Moi c'est Foulée.</h1>
      <p>Je construis ton plan de course à pied sur-mesure, et je l'adapte à chaque séance. Comment tu t'appelles ?</p>
      <input type="text" data-in="name" placeholder="Ton prénom" value="${esc(D.name)}" autocomplete="given-name">
      <button class="btn" data-a="next" ${D.name.trim() ? '' : 'disabled'} id="nx">C'est parti !</button>`;
    if (st === 1) body = `
      <div class="mascot">📲</div><h1>Tes données Strava</h1>
      <p>Pour connaître ton niveau, importe l'archive de tes activités Strava (le fichier <b>.zip</b> ou <b>activities.csv</b>). Tout reste sur ton téléphone.</p>
      <label class="btn mint" style="text-align:center">📂 Importer mon export Strava
        <input type="file" id="file" accept=".zip,.csv,text/csv,application/zip" style="display:none"></label>
      ${D.msg ? `<div class="note">${esc(D.msg)}</div>` : ''}
      <details class="card"><summary>Comment récupérer mon export ?</summary>
        <p>1. Sur strava.com (navigateur) : <b>Paramètres → Mon compte → Télécharger ou supprimer votre compte → Demander votre archive</b>.<br>
        2. Tu reçois un e-mail avec un lien : télécharge le .zip.<br>
        3. Reviens ici et choisis ce fichier (sur iPhone, enregistre-le dans l'app Fichiers).</p></details>
      ${D.imported ? '' : `<p class="mute" style="margin-top:16px">Pas de Strava ou pas à portée de main ? Dis-moi juste ton niveau :</p>
      ${[['debut', '🐢', 'Je débute', 'Moins de 10 km par semaine'], ['regulier', '🐇', 'Je cours régulièrement', 'Environ 10 à 25 km par semaine'], ['confirme', '🐆', 'Je suis confirmée', 'Plus de 25 km par semaine']]
        .map(l => `<div class="choice ${D.level === l[0] ? 'on' : ''}" data-a="level" data-v="${l[0]}"><span class="e">${l[1]}</span><div><h3>${l[2]}</h3><span class="mute">${l[3]}</span></div></div>`).join('')}`}
      <button class="btn" data-a="next">Continuer</button>`;
    if (st === 2) body = `
      <div class="mascot">🎯</div><h1>Ton objectif</h1>
      <div class="choice ${D.goalType === 'race' ? 'on' : ''}" data-a="gt" data-v="race"><span class="e">🏁</span><div><h3>J'ai une course</h3><span class="mute">Un plan jusqu'au jour J</span></div></div>
      <div class="choice ${D.goalType === 'none' ? 'on' : ''}" data-a="gt" data-v="none"><span class="e">🌈</span><div><h3>Pas de course</h3><span class="mute">Un plan pour progresser à mon rythme</span></div></div>
      ${D.goalType === 'race' ? `
        <h3 style="margin-top:14px">Distance</h3>
        <div class="chips">${[5, 10, 21.1, 42.2].map(d => `<span class="chip ${D.dist == d ? 'on' : ''}" data-a="dist" data-v="${d}">${raceLabel(d)}</span>`).join('')}</div>
        <h3>Date de la course</h3><input type="date" data-in="date" value="${D.date}" min="${iso(addDays(new Date(), 2))}">
        <h3>Temps visé <span class="mute">(facultatif)</span></h3>
        <div class="row"><input type="number" inputmode="numeric" data-in="th" placeholder="h" value="${D.th}" min="0" max="9"><input type="number" inputmode="numeric" data-in="tm" placeholder="min" value="${D.tm}" min="0" max="59"></div>`
        : `<h3 style="margin-top:14px">Ton envie du moment</h3>${Object.entries(FOCUS).map(([k, f]) => `<div class="choice ${D.focus === k ? 'on' : ''}" data-a="focus" data-v="${k}"><span class="e">${f[0]}</span><div><h3>${f[1]}</h3><span class="mute">${f[2]}</span></div></div>`).join('')}`}
      <button class="btn" data-a="next">Continuer</button>`;
    if (st === 3) body = `
      <div class="mascot">📅</div><h1>Tes jours de course</h1>
      <p>Quels jours peux-tu courir ? Choisis-en 2 à 6, je m'occupe du reste.</p>
      <div class="chips">${DAYN.map((n, i) => `<span class="chip ${D.days.includes(i) ? 'on' : ''}" data-a="day" data-v="${i}">${n}</span>`).join('')}</div>
      <p class="mute">${D.days.length < 2 ? 'Choisis au moins 2 jours.' : D.days.length + ' séances par semaine, c\'est noté 👍'}</p>
      <button class="btn" data-a="next" ${D.days.length < 2 ? 'disabled' : ''}>Générer mon plan ✨</button>`;
    if (st === 4) {
      const i = S.plan.info;
      body = `<div class="mascot">🎉</div><h1>Ton plan est prêt, ${esc(S.name)} !</h1>
      <div class="card"><p>${i.hasData ? `D'après tes sorties, tu cours environ <b>${km1(i.weeklyKm)} km/semaine</b> et ton allure facile est autour de <b>${fmtPace(i.easy)}/km</b>.` : `Je pars sur ton niveau déclaré : allure facile autour de <b>${fmtPace(i.easy)}/km</b>.`}</p>
      ${S.profile.goal.type === 'race' ? `<p>Temps estimé aujourd'hui sur ${raceLabel(S.profile.goal.dist)} : <b>${fmtTime(i.predicted)}</b>.</p>` : `<p>Sur 5 km, tu pourrais viser <b>${fmtTime(i.pred[5])}</b> aujourd'hui.</p>`}
      <p class="mute">Après chaque séance, dis-moi comment c'était : je réadapte le plan pour toi.</p></div>
      ${i.warnings.map(w => `<div class="warn">⚠️ ${esc(w)}</div>`).join('')}
      <button class="btn" data-a="finish">Voir ma première séance</button>`;
    }
    const back = st > 0 && st < 4 ? `<button class="btn ghost" data-a="back">← Retour</button>` : '';
    return dots + body + back;
  }
  function genFromDraft() {
    const D = ui.D;
    S.name = D.name.trim();
    const target = D.goalType === 'race' && (+D.th || +D.tm) ? (+D.th || 0) * 3600 + (+D.tm || 0) * 60 : null;
    S.profile = { level: D.level, days: D.days.slice().sort(), goal: D.goalType === 'race' ? { type: 'race', dist: +D.dist, date: D.date, target } : { type: 'none', focus: D.focus } };
    buildPlan(); autoMatch(); save();
  }
  async function doImport(file) {
    ui.D.msg = 'Je lis ton fichier… ⏳'; render();
    try {
      const runs = await Strava.importFile(file);
      if (!runs.length) throw new Error('vide');
      S.runs = runs.map(r => [r.date, r.km, r.sec]);
      ui.D.imported = runs.length;
      const a = P.analyze(runs, new Date(), 'regulier');
      ui.D.msg = `J'ai trouvé ${runs.length} courses ! 🎉 Sur les 6 dernières semaines : ${a.hasData ? km1(a.weeklyKm) + ' km/semaine, allure facile ~' + fmtPace(a.easy) + '/km.' : 'peu d\'activité récente, on repart doucement.'}`;
      save();
    } catch (e) {
      ui.D.msg = 'Je n\'ai pas trouvé de courses dans ce fichier. Vérifie que c\'est bien l\'export Strava (.zip ou activities.csv).';
    }
    render();
  }

  /* ---------- Écrans principaux ---------- */
  function sessLine(s, today) {
    const d = S.done[s.id], done = isDone(s.id), missed = !done && s.date < today;
    return `<div class="sess ${done ? 'done' : ''} ${missed ? 'missed' : ''} ${s.date === today ? 'today' : ''}" data-a="open" data-id="${s.id}">
      <span class="e">${s.emoji}</span><div class="t"><b>${s.title}</b><br><span class="mute">${dFmt(s.date)} · ${km1(s.km)} km${d && d.skipped ? ' · passée' : ''}${S.moves[s.id] && S.moves[s.id] === s.date ? ' · décalée 📆' : ''}</span></div>
      <span class="ck">${done ? '✓' : ''}</span></div>`;
  }
  function todayView() {
    const st = stats(), today = iso(new Date()), ses = allSessions();
    const pending = ses.filter(s => !isDone(s.id) && !(S.done[s.id] && S.done[s.id].skipped));
    const todays = ses.find(s => s.date === today && !isDone(s.id) && !(S.done[s.id] && S.done[s.id].skipped));
    const next = todays || pending.find(s => s.date > today);
    const g = S.profile.goal, hr = new Date().getHours();
    let h = `<div class="hero"><div class="row"><div><span class="pill">${st.title} · niv. ${st.level}</span><h1 style="margin-top:10px">${hr < 18 ? 'Salut' : 'Bonsoir'} ${esc(S.name)} !</h1>
      <span class="mute">${st.streak ? `🔥 ${st.streak} semaine${st.streak > 1 ? 's' : ''} d'affilée` : 'Prête pour une nouvelle série ?'}</span></div><div class="mascot" style="flex:0">🦊</div></div>
      <div class="bar"><b style="width:${Math.round((st.xp - st.lo) / (st.hi - st.lo) * 100)}%"></b></div>
      <span class="mute">${st.xp} XP · prochain niveau à ${st.hi}</span></div>`;
    if (g.type === 'race') {
      const days = Math.round((parseISO(g.date) - parseISO(today)) / 864e5);
      if (days >= 0) h += `<div class="card"><b>🏁 ${raceLabel(g.dist)}</b> — ${days === 0 ? 'c\'est aujourd\'hui !' : `J-${days}`}</div>`;
    }
    if (S.note) h += `<div class="note">🧠 <b>Plan ajusté :</b> ${esc(S.note)}</div>`;
    const age = backupAge();
    if (st.count >= 3 && (age === null || age > 30)) h += `<div class="note">💾 Pense à <b>sauvegarder tes données</b> (onglet Moi) pour ne rien perdre.</div>`;
    if (next) {
      h += `<h2>${next.date === today ? 'Aujourd\'hui' : 'Prochaine séance · ' + dFmt(next.date)}</h2>${bigSession(next)}`;
    } else {
      h += `<div class="card"><div class="mascot">🏆</div><h2>Plan terminé !</h2><p>Bravo, tu as été au bout. On repart sur un nouveau plan ?</p>${S.recap ? '<button class="btn alt" data-a="recap">🏁 Voir mon bilan de course</button>' : ''}<button class="btn" data-a="newgoal">Nouveau plan</button></div>`;
    }
    if (!todays && next && next.date > today) h += `<div class="card">😴 Pas de séance aujourd'hui : profite de ta récup !</div>`;
    const late = ses.filter(s => s.date < today && !S.done[s.id]).slice(-2);
    if (late.length) h += `<h2>À rattraper (si tu veux)</h2>` + late.map(s => sessLine(s, today)).join('');
    return h;
  }
  function bigSession(s) {
    const done = isDone(s.id), d = S.done[s.id];
    return `<div class="big-session"><div class="row"><span class="e" style="flex:0">${s.emoji}</span><div><h2 style="margin:0">${s.title}</h2><span class="mute">${dFmt(s.date)}</span></div></div>
      <div class="kv"><span>📏 ${km1(s.km)} km</span><span>⏱️ ~${s.mins} min</span><span>🎚️ ${fmtPace(s.pace)}/km</span></div>
      ${done ? '' : wxBlock(s.date)}<p>${esc(s.desc)}</p>
      ${done ? `<p><b>✅ Fait${d.km ? ' — ' + km1(d.km) + ' km' : ''}${d.feel ? ' · ' + ['', '😄 facile', '🙂 bien', '😮‍💨 dur'][d.feel] : ''}</b></p>
        <button class="btn alt" data-a="undo" data-id="${s.id}">Annuler</button>`
        : `<button class="btn" data-a="log" data-id="${s.id}">C'est fait ! ✅</button>
        <div class="row"><button class="btn alt" data-a="timer" data-id="${s.id}">▶ Séance guidée</button>
        ${s.type !== 'race' ? `<button class="btn alt" data-a="move" data-id="${s.id}">📆 Décaler</button>` : ''}</div>
        ${wxBad(s.date) && s.type !== 'race' ? `<button class="btn alt" data-a="bestday" data-id="${s.id}">🌤️ Décaler au meilleur jour</button>` : ''}
        <button class="btn ghost" data-a="skip" data-id="${s.id}">Je la passe</button>`}</div>`;
  }
  function planView() {
    const today = iso(new Date()), cm = iso(mondayOf(new Date()));
    const i = S.plan.info, g = S.profile.goal;
    let h = `<h1>Mon plan</h1><p class="mute">${g.type === 'race' ? '🏁 ' + raceLabel(g.dist) + ' le ' + dFmt(g.date, { day: 'numeric', month: 'long', year: 'numeric' }) : '🌈 ' + FOCUS[g.focus][1]} · ${S.profile.days.length} séances/semaine</p>`;
    S.plan.weeks.forEach((w, k) => {
      const open = ui.open === null ? w.monday === cm || (k === 0 && w.monday > cm) : ui.open === w.monday;
      const nd = w.sessions.filter(s => isDone(s.id)).length;
      h += `<div class="card"><div class="week-h" data-a="week" data-id="${w.monday}"><div><h3>${w.phase}</h3><span class="mute">Sem. du ${dFmt(w.monday, { day: 'numeric', month: 'short' })} · ${km1(w.km)} km</span></div><span class="pill c">${nd}/${w.sessions.length} ${open ? '▾' : '▸'}</span></div>
        ${open ? `<p class="mute">${w.msg}</p>` + w.sessions.map(s => sessLine(s, today)).join('') : ''}</div>`;
    });
    return h;
  }
  function chart() {
    const t = new Date(), m0 = mondayOf(t), W = 10, vals = [], plan = [];
    const done = {};
    Object.entries(S.done).forEach(([id, d]) => { if (!d.skipped) done[dateOf(id)] = d.km; });
    const runDates = new Set(S.runs.map(r => r[0]));
    for (let k = W - 1; k >= 0; k--) {
      const a = addDays(m0, -7 * k), b = iso(addDays(a, 6)), ai = iso(a);
      let v = S.runs.filter(r => r[0] >= ai && r[0] <= b).reduce((s, r) => s + r[1], 0);
      Object.entries(done).forEach(([id, km]) => { if (id >= ai && id <= b && !runDates.has(id)) v += km; });
      vals.push({ l: dFmt(ai, { day: 'numeric', month: 'numeric' }), v });
      const pw = S.plan.weeks.find(w => w.monday === ai); plan.push(pw ? pw.km : 0);
    }
    const mx = Math.max(10, ...vals.map(x => x.v), ...plan), bw = 28;
    return `<svg viewBox="0 0 340 150" width="100%">${vals.map((x, k) => {
      const hh = x.v / mx * 100, ph = plan[k] / mx * 100, X = 10 + k * 33;
      return `${plan[k] ? `<rect x="${X}" y="${115 - ph}" width="${bw}" height="${ph}" rx="6" fill="none" stroke="#8e5bff" stroke-width="1.5" stroke-dasharray="3 3"/>` : ''}
        <rect x="${X}" y="${115 - hh}" width="${bw}" height="${hh}" rx="6" fill="#ff6b5b" opacity=".9"/>
        ${x.v ? `<text x="${X + bw / 2}" y="${110 - hh}" text-anchor="middle">${Math.round(x.v)}</text>` : ''}
        <text x="${X + bw / 2}" y="132" text-anchor="middle">${x.l}</text>`;
    }).join('')}</svg>`;
  }
  function progressView() {
    const st = stats(), i = S.plan.info, g = S.profile.goal;
    let h = `<h1>Mes progrès</h1><div class="stat"><div><b>${st.count}</b><span>séances faites</span></div><div><b>${Math.round(st.km)}</b><span>km dans le plan</span></div><div><b>${st.streak}🔥</b><span>semaines d'affilée</span></div></div>
      <div class="card"><h3>Kilomètres par semaine</h3><p class="mute">Orange = réalisé · pointillés violets = prévu</p>${chart()}</div>
      <div class="card"><h3>Mes chronos estimés</h3><div class="kv">${[[5, '5 km'], [10, '10 km'], [21.1, 'Semi'], [42.2, 'Marathon']].map(r => `<span>${r[1]} : ${fmtTime(i.pred[r[0]])}</span>`).join('')}</div>
      <p class="mute">Estimations d'après tes dernières sorties, mises à jour à chaque adaptation.</p></div>
      ${S.recap ? `<div class="card"><h3>🏁 Mon bilan de course</h3><p class="mute">${recapText()}</p><button class="btn alt" data-a="recap">Voir le bilan</button></div>` : ''}
      <h2>Mes badges</h2><div class="badges">${BADGES.map(b => `<div class="badge ${b[2](st) ? '' : 'off'}"><span class="e">${b[0]}</span>${b[1]}</div>`).join('')}</div>`;
    return h;
  }
  function meView() {
    return `<h1>Moi</h1><div class="card"><h3>${esc(S.name)}</h3><p class="mute">${S.runs.length ? S.runs.length + ' courses Strava importées' : 'Pas de données Strava'}</p></div>
      <div class="card"><h3>Mettre à jour mes données</h3><p class="mute">Réimporte un export Strava récent : je marque tes séances faites et j'ajuste le plan.</p>
        <label class="btn mint" style="text-align:center">📂 Importer un export Strava<input type="file" id="file2" accept=".zip,.csv,text/csv,application/zip" style="display:none"></label></div>
      <div class="card"><h3>🌦️ Météo</h3><p class="mute">${S.geo ? 'Position : ' + esc(S.geo.name) + '.' : 'Pour des conseils chaleur/pluie et le meilleur créneau de course.'}</p>
        <div class="row"><input type="text" id="city" placeholder="Ma ville"><button class="btn small" data-a="geocity" style="flex:0">OK</button></div>
        <button class="btn alt" data-a="geoloc">📍 Utiliser ma position</button></div>
      <div class="card"><h3>💾 Sauvegarde</h3><p class="mute">${backupAge() === null ? 'Jamais sauvegardé.' : 'Dernière sauvegarde il y a ' + backupAge() + ' jour(s).'} Garde le fichier dans Fichiers ou iCloud pour restaurer si besoin.</p>
        <button class="btn alt" data-a="export">📤 Exporter mes données</button>
        <label class="btn alt" style="text-align:center">📥 Restaurer une sauvegarde<input type="file" id="bk" accept=".json,application/json" style="display:none"></label></div>
      <button class="btn alt" data-a="replan">🧠 Réadapter mon plan maintenant</button>
      <button class="btn alt" data-a="newgoal">🎯 Changer d'objectif / de jours</button>
      <button class="btn ghost" data-a="reset">Tout effacer</button>
      <p class="mute" style="text-align:center">Astuce iPhone : dans Safari, touche Partager → « Sur l'écran d'accueil » pour avoir l'app comme une vraie application.</p>`;
  }
  function sheetView() {
    const sh = ui.sheet; if (!sh) return '';
    if (sh.kind === 'recap') return `<div class="sheet-bg" data-a="closesheet"><div class="sheet" data-stop>${recapView()}</div></div>`;
    const s = allSessions().find(x => x.id === sh.id);
    if (!s) return '';
    if (sh.kind === 'move') {
      const days = Array.from({ length: 10 }, (_, i) => iso(addDays(new Date(), i)));
      return `<div class="sheet-bg" data-a="closesheet"><div class="sheet" data-stop><h2 style="margin-top:0">📆 Décaler « ${s.title} »</h2>
        <p class="mute">Choisis un nouveau jour. • = il y a déjà une séance.</p>
        <div class="chips">${days.map(d => { const occ = allSessions().some(x => x.id !== s.id && x.date === d), w = wxDay(d);
          return `<span class="chip ${d === s.date ? 'on' : ''} ${occ ? 'dim' : ''}" data-a="moveto" data-id="${s.id}" data-v="${d}">${dFmt(d, { weekday: 'short', day: 'numeric' })}${w ? ' ' + WX_ICON(w.code) + w.tmax + '°' : ''}${occ ? ' •' : ''}</span>`; }).join('')}</div>
        ${S.wx ? `<button class="btn alt" data-a="bestday" data-id="${s.id}">🌤️ Choisir le meilleur jour (météo)</button>` : '<p class="mute">Renseigne ta ville dans « Moi » pour voir la météo ici.</p>'}
        <button class="btn ghost" data-a="closesheet">Annuler</button></div></div>`;
    }
    if (sh.kind === 'detail') return `<div class="sheet-bg" data-a="closesheet"><div class="sheet" data-stop>${bigSession(s)}<button class="btn ghost" data-a="closesheet">Fermer</button></div></div>`;
    return `<div class="sheet-bg" data-a="closesheet"><div class="sheet" data-stop><h2 style="margin-top:0">${s.emoji} Bravo ! Raconte-moi</h2>
      <div class="row"><div><span class="mute">Distance (km)</span><input type="number" inputmode="decimal" step="0.1" id="lk" value="${s.km}"></div>
      ${(() => { const m0 = sh.min != null ? sh.min : s.mins;
        return s.type === 'race'
          ? `<div><span class="mute">Temps (h · min · s)</span><div class="row"><input type="number" inputmode="numeric" id="lh" value="${Math.floor(m0 / 60)}"><input type="number" inputmode="numeric" id="lm" value="${m0 % 60}"><input type="number" inputmode="numeric" id="ls" value="0"></div></div>`
          : `<div><span class="mute">Durée (min)</span><input type="number" inputmode="numeric" id="lm" value="${m0}"></div>`; })()}</div>
      <span class="mute">C'était comment ?</span>
      <div class="feel">${[[1, '😄', 'Facile'], [2, '🙂', 'Bien'], [3, '😮‍💨', 'Dur']].map(f => `<button data-a="feel" data-v="${f[0]}" class="${sh.feel === f[0] ? 'on' : ''}">${f[1]}<small>${f[2]}</small></button>`).join('')}</div>
      <p class="mute">Ces infos me servent à adapter la suite de ton plan.</p>
      <button class="btn" data-a="savelog" data-id="${s.id}">Valider ✅</button><button class="btn ghost" data-a="closesheet">Annuler</button></div></div>`;
  }

  /* ---------- Météo (Open-Meteo, sans clé) ---------- */
  const WX_ICON = c => c === 0 ? '☀️' : c <= 2 ? '🌤️' : c === 3 ? '☁️' : c <= 48 ? '🌫️' : c <= 67 ? '🌧️' : c <= 77 ? '❄️' : c <= 82 ? '🌦️' : '⛈️';
  async function fetchWx(force) {
    const g = S.geo; if (!g || !navigator.onLine) return;
    const key = g.lat + ',' + g.lon;
    if (!force && S.wx && S.wx.key === key && Date.now() - S.wx.at < 3 * 36e5) return;
    try {
      const u = `https://api.open-meteo.com/v1/forecast?latitude=${g.lat}&longitude=${g.lon}&hourly=temperature_2m,precipitation_probability,wind_speed_10m&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max,wind_speed_10m_max,weather_code&timezone=auto&forecast_days=7`;
      const j = await (await fetch(u)).json(), days = {};
      j.daily.time.forEach((d, i) => {
        let best = null, bs = 1e9;
        j.hourly.time.forEach((h, k) => {
          if (!h.startsWith(d)) return;
          const hr = +h.slice(11, 13); if (hr < 6 || hr > 21) return;
          const t = j.hourly.temperature_2m[k], pp = j.hourly.precipitation_probability[k] || 0, w = j.hourly.wind_speed_10m[k];
          const sc = Math.max(0, t - 16) * 1.5 + Math.max(0, 6 - t) + pp * .1 + Math.max(0, w - 20) * .3 + (hr < 7 || hr > 20 ? 1.5 : 0);
          if (sc < bs) { bs = sc; best = { h: hr, t: Math.round(t) }; }
        });
        days[d] = { tmax: Math.round(j.daily.temperature_2m_max[i]), tmin: Math.round(j.daily.temperature_2m_min[i]), pp: j.daily.precipitation_probability_max[i] || 0, wind: Math.round(j.daily.wind_speed_10m_max[i]), code: j.daily.weather_code[i], best };
      });
      S.wx = { at: Date.now(), key, days }; save();
      if (!TM && ui.step === null && !ui.sheet && ui.tab !== 'me') render();
    } catch (e) { }
  }
  const wxDay = date => S.wx && S.wx.days && S.wx.days[date];
  const wxBad = date => { const d = wxDay(date); return !!d && (d.code >= 95 || d.tmax >= 30 || d.pp >= 80 || d.wind >= 45); };
  const wxScore = d => Math.max(0, d.tmax - 18) * 1.5 + Math.max(0, 3 - d.tmin) * 1.5 + d.pp * .08 + Math.max(0, d.wind - 20) * .2 + (d.code >= 95 ? 30 : 0);
  function wxBlock(date) {
    const d = wxDay(date); if (!d) return '';
    const a = [], slow = Math.round(Math.max(0, d.tmax - 15) * 2.5);
    if (d.code >= 95) a.push('⛈️ Orage possible : décale la séance ou cours à l\'intérieur.');
    if (d.tmax >= 28) a.push(`🥵 Très chaud : ralentis d'environ ${slow} s/km, cours tôt ou tard, bois avant et pendant.`);
    else if (d.tmax >= 22) a.push(`🌡️ Chaud : compte environ ${slow} s/km plus lent que d'habitude et pense à t'hydrater.`);
    if (d.tmin <= 2) a.push('🥶 Il gèle : échauffe-toi plus longtemps, habille-toi en couches, attention au verglas.');
    if (d.pp >= 60 && d.code < 95) a.push(`🌧️ Pluie probable (${d.pp} %) : veste légère, casquette, chaussures qui accrochent.`);
    if (d.wind >= 35) a.push('💨 Vent fort : pars face au vent, rentre vent dans le dos.');
    if (!a.length) a.push('😎 Conditions idéales, profites-en !');
    return `<div class="note"><b>${WX_ICON(d.code)} ${d.tmin}° / ${d.tmax}° · pluie ${d.pp} % · vent ${d.wind} km/h</b>${d.best ? `<br>⏰ Meilleur créneau : ${d.best.h} h (~${d.best.t}°)` : ''}<br>${a.join('<br>')}</div>`;
  }

  /* ---------- Minuteur guidé + métronome ---------- */
  let TM = null, AC = null, WL = null;
  const tmEl = document.createElement('div'); tmEl.id = 'timer'; document.body.appendChild(tmEl);
  const actx = () => { AC = AC || new (window.AudioContext || window.webkitAudioContext)(); if (AC.state === 'suspended') AC.resume(); return AC; };
  function tone(f, d, v) {
    try { const c = actx(), o = c.createOscillator(), g = c.createGain(); o.frequency.value = f; g.gain.value = v || .25; o.connect(g); g.connect(c.destination); o.start(); o.stop(c.currentTime + d); } catch (e) { }
  }
  const beep = (f, d) => { if (TM && TM.sound) tone(f, d); };
  const say = t => { if (TM && TM.voice && window.speechSynthesis) { try { const u = new SpeechSynthesisUtterance(t.replace(/·.*/, '')); u.lang = 'fr-FR'; speechSynthesis.cancel(); speechSynthesis.speak(u); } catch (e) { } } };
  const mmss = s => { s = Math.max(0, Math.ceil(s)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
  async function wake() { try { if (navigator.wakeLock) WL = await navigator.wakeLock.request('screen'); } catch (e) { } }
  document.addEventListener('visibilitychange', () => { if (TM && document.visibilityState === 'visible') wake(); });
  function openTimer(id) {
    const s = allSessions().find(x => x.id === id); if (!s) return;
    const steps = s.steps && s.steps.length ? s.steps : [{ k: 'run', t: s.title, s: Math.max(60, (s.mins || 20) * 60) }];
    TM = { id, steps, i: 0, left: steps[0].s, total: 0, last: Date.now(), paused: false, sound: true, voice: true, metro: false, cad: 170, lb: null };
    actx(); wake();
    tmEl.innerHTML = `<div class="tm-top"><span id="tm-step"></span><button data-t="quit">✕</button></div>
      <div id="tm-label"></div><div id="tm-big">0:00</div><div id="tm-next"></div>
      <div class="tm-bar"><b id="tm-bar"></b></div><div id="tm-total"></div>
      <div class="tm-ctl"><button data-t="prev">⏮</button><button data-t="pause" id="tm-pause">⏸</button><button data-t="skip">⏭</button></div>
      <div class="tm-opts"><button data-t="sound" id="tm-snd">🔔 Sons</button><button data-t="voice" id="tm-voi">🗣️ Voix</button></div>
      <div class="tm-opts"><button data-t="metro" id="tm-met">🥁 Cadence</button><button data-t="cad-">−</button><b id="tm-cad">170</b><button data-t="cad+">+</button></div>
      <small>Garde l'écran allumé pendant la séance 📱</small>`;
    tmEl.style.display = 'flex';
    TM.iv = setInterval(tickTimer, 250);
    beep(880, .3); say(steps[0].t); drawTimer();
  }
  function tickTimer() {
    if (!TM || TM.paused) return;
    const now = Date.now(), dt = (now - TM.last) / 1000; TM.last = now; TM.left -= dt; TM.total += dt;
    let changed = false, g = 0;
    while (TM.left <= 0 && g++ < 60) {
      if (TM.i >= TM.steps.length - 1) return finishTimer(true);
      TM.i++; TM.left += TM.steps[TM.i].s; changed = true;
    }
    if (changed) { TM.lb = null; beep(880, .35); say(TM.steps[TM.i].t); }
    else { const c = Math.ceil(TM.left); if (c <= 3 && c !== TM.lb) { TM.lb = c; beep(660, .1); } }
    drawTimer();
  }
  function drawTimer() {
    const st = TM.steps[TM.i], nx = TM.steps[TM.i + 1], $$ = id => document.getElementById(id);
    tmEl.dataset.k = st.k;
    $$('tm-step').textContent = `Étape ${TM.i + 1}/${TM.steps.length}`;
    $$('tm-label').textContent = st.t; $$('tm-big').textContent = mmss(TM.left);
    $$('tm-next').textContent = nx ? `Ensuite : ${nx.t} (${mmss(nx.s)})` : 'Dernière étape 🏁';
    $$('tm-bar').style.width = Math.round((1 - TM.left / st.s) * 100) + '%';
    $$('tm-total').textContent = `Temps écoulé ${mmss(TM.total)}`;
    $$('tm-pause').textContent = TM.paused ? '▶' : '⏸';
    $$('tm-snd').style.opacity = TM.sound ? 1 : .4; $$('tm-voi').style.opacity = TM.voice ? 1 : .4;
    $$('tm-met').style.opacity = TM.metro ? 1 : .4; $$('tm-cad').textContent = TM.cad;
  }
  function metro() {
    clearInterval(TM.mi);
    if (TM.metro && !TM.paused) TM.mi = setInterval(() => tone(1100, .03, .12), 60000 / TM.cad);
  }
  function finishTimer(completed) {
    const id = TM.id, min = Math.max(1, Math.round(TM.total / 60));
    clearInterval(TM.iv); clearInterval(TM.mi); try { WL && WL.release(); } catch (e) { }
    if (completed) { beep(880, .2); setTimeout(() => beep(1100, .2), 250); setTimeout(() => beep(1320, .4), 500); say('Bravo, séance terminée !'); }
    TM = null; tmEl.style.display = 'none';
    if (completed) { ui.sheet = { kind: 'log', id, feel: 2, min }; render(); }
  }
  tmEl.addEventListener('click', e => {
    const b = e.target.closest('[data-t]'); if (!b || !TM) return;
    const t = b.dataset.t, N = TM.steps.length;
    if (t === 'quit') { if (confirm('Arrêter la séance guidée ?')) finishTimer(false); return; }
    if (t === 'pause') { TM.paused = !TM.paused; TM.last = Date.now(); metro(); }
    if (t === 'skip') { if (TM.i >= N - 1) return finishTimer(true); TM.i++; TM.left = TM.steps[TM.i].s; TM.lb = null; beep(880, .3); say(TM.steps[TM.i].t); }
    if (t === 'prev') { TM.i = Math.max(0, TM.i - 1); TM.left = TM.steps[TM.i].s; TM.lb = null; }
    if (t === 'sound') TM.sound = !TM.sound;
    if (t === 'voice') TM.voice = !TM.voice;
    if (t === 'metro') { TM.metro = !TM.metro; metro(); }
    if (t === 'cad-' || t === 'cad+') { TM.cad = Math.max(140, Math.min(200, TM.cad + (t === 'cad+' ? 2 : -2))); metro(); }
    drawTimer();
  });

  /* ---------- Bilan de course ---------- */
  const fmtHMS = s => { s = Math.round(s); const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), x = s % 60, p = n => String(n).padStart(2, '0'); return h ? `${h}h${p(m)}'${p(x)}"` : `${m}'${p(x)}"`; };
  function makeRecap(s, d) {
    const st = stats(), b = S.base || {}, p5 = d.sec > 0 ? d.sec * Math.pow(5 / s.km, 1.06) / 5 : null;
    S.recap = {
      date: s.date, dist: s.km, sec: d.sec || 0, feel: d.feel, pred: b.pred || null, target: b.target || null,
      count: st.count, km: Math.round(st.km), weeks: S.plan.weeks.length,
      newPred: p5 ? [5, 10, 21.1, 42.2].map(x => [x, P.predict(p5, x)]) : null
    };
  }
  function recapText() {
    const r = S.recap; return `🏁 ${raceLabel(r.dist)}${r.sec ? ' en ' + fmtHMS(r.sec) + ' (' + fmtPace(r.sec / r.dist) + '/km)' : ''} — préparée avec Foulée 🦊`;
  }
  function recapView() {
    const r = S.recap; let head = 'Course terminée !', lines = '';
    if (r.sec) {
      const diff = (a, b) => `${a <= b ? '−' : '+'}${fmtHMS(Math.abs(a - b))}`;
      if (r.target) { head = r.sec <= r.target ? 'Objectif atteint ! 🎉' : r.sec <= r.target * 1.03 ? 'À un cheveu de ton objectif 💪' : 'Belle course, tu as une base solide 👏'; lines += `<p>🎯 Objectif ${fmtHMS(r.target)} → <b>${diff(r.sec, r.target)}</b></p>`; }
      else if (r.pred) head = r.sec < r.pred ? 'Mieux que prévu ! 🚀' : 'Course solide 👏';
      if (r.pred) lines += `<p>🔮 Prévu au départ : ${fmtHMS(r.pred)} → <b>${diff(r.sec, r.pred)}</b></p>`;
    }
    return `<div style="text-align:center"><div class="mascot">🏁</div><h2>${head}</h2>
      ${r.sec ? `<h1>${fmtHMS(r.sec)}</h1><p class="mute">${raceLabel(r.dist)} · ${fmtPace(r.sec / r.dist)}/km</p>` : `<p class="mute">${raceLabel(r.dist)}</p>`}</div>
      <div class="card">${lines}<p>📅 ${r.count} séances · ${r.km} km · ${r.weeks} semaines de préparation</p></div>
      ${r.newPred ? `<div class="card"><h3>Mes nouveaux chronos estimés</h3><div class="kv">${r.newPred.map(p => `<span>${raceLabel(p[0])} : ${fmtTime(p[1])}</span>`).join('')}</div></div>` : ''}
      <button class="btn" data-a="sharerecap">📤 Partager</button>
      <button class="btn alt" data-a="newgoal">🎯 Choisir le prochain objectif</button>
      <button class="btn ghost" data-a="closesheet">Fermer</button>`;
  }

  /* ---------- Sauvegarde ---------- */
  function exportData() {
    const name = `foulee-sauvegarde-${iso(new Date())}.json`;
    S.lastBackup = Date.now(); save();
    const file = new File([JSON.stringify(S)], name, { type: 'application/json' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) navigator.share({ files: [file], title: 'Sauvegarde Foulée' }).catch(() => { });
    else { const a = document.createElement('a'); a.href = URL.createObjectURL(file); a.download = name; document.body.appendChild(a); a.click(); a.remove(); }
  }
  async function importBackup(f) {
    try {
      const o = JSON.parse(await f.text());
      if (!o || o.v !== 1 || !o.profile || !o.plan) throw 0;
      if (!confirm('Remplacer toutes tes données actuelles par cette sauvegarde ?')) return;
      S = Object.assign(fresh(), o); save(); ui.step = null; ui.tab = 'today'; render(); toast('Sauvegarde restaurée ✅'); fetchWx();
    } catch (e) { toast('Ce fichier n\'est pas une sauvegarde Foulée 😕'); }
  }
  const backupAge = () => S.lastBackup ? Math.floor((Date.now() - S.lastBackup) / 864e5) : null;

  /* ---------- Rendu ---------- */
  function render() {
    if (ui.step !== null) { app.innerHTML = onbView(); wire(); return; }
    const v = { today: todayView, plan: planView, prog: progressView, me: meView }[ui.tab]();
    const nav = [['today', '🏠', 'Aujourd\'hui'], ['plan', '📅', 'Plan'], ['prog', '📈', 'Progrès'], ['me', '🦊', 'Moi']]
      .map(n => `<button class="${ui.tab === n[0] ? 'on' : ''}" data-a="tab" data-v="${n[0]}"><i>${n[1]}</i>${n[2]}</button>`).join('');
    app.innerHTML = v + `<div class="nav">${nav}</div>` + sheetView();
    wire();
  }
  function wire() {
    const f1 = $('#file'), f2 = $('#file2');
    if (f1) f1.onchange = e => e.target.files[0] && doImport(e.target.files[0]);
    if (f2) f2.onchange = async e => {
      const f = e.target.files[0]; if (!f) return;
      try {
        const runs = await Strava.importFile(f); if (!runs.length) throw 0;
        S.runs = runs.map(r => [r.date, r.km, r.sec]); const n = autoMatch(); replan(); save(); render();
        toast(`${runs.length} courses lues, ${n} séance(s) validée(s) automatiquement 🎉`);
      } catch (x) { toast('Fichier non reconnu 😕'); }
    };
    const f3 = $('#bk'); if (f3) f3.onchange = e => e.target.files[0] && importBackup(e.target.files[0]);
    app.querySelectorAll('[data-in]').forEach(el => el.oninput = () => {
      ui.D[el.dataset.in] = el.value;
      if (el.dataset.in === 'name') { const b = $('#nx'); if (b) b.disabled = !el.value.trim(); }
    });
  }

  app.addEventListener('click', e => {
    if (e.target.closest('[data-stop]') && !e.target.closest('[data-a]:not(.sheet-bg)')) return;
    const el = e.target.closest('[data-a]'); if (!el) return;
    if (el.classList.contains('sheet-bg') && e.target.closest('[data-stop]')) return;
    const a = el.dataset.a, v = el.dataset.v, id = el.dataset.id, D = ui.D;
    switch (a) {
      case 'next':
        if (ui.step === 2 && D.goalType === 'race' && (!D.date || D.date <= iso(new Date()))) return toast('Choisis la date de ta course 📅');
        if (ui.step === 3) { genFromDraft(); ui.step = 4; } else ui.step++;
        break;
      case 'back': ui.step--; break;
      case 'level': D.level = v; break;
      case 'gt': D.goalType = v; break;
      case 'dist': D.dist = +v; break;
      case 'focus': D.focus = v; break;
      case 'day': { const i = +v; D.days = D.days.includes(i) ? D.days.filter(x => x !== i) : D.days.concat(i); break; }
      case 'finish': ui.step = null; ui.tab = 'today'; ui.D = null; checkBadges(); save(); break;
      case 'tab': ui.tab = v; ui.open = null; window.scrollTo(0, 0); break;
      case 'week': ui.open = ui.open === id ? '-' : id; break;
      case 'open': ui.sheet = { kind: 'detail', id }; break;
      case 'closesheet': ui.sheet = null; break;
      case 'log': ui.sheet = { kind: 'log', id, feel: 2 }; break;
      case 'feel': ui.sheet.feel = +v; break;
      case 'savelog': {
        const km = parseFloat($('#lk').value.replace(',', '.')) || 0, min = parseFloat($('#lm').value) || 0;
        const sec = $('#lh') ? (+$('#lh').value || 0) * 3600 + min * 60 + (+$('#ls').value || 0) : Math.round(min * 60);
        S.done[id] = { km, sec, feel: ui.sheet.feel, at: Date.now() };
        const sess = allSessions().find(x => x.id === id);
        ui.sheet = null; replan();
        const nb = checkBadges();
        if (sess && sess.type === 'race') { makeRecap(sess, S.done[id]); ui.sheet = { kind: 'recap' }; }
        save(); confetti();
        toast(nb.length ? `${nb[0][0]} Badge débloqué : ${nb[0][1]} !` : S.note ? 'Séance enregistrée — plan ajusté 🧠' : 'Séance enregistrée ! +XP 💪');
        break;
      }
      case 'skip': S.done[id] = { skipped: true }; replan(); save(); toast('Pas de souci, on continue 🙂'); break;
      case 'undo': delete S.done[id]; ui.sheet = null; replan(); save(); break;
      case 'replan': replan(); save(); toast(S.note || 'Plan à jour, rien à changer 👌'); ui.tab = 'today'; break;
      case 'timer': ui.sheet = null; openTimer(id); break;
      case 'move': ui.sheet = { kind: 'move', id }; break;
      case 'moveto': if (moveSession(id, v)) { ui.sheet = null; toast('Séance décalée au ' + dFmt(v, { weekday: 'long', day: 'numeric', month: 'long' }) + ' 📆'); } break;
      case 'bestday': {
        const s = allSessions().find(x => x.id === id), t = iso(new Date());
        const c = Object.keys((S.wx && S.wx.days) || {}).filter(d => d >= t && d !== s.date && !allSessions().some(x => x.id !== id && x.date === d)).sort((a, b) => wxScore(S.wx.days[a]) - wxScore(S.wx.days[b]));
        if (!c.length) { toast('Pas de météo disponible pour décaler 🤷'); break; }
        if (moveSession(id, c[0])) { ui.sheet = null; toast('Décalée au ' + dFmt(c[0], { weekday: 'long', day: 'numeric', month: 'long' }) + ' — meilleure météo 🌤️'); }
        break;
      }
      case 'recap': ui.sheet = { kind: 'recap' }; break;
      case 'sharerecap': {
        const txt = recapText();
        if (navigator.share) navigator.share({ text: txt }).catch(() => { });
        else if (navigator.clipboard) navigator.clipboard.writeText(txt).then(() => toast('Copié ! Colle-le où tu veux 📋'));
        break;
      }
      case 'export': exportData(); toast('Sauvegarde prête 💾'); break;
      case 'geoloc':
        if (!navigator.geolocation) { toast('Position indisponible'); break; }
        navigator.geolocation.getCurrentPosition(p => { S.geo = { lat: +p.coords.latitude.toFixed(2), lon: +p.coords.longitude.toFixed(2), name: 'ma position' }; save(); fetchWx(true); toast('Position enregistrée 📍'); if (ui.tab === 'me') render(); }, () => toast('Position refusée, essaie avec ta ville 🏙️'));
        break;
      case 'geocity': {
        const q = ($('#city').value || '').trim(); if (!q) break;
        fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=1&language=fr`).then(r => r.json()).then(j => {
          const r = j.results && j.results[0]; if (!r) return toast('Ville introuvable 🤔');
          S.geo = { lat: +r.latitude.toFixed(2), lon: +r.longitude.toFixed(2), name: r.name }; save(); fetchWx(true); toast(r.name + ' enregistrée 🌦️'); render();
        }).catch(() => toast('Pas de connexion 📡'));
        break;
      }
      case 'newgoal': initDraft(2); break;
      case 'reset': if (confirm('Effacer toutes tes données et ton plan ?')) { S = fresh(); localStorage.removeItem(KEY); initDraft(0); } break;
    }
    if (a !== 'next' || ui.step !== 4) save();
    render();
  });

  if (ui.step !== null) initDraft(ui.step);
  render();
  fetchWx();
  try { navigator.storage && navigator.storage.persist && navigator.storage.persist(); } catch (e) { }
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('sw.js').catch(() => { });
})();
