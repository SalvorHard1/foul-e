/* Import de l'export Strava (activities.csv ou archive .zip) */
(function (G) {
  const norm = s => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

  function parseCSV(text) {
    const rows = []; let row = [], f = '', q = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) { if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
      else if (c === '"') q = true;
      else if (c === ',') { row.push(f); f = ''; }
      else if (c === '\n') { row.push(f); rows.push(row); row = []; f = ''; }
      else if (c !== '\r') f += c;
    }
    if (f.length || row.length) { row.push(f); rows.push(row); }
    return rows;
  }

  function monthIdx(s) {
    s = norm(s);
    const t = s.slice(0, 3);
    if (s.startsWith('jui')) return s[3] === 'l' ? 6 : 5;
    return { jan: 0, feb: 1, fev: 1, mar: 2, apr: 3, avr: 3, may: 4, mai: 4, jun: 5, jul: 6, aug: 7, aou: 7, sep: 8, oct: 9, nov: 10, dec: 11 }[t];
  }

  function parseDate(s) {
    s = norm(s).replace(/\./g, '');
    let m = s.match(/(\d{1,2})\s+([a-z]+)\s+(\d{4})/); // 5 janv 2024
    if (m && monthIdx(m[2]) != null) return mk(+m[3], monthIdx(m[2]), +m[1]);
    m = s.match(/([a-z]+)\s+(\d{1,2}),?\s+(\d{4})/); // jan 5, 2024
    if (m && monthIdx(m[1]) != null) return mk(+m[3], monthIdx(m[1]), +m[2]);
    m = s.match(/(\d{4})-(\d{2})-(\d{2})/);
    if (m) return mk(+m[1], +m[2] - 1, +m[3]);
    m = s.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if (m) return mk(+m[3], +m[2] - 1, +m[1]);
    return null;
  }
  const mk = (y, m, d) => `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  const num = s => { s = (s || '').replace(/\s/g, ''); if (!s) return NaN; if (!s.includes('.')) s = s.replace(',', '.'); return parseFloat(s); };

  function parseStrava(text) {
    const rows = parseCSV(text.replace(/^﻿/, ''));
    if (rows.length < 2) return [];
    const h = rows[0].map(norm);
    const find = (...keys) => h.findIndex(x => keys.some(k => x === k || x.includes(k)));
    const iDate = Math.max(0, find('activity date', 'date de l\'activite', 'date'));
    const iType = find('activity type', 'type d\'activite', 'type');
    const iDist = h.findIndex(x => x === 'distance');
    const iMove = find('moving time', 'temps de deplacement', 'temps en mouvement');
    const iElap = find('elapsed time', 'duree ecoulee', 'temps ecoule', 'duree');
    const out = [];
    for (let r = 1; r < rows.length; r++) {
      const c = rows[r];
      if (c.length < 5) continue;
      const type = norm(c[iType >= 0 ? iType : 3]);
      if (!/(run|course|trail)/.test(type) || /(ride|velo|walk|marche|ski|swim|nata|bike)/.test(type)) continue;
      const date = parseDate(c[iDate]);
      let km = num(c[iDist >= 0 ? iDist : 6]);
      if (!date || !(km > 0)) continue;
      if (km > 500) km /= 1000;
      let sec = iMove >= 0 ? num(c[iMove]) : NaN;
      if (!(sec > 0)) sec = num(c[iElap >= 0 ? iElap : 5]);
      if (!(sec > 0) || km < 0.3) continue;
      out.push({ date, km: Math.round(km * 100) / 100, sec: Math.round(sec) });
    }
    return out;
  }

  /* Lecture d'un seul fichier dans un .zip (sans charger toute l'archive en mémoire) */
  async function readZipEntry(file, re) {
    const u32 = (dv, o) => dv.getUint32(o, true), u16 = (dv, o) => dv.getUint16(o, true);
    const tailLen = Math.min(file.size, 70000);
    const tail = new DataView(await file.slice(file.size - tailLen).arrayBuffer());
    let e = -1;
    for (let i = tailLen - 22; i >= 0; i--) if (u32(tail, i) === 0x06054b50) { e = i; break; }
    if (e < 0) throw new Error('zip invalide');
    let cdOff = u32(tail, e + 16), cdSize = u32(tail, e + 12);
    if (cdOff === 0xFFFFFFFF || cdSize === 0xFFFFFFFF) {
      const l = e - 20;
      if (l >= 0 && u32(tail, l) === 0x07064b50) {
        const z64Off = Number(tail.getBigUint64(l + 8, true));
        const z = new DataView(await file.slice(z64Off, z64Off + 56).arrayBuffer());
        cdSize = Number(z.getBigUint64(40, true)); cdOff = Number(z.getBigUint64(48, true));
      }
    }
    const cd = new DataView(await file.slice(cdOff, cdOff + cdSize).arrayBuffer());
    const dec = new TextDecoder();
    for (let p = 0; p + 46 <= cd.byteLength && u32(cd, p) === 0x02014b50;) {
      const method = u16(cd, p + 10), cSize = u32(cd, p + 20);
      const nl = u16(cd, p + 28), el = u16(cd, p + 30), cl = u16(cd, p + 32), lo = u32(cd, p + 42);
      const name = dec.decode(new Uint8Array(cd.buffer, p + 46, nl));
      if (re.test(name)) {
        const lh = new DataView(await file.slice(lo, lo + 30).arrayBuffer());
        const ds = lo + 30 + u16(lh, 26) + u16(lh, 28);
        const blob = file.slice(ds, ds + cSize);
        if (method === 0) return await blob.text();
        const stream = blob.stream().pipeThrough(new DecompressionStream('deflate-raw'));
        return await new Response(stream).text();
      }
      p += 46 + nl + el + cl;
    }
    throw new Error('activities.csv introuvable');
  }

  async function importFile(file) {
    const text = /\.zip$/i.test(file.name) ? await readZipEntry(file, /(^|\/)activities\.csv$/i) : await file.text();
    return parseStrava(text);
  }

  G.Strava = { parseStrava, importFile, parseCSV };
})(window);
