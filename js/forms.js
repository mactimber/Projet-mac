// Génération de formulaires à partir des schémas de config.js.

import { bearingLabel } from './swiss.js';

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

let fieldSeq = 0;

/** Applique les valeurs par défaut d'un schéma sur un objet de données. */
export function applyDefaults(fields, data) {
  for (const f of fields) {
    if (f.key && data[f.key] === undefined && f.default !== undefined) data[f.key] = f.default;
  }
  return data;
}

/**
 * @param {HTMLElement} container
 * @param {Array} fields schéma
 * @param {object} data objet modifié en place
 * @param {(key:string)=>void} onChange
 * @param {object} ctx { secoursText?: () => string }
 */
export function renderForm(container, fields, data, onChange, ctx = {}) {
  applyDefaults(fields, data);
  container.innerHTML = '';
  container.classList.add('form');
  for (const f of fields) {
    if (f.type === 'heading') {
      const h = document.createElement('h3');
      h.textContent = f.label;
      container.appendChild(h);
      continue;
    }
    const id = `f${++fieldSeq}`;
    const wrap = document.createElement('div');
    wrap.className = `field field-${f.type}`;
    if (f.label) {
      const lab = document.createElement('label');
      lab.htmlFor = id;
      lab.textContent = f.label;
      wrap.appendChild(lab);
    }
    const set = (v) => {
      data[f.key] = v;
      onChange(f.key);
    };
    const val = data[f.key];

    switch (f.type) {
      case 'textarea': {
        const el = document.createElement('textarea');
        el.id = id;
        el.rows = 3;
        el.value = val ?? '';
        el.addEventListener('input', () => set(el.value));
        wrap.appendChild(el);
        break;
      }
      case 'select': {
        const el = document.createElement('select');
        el.id = id;
        const opts = [...f.options];
        if (val && !opts.includes(val)) opts.push(val);
        el.innerHTML = opts.map((o) => `<option value="${esc(o)}">${esc(o || '—')}</option>`).join('');
        el.value = val ?? opts[0];
        if (val === undefined && opts[0]) data[f.key] = opts[0];
        el.addEventListener('change', () => set(el.value));
        wrap.appendChild(el);
        break;
      }
      case 'multi':
      case 'checklist': {
        const box = document.createElement('div');
        box.className = f.type === 'multi' ? 'chips' : 'checklist';
        const current = new Set(Array.isArray(val) ? val : []);
        for (const o of f.options) {
          const l = document.createElement('label');
          const cb = document.createElement('input');
          cb.type = 'checkbox';
          cb.checked = current.has(o);
          cb.addEventListener('change', () => {
            cb.checked ? current.add(o) : current.delete(o);
            set(f.options.filter((x) => current.has(x)));
          });
          l.append(cb, document.createTextNode(` ${o}`));
          box.appendChild(l);
        }
        wrap.appendChild(box);
        break;
      }
      case 'direction': {
        const row = document.createElement('div');
        row.className = 'inline-form';
        const el = document.createElement('input');
        el.type = 'number';
        el.id = id;
        el.min = 0;
        el.max = 359;
        el.step = 1;
        el.inputMode = 'numeric';
        el.value = val ?? '';
        const out = document.createElement('span');
        out.className = 'hint';
        out.textContent = bearingLabel(val);
        const update = (v) => {
          el.value = v;
          out.textContent = bearingLabel(v);
          set(v === '' ? '' : Number(v));
        };
        el.addEventListener('input', () => update(el.value === '' ? '' : ((Number(el.value) % 360) + 360) % 360));
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.textContent = '🧭 Boussole';
        btn.title = 'Pointer le haut du téléphone dans la direction de chute puis valider';
        btn.addEventListener('click', () => readCompass(btn).then((deg) => deg != null && update(Math.round(deg))));
        row.append(el, btn, out);
        wrap.appendChild(row);
        break;
      }
      case 'photos': {
        const list = document.createElement('div');
        list.className = 'photos';
        const photos = Array.isArray(val) ? val : [];
        const draw = () => {
          list.innerHTML = '';
          photos.forEach((src, i) => {
            const fig = document.createElement('figure');
            fig.innerHTML = `<img src="${src}" alt="Photo ${i + 1}"><button type="button" title="Supprimer" aria-label="Supprimer la photo">×</button>`;
            fig.querySelector('img').addEventListener('click', () => window.open().document.write(`<img src="${src}" style="max-width:100%">`));
            fig.querySelector('button').addEventListener('click', () => {
              if (!confirm('Supprimer cette photo ?')) return;
              photos.splice(i, 1);
              set([...photos]);
              draw();
            });
            list.appendChild(fig);
          });
        };
        draw();
        const add = document.createElement('label');
        add.className = 'btn';
        add.innerHTML = '📷 Ajouter une photo<input type="file" accept="image/*" capture="environment" multiple hidden>';
        add.querySelector('input').addEventListener('change', async (e) => {
          for (const file of e.target.files) photos.push(await resizeImage(file, 1280, 0.72));
          e.target.value = '';
          set([...photos]);
          draw();
        });
        wrap.append(list, add);
        break;
      }
      case 'secours': {
        const p = document.createElement('div');
        p.className = 'readonly';
        p.textContent = ctx.secoursText ? ctx.secoursText() : '';
        wrap.appendChild(p);
        break;
      }
      default: {
        const el = document.createElement('input');
        el.id = id;
        el.type = f.type === 'tel' ? 'tel' : f.type === 'date' ? 'date' : f.type === 'number' ? 'number' : 'text';
        if (f.type === 'number') {
          el.step = f.step ?? 'any';
          if (f.min != null) el.min = f.min;
          el.inputMode = 'decimal';
        }
        if (f.required) el.required = true;
        el.value = val ?? '';
        el.addEventListener('input', () => set(f.type === 'number' ? (el.value === '' ? '' : Number(el.value)) : el.value));
        wrap.appendChild(el);
        if (f.type === 'tel') {
          const a = document.createElement('a');
          a.className = 'call';
          a.textContent = '📞';
          a.title = 'Appeler';
          const upd = () => {
            a.href = `tel:${el.value.replace(/\s/g, '')}`;
            a.hidden = !el.value;
          };
          upd();
          el.addEventListener('input', upd);
          wrap.appendChild(a);
        }
      }
    }
    container.appendChild(wrap);
  }
}

