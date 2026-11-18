// Petit générateur de documents Word (.docx), sans bibliothèque externe.
// Produit un fichier ZIP (sans compression) contenant le WordprocessingML.

const enc = new TextEncoder();

/* ---------------------------- ZIP ---------------------------- */
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** @param {{name:string,data:Uint8Array|string}[]} files */
export function zip(files) {
  const parts = [];
  const central = [];
  let offset = 0;
  const d = new Date();
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
  const date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  for (const f of files) {
    const name = enc.encode(f.name);
    const data = typeof f.data === 'string' ? enc.encode(f.data) : f.data;
    const crc = crc32(data);
    const h = new DataView(new ArrayBuffer(30));
    h.setUint32(0, 0x04034b50, true);
    h.setUint16(4, 20, true);
    h.setUint16(6, 0x0800, true); // noms en UTF-8
    h.setUint16(8, 0, true); // stockage
    h.setUint16(10, time, true);
    h.setUint16(12, date, true);
    h.setUint32(14, crc, true);
    h.setUint32(18, data.length, true);
    h.setUint32(22, data.length, true);
    h.setUint16(26, name.length, true);
    h.setUint16(28, 0, true);
    parts.push(new Uint8Array(h.buffer), name, data);

    const c = new DataView(new ArrayBuffer(46));
    c.setUint32(0, 0x02014b50, true);
    c.setUint16(4, 20, true);
    c.setUint16(6, 20, true);
    c.setUint16(8, 0x0800, true);
    c.setUint16(10, 0, true);
    c.setUint16(12, time, true);
    c.setUint16(14, date, true);
    c.setUint32(16, crc, true);
    c.setUint32(20, data.length, true);
    c.setUint32(24, data.length, true);
    c.setUint16(28, name.length, true);
    c.setUint32(42, offset, true);
    central.push(new Uint8Array(c.buffer), name);
    offset += 30 + name.length + data.length;
  }
  const cdSize = central.reduce((s, p) => s + p.length, 0);
  const e = new DataView(new ArrayBuffer(22));
  e.setUint32(0, 0x06054b50, true);
  e.setUint16(8, files.length, true);
  e.setUint16(10, files.length, true);
  e.setUint32(12, cdSize, true);
  e.setUint32(16, offset, true);
  return new Blob([...parts, ...central, new Uint8Array(e.buffer)], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
}

/* ------------------------- Contenu Word ------------------------- */
export const x = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
  // caractères interdits en XML
  .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');

/** Texte (avec retours à la ligne) -> runs. */
export function run(text, o = {}) {
  const rpr = [
    o.bold ? '<w:b/>' : '',
    o.italic ? '<w:i/>' : '',
    o.color ? `<w:color w:val="${o.color}"/>` : '',
    o.size ? `<w:sz w:val="${o.size * 2}"/><w:szCs w:val="${o.size * 2}"/>` : '',
    o.highlight ? `<w:shd w:val="clear" w:color="auto" w:fill="${o.highlight}"/>` : '',
  ].join('');
  return String(text ?? '').split('\n').map((line, i) => `<w:r>${rpr ? `<w:rPr>${rpr}</w:rPr>` : ''}${i ? '<w:br/>' : ''}<w:t xml:space="preserve">${x(line)}</w:t></w:r>`).join('');
}

/**
 * Paragraphe. content : texte ou tableau de [texte, options] / runs déjà faits (chaîne commençant par « <w: »).
 * o : style, align, spaceBefore, spaceAfter, keepNext, keepLines, pageBreakBefore, num: [numId, niveau],
 *     noNum (titre sans numéro), tabs: [[type, pos], ...]
 */
export function p(content, o = {}) {
  const runs = Array.isArray(content)
    ? content.map((c) => (Array.isArray(c) ? run(c[0], c[1]) : String(c).startsWith('<w:') ? c : run(c))).join('')
    : run(content, o);
  const ppr = [
    o.style ? `<w:pStyle w:val="${o.style}"/>` : '',
    o.keepNext ? '<w:keepNext/>' : '',
    o.keepLines ? '<w:keepLines/>' : '',
    o.pageBreakBefore ? '<w:pageBreakBefore/>' : '',
    o.num ? `<w:numPr><w:ilvl w:val="${o.num[1] || 0}"/><w:numId w:val="${o.num[0]}"/></w:numPr>` : '',
    o.noNum ? '<w:numPr><w:ilvl w:val="0"/><w:numId w:val="0"/></w:numPr>' : '',
    o.tabs ? `<w:tabs>${o.tabs.map(([t, pos, leader]) => `<w:tab w:val="${t}"${leader ? ` w:leader="${leader}"` : ''} w:pos="${pos}"/>`).join('')}</w:tabs>` : '',
    o.spaceBefore != null || o.spaceAfter != null ? `<w:spacing${o.spaceBefore != null ? ` w:before="${o.spaceBefore}"` : ''}${o.spaceAfter != null ? ` w:after="${o.spaceAfter}"` : ''}/>` : '',
    o.ind ? `<w:ind w:left="${o.ind}"/>` : '',
    o.align ? `<w:jc w:val="${o.align}"/>` : '',
  ].join('');
  return `<w:p>${ppr ? `<w:pPr>${ppr}</w:pPr>` : ''}${runs}</w:p>`;
}

export const h1 = (t, o = {}) => p(t, { style: 'Heading1', ...o });
export const h2 = (t, o = {}) => p(t, { style: 'Heading2', ...o });
export const pageBreak = () => '<w:p><w:r><w:br w:type="page"/></w:r></w:p>';
export const tab = () => '<w:r><w:tab/></w:r>';

/** Champ Word (PAGE, NUMPAGES…) avec un texte provisoire. */
export const field = (instr, placeholder = '1', rpr = '') => `<w:r>${rpr}<w:fldChar w:fldCharType="begin"/></w:r><w:r>${rpr}<w:instrText xml:space="preserve"> ${instr} </w:instrText></w:r><w:r>${rpr}<w:fldChar w:fldCharType="separate"/></w:r><w:r>${rpr}<w:t xml:space="preserve">${x(placeholder)}</w:t></w:r><w:r>${rpr}<w:fldChar w:fldCharType="end"/></w:r>`;

/**
 * Tableau.
 * @param {Array<Array<string|{text,bold,fill,span,align}>>} rows
 * @param {object} o { widths: [en % de la largeur], total: largeur en twips, header: true, minHeight: twips,
 *                     borders: false (sans bordures), headFill, size, vAlign }
 */
export function table(rows, o = {}) {
  const total = o.total || 9070;
  const widths = (o.widths || rows[0].map(() => 100 / rows[0].length)).map((w) => Math.round((w / 100) * total));
  const ligne = (sz, col) => `w:val="single" w:sz="${sz}" w:color="${col}"`;
  const border = o.borders === false
    ? '<w:top w:val="nil"/><w:left w:val="nil"/><w:bottom w:val="nil"/><w:right w:val="nil"/><w:insideH w:val="nil"/><w:insideV w:val="nil"/>'
    : `<w:top ${ligne(6, '7F7F7F')}/><w:left ${ligne(6, '7F7F7F')}/><w:bottom ${ligne(6, '7F7F7F')}/><w:right ${ligne(6, '7F7F7F')}/><w:insideH ${ligne(4, 'A6A6A6')}/><w:insideV ${ligne(4, 'A6A6A6')}/>`;
  const grid = widths.map((w) => `<w:gridCol w:w="${w}"/>`).join('');
  const body = rows.map((r, ri) => {
    const isHead = o.header !== false && ri === 0;
    let col = 0;
    const cells = r.map((cell) => {
      const c = typeof cell === 'object' && cell !== null && !Array.isArray(cell) ? cell : { text: cell };
      const span = c.span || 1;
      const w = widths.slice(col, col + span).reduce((a, b) => a + b, 0);
      col += span;
      const fill = c.fill || (isHead ? (o.headFill || 'E9DCCB') : (o.firstColFill && col === span ? o.firstColFill : ''));
      const tcpr = `<w:tcW w:w="${w}" w:type="dxa"/>${span > 1 ? `<w:gridSpan w:val="${span}"/>` : ''}${fill ? `<w:shd w:val="clear" w:color="auto" w:fill="${fill}"/>` : ''}${o.vAlign ? `<w:vAlign w:val="${o.vAlign}"/>` : ''}`;
      const paras = Array.isArray(c.text) ? c.text : [c.text ?? ''];
      const content = paras.map((t) => (String(t).startsWith('<w:p') ? t : p([[t, { bold: c.bold || isHead, size: o.size || 10, color: c.color || (isHead ? o.headColor : undefined), italic: c.italic }]], { spaceBefore: 30, spaceAfter: 30, align: c.align || o.align || 'left', keepNext: o.keep && ri < rows.length - 1 }))).join('');
      return `<w:tc><w:tcPr>${tcpr}</w:tcPr>${content}</w:tc>`;
    }).join('');
    const empty = r.every((cell) => !(typeof cell === 'object' && cell ? cell.text : cell)) || (ri > 0 && r.slice(1).every((cell) => !(typeof cell === 'object' && cell ? cell.text : cell)));
    const h = o.rowHeight || (o.minHeight && !isHead && empty ? o.minHeight : 0);
    const trpr = [isHead ? '<w:tblHeader/><w:cantSplit/>' : '<w:cantSplit/>', h ? `<w:trHeight w:val="${h}"/>` : ''].join('');
    return `<w:tr><w:trPr>${trpr}</w:trPr>${cells}</w:tr>`;
  }).join('');
  const after = o.after === false ? '' : p('', { spaceAfter: 60 });
  return `<w:tbl><w:tblPr><w:tblW w:w="${total}" w:type="dxa"/>${o.align === 'center' ? '<w:jc w:val="center"/>' : ''}<w:tblBorders>${border}</w:tblBorders><w:tblLayout w:type="fixed"/><w:tblCellMar><w:left w:w="${o.borders === false ? 0 : 80}" w:type="dxa"/><w:right w:w="${o.borders === false ? 0 : 80}" w:type="dxa"/></w:tblCellMar></w:tblPr><w:tblGrid>${grid}</w:tblGrid>${body}</w:tbl>${after}`;
}

/** Image insérée (rId de la relation, taille en cm). */
export function image(rId, id, wCm, hCm, name = 'image') {
  const cx = Math.round(wCm * 360000);
  const cy = Math.round(hCm * 360000);
  return `<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="${id}" name="${x(name)}"/><wp:cNvGraphicFramePr><a:graphicFrameLocks xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" noChangeAspect="1"/></wp:cNvGraphicFramePr><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="${id}" name="${x(name)}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${rId}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`;
}

/** Image placée derrière le texte, centrée sur la page ; décalage vertical (cm) par rapport au paragraphe qui la porte. */
export function imageBehind(rId, id, wCm, hCm, offsetCm, name = 'image') {
  const cx = Math.round(wCm * 360000);
  const cy = Math.round(hCm * 360000);
  return `<w:r><w:drawing><wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="0" relativeHeight="0" behindDoc="1" locked="0" layoutInCell="0" allowOverlap="1"><wp:simplePos x="0" y="0"/><wp:positionH relativeFrom="page"><wp:align>center</wp:align></wp:positionH><wp:positionV relativeFrom="paragraph"><wp:posOffset>${Math.round(offsetCm * 360000)}</wp:posOffset></wp:positionV><wp:extent cx="${cx}" cy="${cy}"/><wp:effectExtent l="0" t="0" r="0" b="0"/><wp:wrapNone/><wp:docPr id="${id}" name="${x(name)}"/><wp:cNvGraphicFramePr/><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="${id}" name="${x(name)}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${rId}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:anchor></w:drawing></w:r>`;
}

const NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"';
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const relsXml = (list) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
${list.map(([id, type, target]) => `<Relationship Id="${id}" Type="${REL}/${type}" Target="${target}"/>`).join('\n')}
</Relationships>`;

/**
 * Assemble le document.
 * @param {object} d
 *   body     : XML des paragraphes
 *   images   : [{ rId, bytes, ext }] images du corps
 *   styles   : styles.xml complet ; numbering : numbering.xml (facultatif)
 *   header, footer, firstHeader, firstFooter : { xml, images: [{ rId, bytes, ext }] } (facultatifs)
 *   margins  : { top, right, bottom, left, header, footer } en twips
 */
export function buildDocx({ body, images = [], styles, numbering = null, header = null, footer = null, firstHeader = null, firstFooter = null, margins = {}, title = '' }) {
  const m = { top: 1418, right: 1418, bottom: 1134, left: 1418, header: 567, footer: 397, ...margins };
  const files = [];
  const media = [];
  const docRels = [['rIdStyles', 'styles', 'styles.xml'], ['rIdSettings', 'settings', 'settings.xml']];
  if (numbering) docRels.push(['rIdNumbering', 'numbering', 'numbering.xml']);
  const addMedia = (prefix, list, rels) => list.forEach((im) => {
    const name = `${prefix}_${im.rId}.${im.ext || 'png'}`;
    media.push({ name: `word/media/${name}`, data: im.bytes });
    rels.push([im.rId, 'image', `media/${name}`]);
  });
  addMedia('doc', images, docRels);

  const overrides = [];
  const parts = [['header', header, 'default', 'hdr'], ['footer', footer, 'default', 'ftr'], ['header', firstHeader, 'first', 'hdr'], ['footer', firstFooter, 'first', 'ftr']];
  const refs = [];
  parts.forEach(([kind, part, type, tag], i) => {
    if (!part) return;
    const name = `${kind}${i + 1}.xml`;
    const rId = `rId${kind}${i + 1}`;
    const rels = [];
    addMedia(`${kind}${i + 1}`, part.images || [], rels);
    files.push({ name: `word/${name}`, data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:${tag} ${NS}>${part.xml || '<w:p/>'}</w:${tag}>` });
    if (rels.length) files.push({ name: `word/_rels/${name}.rels`, data: relsXml(rels) });
    docRels.push([rId, kind, name]);
    refs.push(`<w:${kind}Reference w:type="${type}" r:id="${rId}"/>`);
    overrides.push(`<Override PartName="/word/${name}" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.${kind}+xml"/>`);
  });
  const titlePg = firstHeader || firstFooter ? '<w:titlePg/>' : '';
  const sect = `<w:sectPr>${refs.join('')}<w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="${m.top}" w:right="${m.right}" w:bottom="${m.bottom}" w:left="${m.left}" w:header="${m.header}" w:footer="${m.footer}" w:gutter="0"/>${titlePg}</w:sectPr>`;
  const doc = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document ${NS}><w:body>${body}${sect}</w:body></w:document>`;
  const settings = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:settings xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:defaultTabStop w:val="708"/><w:hyphenationZone w:val="425"/><w:characterSpacingControl w:val="doNotCompress"/><w:decimalSymbol w:val="."/><w:listSeparator w:val=";"/></w:settings>`;
  const now = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
  const core = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${x(title)}</dc:title><dc:language>fr-CH</dc:language><dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified></cp:coreProperties>`;
  const types = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Default Extension="png" ContentType="image/png"/>
<Default Extension="jpg" ContentType="image/jpeg"/>
<Default Extension="jpeg" ContentType="image/jpeg"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
<Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/>
${numbering ? '<Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>' : ''}
${overrides.join('\n')}
<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
</Types>`;
  const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="${REL}/officeDocument" Target="word/document.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
</Relationships>`;
  return zip([
    { name: '[Content_Types].xml', data: types },
    { name: '_rels/.rels', data: rootRels },
    { name: 'docProps/core.xml', data: core },
    { name: 'word/document.xml', data: doc },
    { name: 'word/styles.xml', data: styles },
    { name: 'word/settings.xml', data: settings },
    ...(numbering ? [{ name: 'word/numbering.xml', data: numbering }] : []),
    { name: 'word/_rels/document.xml.rels', data: relsXml(docRels) },
    ...files,
    ...media,
  ]);
}
