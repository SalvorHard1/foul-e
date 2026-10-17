/* Moteur de plan d'entraînement — script classique (marche aussi en file://) */
(function (G) {
  const DAY = 864e5;
  const pad = n => String(n).padStart(2, '0');
  const iso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const parseISO = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
  const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
  const wdIdx = d => (d.getDay() + 6) % 7; // lundi = 0
  const mondayOf = d => addDays(d, -wdIdx(d));
  const fmtPace = s => { s = Math.round(s); return `${Math.floor(s / 60)}:${pad(s % 60)}`; };
  const fmtTime = s => {
    s = Math.round(s); const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), x = s % 60;
    return h ? `${h}h${pad(m)}` : `${m}'${pad(x)}"`;
  };
  const r05 = x => Math.round(x * 2) / 2;
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const km1 = x => String(Math.round(x * 10) / 10).replace('.', ',');

  const DEF = {
    debut: { km: 6, longest: 3.5, easy: 450 },
    regulier: { km: 15, longest: 8, easy: 380 },
    confirme: { km: 28, longest: 14, easy: 335 }
  };
  const RACES = {
    5: { tp: 1, peak: 30, longCap: 10, minWeeks: 6 },
    10: { tp: 1, peak: 42, longCap: 15, minWeeks: 8 },
    21.1: { tp: 2, peak: 55, longCap: 21, minWeeks: 10 },
    42.2: { tp: 3, peak: 70, longCap: 32, minWeeks: 14 }
  };
  const GROWTH = { race: 1.08, forme: 1.03, habit: 1.06, distance: 1.08, vitesse: 1.04 };

  /* ---------- Analyse des courses récentes ---------- */
  function analyze(runs, today, level, fit) {
    const t = today.getTime();
    const ago = r => (t - parseISO(r.date).getTime()) / DAY;
    const within = n => runs.filter(r => ago(r) >= -1 && ago(r) <= n);
    const r42 = within(42), r60 = within(60), r120 = within(120);
    const hasData = r60.length >= 3 || r42.length >= 2;
    let lvl = level || 'regulier';
    let weeklyKm, longest, easy, p5, med = null;
    if (hasData) {
      weeklyKm = r42.reduce((s, r) => s + r.km, 0) / 6;
      lvl = weeklyKm < 12 ? 'debut' : weeklyKm < 25 ? 'regulier' : 'confirme';
      longest = Math.max(0, ...r60.map(r => r.km));
      const paces = r60.filter(r => r.km >= 2 && r.sec > 0).map(r => r.sec / r.km).sort((a, b) => a - b);
      med = paces.length ? paces[Math.floor(paces.length / 2)] : DEF[lvl].easy;
      let best = Infinity;
      r120.forEach(r => {
        const p = r.sec / r.km;
        if (r.km >= 3 && p > 180 && p < 600) best = Math.min(best, r.sec * Math.pow(5 / r.km, 1.06));
      });
      p5 = isFinite(best) ? best * 0.97 / 5 : med / 1.2;
      easy = Math.max(p5 * 1.2, med);
    } else {
      const d = DEF[lvl];
      weeklyKm = d.km; longest = d.longest; easy = d.easy; p5 = easy / 1.22;
    }
    // Performance de référence (course ou test) : prioritaire, puis elle s'estompe avec le temps
    if (fit && fit.p5) {
      const age = (t - parseISO(fit.date).getTime()) / DAY;
      const w = age <= 60 ? 1 : age >= 150 ? 0 : 1 - (age - 60) / 90;
      if (w > 0) {
        const base = p5; let blend = w * fit.p5 + (1 - w) * base;
        if (base < blend * 0.97) blend = (base + blend) / 2; // nette amélioration constatée depuis
        p5 = blend;
        easy = hasData ? Math.max(p5 * 1.2, med) : p5 * 1.22;
      }
    }
    return { hasData, level: lvl, weeklyKm, longest, easy, p5, count42: r42.length };
  }

  const predict = (p5, d) => 5 * p5 * Math.pow(d / 5, d >= 40 ? 1.07 : 1.06);

  /* ---------- Séances ---------- */
  function buildSession(type, km, z, ctx) {
    const o = { type, km: r05(km) };
    const mins = pace => Math.round(o.km * pace / 60);
    switch (type) {
      case 'easy':
        o.title = 'Footing tranquille'; o.emoji = '🌿'; o.pace = z.easy; o.mins = mins(z.easy);
        o.desc = `Allure facile à ${fmtPace(z.easy)}/km. Tu dois pouvoir discuter sans être essoufflée.` +
          (ctx.beginner ? ' Si besoin, alterne 3\' de course / 1\' de marche.' : '');
        break;
      case 'long':
        o.title = 'Sortie longue'; o.emoji = '🏔️'; o.pace = z.long; o.mins = mins(z.long);
        o.desc = `Sortie tranquille à ${fmtPace(z.long)}/km. L'objectif : durer, pas aller vite. Emporte de l'eau !`;
        break;
      case 'fartlek': {
        const dur = o.km * z.easy / 60, n = clamp(Math.floor((dur - 15) / 2.5), 4, 12);
        ctx.n = n; o.title = 'Jeux de vitesse'; o.emoji = '🎲'; o.pace = z.easy; o.mins = Math.round(dur);
        o.desc = `10' d'échauffement, puis ${n} × (1' rapide / 1'30 tranquille), puis 5' de retour au calme. Rapide = tu sens l'effort mais tu contrôles.`;
        break;
      }
      case 'tempo': {
        const work = Math.max(1.5, r05(o.km - 3.5));
        o.km = r05(3.5 + work); o.title = 'Allure seuil'; o.emoji = '🔥'; o.pace = z.tempo; o.mins = mins(z.easy * 0.95);
        o.desc = `2 km d'échauffement, ${km1(work)} km à ${fmtPace(z.tempo)}/km (effort « confortablement dur »), 1,5 km de retour au calme.`;
        break;
      }
      case 'interval': {
        const work = Math.max(1.5, o.km - 3.5);
        const rep = [400, 600, 800, 1000][clamp(Math.floor(ctx.p * 4), 0, 3)];
        const reps = clamp(Math.round(work * 1000 / rep), 4, 12);
        const rec = rep <= 600 ? "1'" : rep === 800 ? "1'30" : "2'";
        ctx.iv = { rep, reps, rec: rep <= 600 ? 60 : rep === 800 ? 90 : 120 };
        o.km = r05(3.5 + reps * rep / 1000); o.title = 'Fractionné'; o.emoji = '⚡'; o.pace = z.interval; o.mins = mins(z.easy * 0.95);
        o.desc = `2 km d'échauffement, ${reps} × ${rep} m à ${fmtPace(z.interval)}/km (récup ${rec} en trottinant), 1,5 km de retour au calme.`;
        break;
      }
      case 'racepace': {
        const work = Math.max(2, r05(o.km - 3.5));
        o.km = r05(3.5 + work); o.title = 'Allure de course'; o.emoji = '🎯'; o.pace = z.goal; o.mins = mins(z.easy * 0.95);
        o.desc = `2 km d'échauffement, ${km1(work)} km à ton allure objectif ${fmtPace(z.goal)}/km, 1,5 km de retour au calme.`;
        break;
      }
      case 'strides':
        o.title = 'Footing + lignes droites'; o.emoji = '🏃'; o.pace = z.easy; o.mins = mins(z.easy);
        o.desc = `Footing facile à ${fmtPace(z.easy)}/km, puis 6 lignes droites de 20 secondes (accélère progressivement, sans sprinter) avec 40 secondes de marche entre chaque. Ça réveille les jambes !`;
        break;
      case 'hills': {
        const dur = o.km * z.easy / 60, n = clamp(Math.floor((dur - 15) / 2), 4, 10);
        ctx.n = n; o.title = 'Footing en côtes'; o.emoji = '⛰️'; o.pace = z.easy; o.mins = Math.round(dur);
        o.desc = `10' d'échauffement, puis ${n} × 30" en côte (effort soutenu mais contrôlé), redescente en trottinant, puis 5' de retour au calme. Ça muscle sans la fatigue du fractionné.`;
        break;
      }
      case 'pyramide':
        o.title = 'Pyramide'; o.emoji = '🔺'; o.pace = z.easy; o.mins = mins(z.easy * 0.95);
        o.desc = "Échauffement, puis 1' - 2' - 3' - 2' - 1' d'effort soutenu avec une récupération au trot de moitié moins de temps, puis 5' de retour au calme.";
        break;
      case 'progressive':
        o.title = 'Sortie longue progressive'; o.emoji = '📈'; o.pace = z.long; o.mins = mins(z.long);
        o.desc = `Pars tranquille à ${fmtPace(z.long)}/km, puis accélère doucement : le dernier tiers un peu plus vite, jusqu'à ${fmtPace(z.tempo)}/km à la fin si tu te sens bien.`;
        break;
      case 'cross':
        o.km = 0; o.title = 'Cross-training'; o.emoji = '🚴'; o.pace = null; o.mins = Math.round(Math.max(30, o.mins || 0, ctx.km0 * z.easy / 60 * 0.9));
        o.desc = 'Vélo, natation, elliptique ou renforcement + gainage : du cardio sans fatiguer les jambes. Effort facile à modéré, tu dois pouvoir parler.';
        break;
      case 'shake':
        o.title = 'Mini footing'; o.emoji = '🍃'; o.pace = z.easy; o.mins = mins(z.easy);
        o.desc = `Footing très facile. ${ctx.strides ? 'Termine par 4 lignes droites de 20 secondes pour te mettre en jambes.' : 'Garde de la fraîcheur pour la course.'}`;
        break;
    }
    o.steps = makeSteps(type, o, z, ctx);
    return o;
  }

  /* Étapes chronométrées pour le minuteur guidé : k = warm | work | rest | cool | run */
  function makeSteps(type, o, z, ctx) {
    const sec = (k, p) => Math.round(k * p);
    const T = (k, t, s) => ({ k, t, s: Math.max(5, Math.round(s)) });
    if (type === 'fartlek') {
      const n = ctx.n || 6, st = [T('warm', 'Échauffement', 600)];
      for (let i = 1; i <= n; i++) { st.push(T('work', `Rapide ${i}/${n}`, 60)); if (i < n) st.push(T('rest', 'Tranquille', 90)); }
      st.push(T('cool', 'Retour au calme', 300)); return st;
    }
    if (type === 'tempo' || type === 'racepace') {
      const work = o.km - 3.5, p = type === 'tempo' ? z.tempo : z.goal;
      return [T('warm', 'Échauffement', sec(2, z.easy)), T('work', type === 'tempo' ? 'Allure seuil' : 'Allure de course', sec(work, p)), T('cool', 'Retour au calme', sec(1.5, z.easy))];
    }
    if (type === 'interval') {
      const { rep, reps, rec } = ctx.iv, st = [T('warm', 'Échauffement', sec(2, z.easy))];
      for (let i = 1; i <= reps; i++) { st.push(T('work', `Rapide ${i}/${reps} · ${rep} m`, sec(rep / 1000, z.interval))); if (i < reps) st.push(T('rest', 'Récupération', rec)); }
      st.push(T('cool', 'Retour au calme', sec(1.5, z.easy))); return st;
    }
    if (type === 'strides') {
      const st = [T('run', 'Footing facile', Math.max(300, (o.mins - 6) * 60))];
      for (let i = 1; i <= 6; i++) { st.push(T('work', `Ligne droite ${i}/6`, 20)); st.push(T('rest', 'Marche / trot', 40)); }
      return st;
    }
    if (type === 'hills') {
      const n = ctx.n || 6, st = [T('warm', 'Échauffement', 600)];
      for (let i = 1; i <= n; i++) { st.push(T('work', `Côte ${i}/${n}`, 30)); if (i < n) st.push(T('rest', 'Redescente en trottinant', 90)); }
      st.push(T('cool', 'Retour au calme', 300)); return st;
    }
    if (type === 'pyramide') {
      const reps = [60, 120, 180, 120, 60], total = o.mins * 60, rec = reps.slice(0, 4).reduce((s, x) => s + x / 2, 0);
      const st = [T('warm', 'Échauffement', clamp(total - 600 - rec - 300, 600, 1200))];
      reps.forEach((d, i) => { st.push(T('work', `Rapide ${d / 60} min`, d)); if (i < reps.length - 1) st.push(T('rest', 'Trot de récupération', d / 2)); });
      st.push(T('cool', 'Retour au calme', 300)); return st;
    }
    if (type === 'progressive') {
      const m = o.mins * 60;
      return [T('run', 'Départ tranquille', m * 0.6), T('run', 'On accélère doucement', m * 0.25), T('work', 'Finis plus vite !', m * 0.15)];
    }
    if (type === 'shake') {
      const st = [T('run', 'Footing très facile', o.mins * 60)];
      if (ctx.strides) for (let i = 1; i <= 4; i++) { st.push(T('work', `Ligne droite ${i}/4`, 20)); st.push(T('rest', 'Marche / trot', 40)); }
      return st;
    }
    return [T('run', o.title, (o.mins || 20) * 60)];
  }

  function weekMessage(ph, i) {
    const m = {
      'Base': ['On pose les fondations en douceur 🧱', 'Régularité > vitesse. Tu construis ton moteur.', 'Ton corps s\'habitue, c\'est le but !'],
      'Développement': ['On monte en puissance 📈', 'Les séances rapides commencent à payer.', 'Tu deviens plus solide chaque semaine.'],
      'Spécifique': ['Cap sur l\'objectif 🎯', 'On travaille à l\'allure de course.', 'Tu y es presque, garde le cap !'],
      'Récupération': ['Semaine cool pour absorber le travail 😌', 'Le repos fait aussi progresser.'],
      'Récupération post-course': ['Bravo pour ta course ! Place à la récup 🛁', 'On laisse le corps absorber l\'effort, sans pression.', 'Reprise en douceur, tout doux !'],
      'Affûtage': ['On relâche pour arriver fraîche 🍃', 'Moins de volume, plus de fraîcheur.'],
      'Semaine de course': ['C\'est LA semaine ! 🏁', 'Dors bien, hydrate-toi, fais-toi confiance.'],
      'Progression': ['Une semaine de plus dans les jambes 💪', 'Continue, c\'est ce qui compte.']
    }[ph] || ['Allez !'];
    return m[i % m.length];
  }

  /* ---------- Génération du plan ----------
     profile : { goal:{type:'race'|'none', dist, date, target(sec)|null, focus}, days:[0..6], level }
     adj     : { vol:1, note:'' } (adaptation selon les retours) */
  function generatePlan(profile, runs, today, adj) {
    adj = adj || { vol: 1 };
    const a = analyze(runs, today, profile.level, adj.fit);
    const days = [...profile.days].sort((x, y) => x - y), n = days.length;
    const g = profile.goal;
    const race = g.type === 'race' ? { dist: +g.dist, date: parseISO(g.date), target: g.target || null } : null;
    const R = race ? RACES[race.dist] : null;
    const focus = race ? 'race' : (g.focus || 'habit');

    let start = mondayOf(today);
    if (wdIdx(today) >= 5) start = addDays(start, 7);
    if (race && mondayOf(race.date) < start) start = mondayOf(today);
    const N = race ? clamp(Math.round((mondayOf(race.date) - start) / (7 * DAY)) + 1, 1, 40) : 8;

    const p5 = a.p5 * (adj.pace || 1); // adj.pace > 1 = on ralentit les allures
    const predicted = race ? predict(p5, race.dist) : null;
    const goalPace = race ? (race.target ? race.target / race.dist : predicted / race.dist) : p5 * 1.06;
    const z = { easy: a.easy * (adj.pace || 1), tempo: p5 * 1.08, interval: p5 * 0.99, goal: goalPace };
    // récupération après une course précédente
    let rec = 0;
    if (profile.post) {
      const need = { 5: 1, 10: 1, 21.1: 2, 42.2: 3 }[profile.post.dist] || 1;
      const elapsed = Math.max(0, Math.floor((today - parseISO(profile.post.date)) / (7 * DAY)));
      rec = Math.max(0, need - elapsed);
    }
    z.long = z.easy * 1.04;

    const lf = { debut: 0.6, regulier: 0.85, confirme: 1 }[a.level];
    const v0 = Math.max(a.weeklyKm * adj.vol, n * 2.5);
    const cap = race ? Math.max(R.peak * lf, v0 * 1.1) : Math.min(60, Math.max(v0 * 1.5, v0 + 6));
    const tp = race ? Math.min(R.tp, N - 1) : 0;
    const build = N - tp;
    const growth = GROWTH[focus];
    const taperMul = { 0: [], 1: [0.6], 2: [0.8, 0.6], 3: [0.85, 0.7, 0.55] }[tp];

    const weeks = [];
    let cur = v0, lastBuild = v0;
    for (let i = 0; i < N; i++) {
      const monday = addDays(start, i * 7);
      let vol, phase, kind = 'build';
      if (i < rec && i < build) {
        kind = 'recovery'; vol = Math.max(n * 2.5, v0 * [0.5, 0.7, 0.85][i]); phase = 'Récupération post-course';
      } else if (i >= build) {
        kind = i === N - 1 && race ? 'raceweek' : 'taper';
        vol = lastBuild * taperMul[i - build];
        phase = kind === 'raceweek' ? 'Semaine de course' : 'Affûtage';
      } else if (i % 4 === 3 && i < build - 1) {
        kind = 'recovery'; vol = cur * 0.75; phase = 'Récupération';
      } else {
        cur = Math.min(cap, cur * growth); vol = cur; lastBuild = cur;
        const p = build > 1 ? i / (build - 1) : 1;
        phase = !race ? 'Progression' : p < 0.4 ? 'Base' : p < 0.8 ? 'Développement' : 'Spécifique';
      }
      const p = build > 1 ? Math.min(1, i / (build - 1)) : 1;
      const sessions = kind === 'raceweek'
        ? raceWeek(days, monday, race, vol, z, a)
        : layoutWeek({ days, monday, vol, kind, i, p, race, focus, a, z, n, taperIdx: i - build, R });
      weeks.push({
        n: i + 1, monday: iso(monday), phase, msg: weekMessage(phase, i),
        sessions
      });
    }

    applyPause(weeks, adj.pause, z, a);
    // on retire les séances passées
    const todayIso = iso(today);
    weeks.forEach(w => { w.sessions = w.sessions.filter(s => s.date >= todayIso); w.km = r05(w.sessions.reduce((s, x) => s + x.km, 0)); });

    const warnings = [];
    if (race) {
      if (N < R.minWeeks) warnings.push(`Il reste ${N} semaine(s) : c'est court pour ${race.dist === 21.1 ? 'un semi' : race.dist === 42.2 ? 'un marathon' : race.dist + ' km'}. On privilégie le plaisir et la prudence.`);
      if (race.target && race.target / race.dist < predicted / race.dist * 0.93) warnings.push('Ton objectif est ambitieux par rapport à ton niveau actuel. Le plan va t\'y préparer, on réajustera en route !');
      if (mondayOf(race.date) > addDays(start, 39 * 7)) warnings.push('La course est dans plus de 40 semaines : le plan couvre les 40 premières, on le prolongera ensuite.');
    }
    return {
      createdAt: iso(today), weeks: weeks.filter(w => w.sessions.length),
      info: {
        hasData: a.hasData, level: a.level, weeklyKm: Math.round(a.weeklyKm * 10) / 10, easy: z.easy, p5, goalPace,
        pred: { 5: predict(p5, 5), 10: predict(p5, 10), 21.1: predict(p5, 21.1), 42.2: predict(p5, 42.2) },
        predicted, weeksTotal: N, warnings
      }
    };
  }

  /* Fatigue, maladie, blessure : on retire / allège les séances puis on reprend progressivement.
     pause : { kind:'tired'|'sick'|'injury', until:'YYYY-MM-DD' } */
  function applyPause(weeks, pause, z, a) {
    if (!pause) return;
    const ramp = { sick: 7, injury: 10, tired: 0 }[pause.kind] || 0;
    const cut = { sick: 0.7, injury: 0.6, tired: 1 }[pause.kind] || 1;
    const rampEnd = iso(addDays(parseISO(pause.until), ramp));
    const easy = (s, km) => { const e = buildSession('easy', Math.max(2.5, r05(km)), z, { beginner: a.level === 'debut' }); e.id = s.id; e.date = s.date; return e; };
    weeks.forEach(w => {
      w.sessions = w.sessions.flatMap(s => {
        if (s.type === 'race' || s.type === 'cross') return [s];
        if (s.date <= pause.until) {
          if (pause.kind === 'sick') return [];
          if (pause.kind === 'injury') { const c = buildSession('cross', 4, z, { km0: Math.max(3, s.km), p: 0.5 }); c.id = s.id; c.date = s.date; return [c]; }
          return s.type === 'easy' || s.type === 'shake' ? [s] : [easy(s, s.km * 0.6)];
        }
        if (s.date <= rampEnd) return [easy(s, s.km * cut)];
        return [s];
      });
    });
  }

  function layoutWeek(c) {
    const { days, monday, vol, kind, i, p, race, focus, a, z, n } = c;
    const longDay = days.includes(6) ? 6 : days.includes(5) ? 5 : days[n - 1];
    const rest = days.filter(d => d !== longDay);

    // type de séance de qualité
    let q = null;
    if (kind === 'build' || (kind === 'taper' && c.taperIdx === 0)) {
      if (kind === 'taper') q = 'fartlek';
      else if (focus === 'habit' || (a.level === 'debut' && i < 3) || p < 0.3) q = 'fartlek';
      else if (race && p >= 0.65 && race.dist >= 10) q = race.dist === 10 ? (i % 2 ? 'racepace' : 'interval') : (i % 2 ? 'racepace' : 'tempo');
      else if (race && p >= 0.65) q = 'interval';
      else if (focus === 'forme' || focus === 'distance') q = i % 2 ? 'tempo' : 'fartlek';
      else q = i % 2 ? 'tempo' : 'interval';
    }
    const dist = x => Math.min(Math.abs(x - longDay), 7 - Math.abs(x - longDay));
    const qDay = q ? rest.slice().sort((x, y) => dist(y) - dist(x))[0] : null;

    let ls = n === 2 ? 0.5 : n === 3 ? 0.42 : n === 4 ? 0.36 : 0.32;
    if (focus === 'distance') ls += 0.04;
    let long = vol * ls;
    if (c.R) long = Math.min(long, c.R.longCap);
    else long = Math.min(long, 18);
    if (i < 4 && kind === 'build') long = Math.min(long, Math.max(a.longest, 3) * (1.2 + 0.12 * i));
    long = Math.max(3, r05(long));
    const remaining = Math.max(vol - long, (n - 1) * 2.5);
    const w = (n - 1) + (qDay != null ? 0.2 : 0);
    const each = remaining / w;

    const sessions = days.map(d => {
      const date = addDays(monday, d);
      let type = d === longDay ? 'long' : d === qDay ? q : 'easy';
      let km = d === longDay ? long : d === qDay ? each * 1.2 : each;
      km = Math.max(2.5, km);
      if (['tempo', 'interval', 'racepace'].includes(type) && km < 5) type = 'fartlek';
      const s = buildSession(type, km, z, { p, beginner: a.level === 'debut' });
      s.id = iso(date); s.date = iso(date);
      const alt = makeAlt(s, z, { p, beginner: a.level === 'debut', kind });
      if (alt) { alt.id = s.id; alt.date = s.date; s.alt = alt; }
      return s;
    });
    return sessions;
  }

  /* Séance alternative proposée le même jour (même thème ou non) */
  function makeAlt(s, z, ctx) {
    const h = s.date.split('').reduce((a, c) => a + c.charCodeAt(0), 0);
    let t;
    if (s.type === 'easy') { const l = ctx.kind === 'build' ? ['strides', 'hills', 'cross'] : ['strides', 'cross']; t = l[h % l.length]; }
    else if (s.type === 'long') t = ctx.kind === 'build' ? 'progressive' : 'cross';
    else t = { fartlek: 'pyramide', tempo: 'fartlek', interval: 'pyramide', racepace: 'tempo' }[s.type];
    if (!t) return null;
    const km = t === 'tempo' ? Math.max(s.km, 6) : s.km;
    return buildSession(t, km, z, { p: ctx.p, beginner: ctx.beginner, km0: s.km });
  }

  /* Plan de course : départ prudent, rythme de croisière, finish à fond */
  function raceSteps(d, g) {
    const s1 = Math.min(2, d * 0.2), s3 = d * 0.2, s2 = d - s1 - s3;
    return [
      { k: 'warm', t: `Départ prudent · ${fmtPace(g + 6)}`, s: Math.round(s1 * (g + 6)) },
      { k: 'run', t: `Rythme de croisière · ${fmtPace(g)}`, s: Math.round(s2 * g) },
      { k: 'work', t: `On donne tout · ${fmtPace(g - 4)}`, s: Math.round(s3 * (g - 4)) }
    ];
  }

  function raceWeek(days, monday, race, vol, z, a) {
    const rd = iso(race.date);
    const cand = days.map(d => addDays(monday, d)).filter(d => iso(d) < iso(addDays(race.date, -1)) && d < race.date);
    const pick = cand.slice(-2);
    const sessions = pick.map((d, k) => {
      const s = buildSession('shake', clamp(vol * 0.3, 2.5, 6), z, { strides: k === pick.length - 1 });
      s.id = iso(d); s.date = iso(d); return s;
    });
    const label = race.dist === 21.1 ? 'Semi-marathon' : race.dist === 42.2 ? 'Marathon' : race.dist + ' km';
    sessions.push({
      id: rd, date: rd, type: 'race', title: `JOUR J — ${label}`, emoji: '🏁', km: race.dist, pace: z.goal,
      mins: Math.round(race.dist * z.goal / 60),
      steps: raceSteps(race.dist, z.goal),
      desc: `C'est le grand jour ! Objectif ${fmtPace(z.goal)}/km${race.target ? ` (${fmtTime(race.target)})` : ` (environ ${fmtTime(race.dist * z.goal)})`}. ` +
        `Stratégie : ${km1(Math.min(2, race.dist * 0.2))} premiers km à ${fmtPace(z.goal + 6)}/km (départ prudent), puis ${fmtPace(z.goal)}/km, et sur les ${km1(race.dist * 0.2)} derniers km tu donnes tout (${fmtPace(z.goal - 4)}/km ou mieux). Profite !`
    });
    return sessions;
  }

  /* ---------- Adaptation selon les retours ----------
     done : { id: {km, sec, feel:1(facile)|2(bien)|3(dur)} }  */
  function computeAdjust(plan, done, today) {
    const todayIso = iso(today);
    const past = [];
    plan.weeks.forEach(w => w.sessions.forEach(s => { if (s.date <= todayIso || (done[s.id] && !done[s.id].skipped)) past.push(s); }));
    past.sort((x, y) => (x.date < y.date ? -1 : 1));
    const last = past.slice(-6);
    if (!last.length) return { vol: 1, pace: 1, note: '' };
    let vol = 1; const notes = [];
    const logged = last.filter(s => done[s.id] && !done[s.id].skipped);
    const missed = last.filter(s => (!done[s.id] || done[s.id].skipped) && s.date < todayIso).length;
    // ressenti pondéré : les séances récentes comptent plus ; « dur » sur une séance facile pèse plus que sur une séance intense
    let sw = 0, sf = 0;
    logged.forEach((s, k) => {
      const f = done[s.id].feel; if (!f) return;
      const w = (0.6 + 0.4 * (logged.length > 1 ? k / (logged.length - 1) : 1)) * (['easy', 'long', 'shake', 'strides', 'progressive', 'cross'].includes(s.type) ? 1.4 : 0.7);
      sw += w; sf += w * f;
    });
    if (sw > 0) {
      const avg = sf / sw;
      if (avg >= 2.4) { vol *= 0.88; notes.push('Tes dernières séances étaient dures : je réduis la charge d\'environ 12 % pour que tu récupères bien.'); }
      else if (avg >= 2.1) { vol *= 0.95; notes.push('Tes dernières séances étaient un peu justes : je lève légèrement le pied.'); }
      else if (avg <= 1.45) { vol *= 1.08; notes.push('Tu trouves ça facile : j\'augmente un peu la charge (+8 %).'); }
    }
    if (missed >= 2 && last.length >= 3) { vol *= 0.9; notes.push('Quelques séances manquées : on reprend en douceur, sans culpabiliser.'); }
    // (les allures réelles sont déjà prises en compte par l'analyse de tes dernières courses)
    return { vol: clamp(vol, 0.8, 1.15), pace: 1, note: notes.join(' ') };
  }

  G.P = { iso, parseISO, addDays, mondayOf, wdIdx, fmtPace, fmtTime, km1, analyze, predict, generatePlan, computeAdjust, RACES, r05, buildSession };
})(window);