function resizeImage(file, max, quality) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const scale = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * scale);
      c.height = Math.round(img.height * scale);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      resolve(c.toDataURL('image/jpeg', quality));
    };
    img.onerror = reject;
    img.src = url;
  });
}

/** Lit le cap de la boussole du téléphone (moyenne sur ~1,5 s). */
async function readCompass(btn) {
  if (typeof DeviceOrientationEvent === 'undefined') {
    alert('Boussole non disponible sur cet appareil.');
    return null;
  }
  if (typeof DeviceOrientationEvent.requestPermission === 'function') {
    try {
      if ((await DeviceOrientationEvent.requestPermission()) !== 'granted') return null;
    } catch {
      return null;
    }
  }
  const label = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Mesure…';
  return new Promise((resolve) => {
    let sx = 0, sy = 0, n = 0;
    const evName = 'ondeviceorientationabsolute' in window ? 'deviceorientationabsolute' : 'deviceorientation';
    const handler = (e) => {
      let h = null;
      if (typeof e.webkitCompassHeading === 'number') h = e.webkitCompassHeading;
      else if (e.absolute !== false && typeof e.alpha === 'number') h = (360 - e.alpha) % 360;
      if (h == null) return;
      sx += Math.sin((h * Math.PI) / 180);
      sy += Math.cos((h * Math.PI) / 180);
      n++;
    };
    window.addEventListener(evName, handler);
    setTimeout(() => {
      window.removeEventListener(evName, handler);
      btn.disabled = false;
      btn.textContent = label;
      if (!n) {
        alert('Impossible de lire la boussole. Saisissez la direction à la main.');
        resolve(null);
      } else {
        resolve(((Math.atan2(sx, sy) * 180) / Math.PI + 360) % 360);
      }
    }, 1500);
  });
}
