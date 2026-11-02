// Photos : réduites (JPEG ~1600 px) avant d'être enregistrées sur l'appareil.

import { db, uid } from './db.js';

const urls = new Map();

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('image illisible')); };
    img.src = url;
  });
}

export async function compress(file, max = 1600, quality = 0.75) {
  const img = await loadImage(file);
  const s = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
  const c = document.createElement('canvas');
  c.width = Math.round(img.naturalWidth * s);
  c.height = Math.round(img.naturalHeight * s);
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  return new Promise((resolve) => c.toBlob((b) => resolve(b || file), 'image/jpeg', quality));
}

export async function storePhoto(file, max = 1600, quality = 0.75) {
  const blob = await compress(file, max, quality);
  const id = uid();
  await db.put('photos', { id, blob, created: new Date().toISOString() });
  return id;
}

export async function photoURL(id) {
  if (urls.has(id)) return urls.get(id);
  const p = await db.get('photos', id);
  if (!p) return '';
  const u = URL.createObjectURL(p.blob);
  urls.set(id, u);
  return u;
}

// Remplit toutes les <img data-photo="id"> d'un élément.
export function fillImages(root) {
  const imgs = [...root.querySelectorAll('img[data-photo]')];
  return Promise.all(imgs.map(async (img) => {
    if (img.getAttribute('src')) return;
    const u = await photoURL(img.dataset.photo);
    if (!u) return;
    await new Promise((r) => { img.onload = r; img.onerror = r; img.src = u; });
  }));
}

// Supprime les photos qui ne sont plus utilisées nulle part.
export async function cleanPhotos(usedIds) {
  const keys = await db.keys('photos');
  for (const k of keys) {
    if (!usedIds.has(k)) {
      await db.del('photos', k);
      if (urls.has(k)) { URL.revokeObjectURL(urls.get(k)); urls.delete(k); }
    }
  }
}

export function blobToDataURL(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

export async function dataURLToBlob(dataURL) {
  return (await fetch(dataURL)).blob();
}
