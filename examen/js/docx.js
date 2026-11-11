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
 */
export function p(content, o = {}) {
  const runs = Array.isArray(content)
    ? content.map((c) => (Array.isArray(c) ? run(c[0], c[1]) : String(c).startsWith('<w:') ? c : run(c))).join('')
    : run(content, o);
  const ppr = [
    o.style ? `<w:pStyle w:val="${o.style}"/>` : '',
    o.keepNext ? '<w:keepNext/>' : '',
    o.pageBreakBefore ? '<w:pageBreakBefore/>' : '',
    o.spaceBefore != null || o.spaceAfter != null ? `<w:spacing${o.spaceBefore != null ? ` w:before="${o.spaceBefore}"` : ''}${o.spaceAfter != null ? ` w:after="${o.spaceAfter}"` : ''}/>` : '',
    o.align ? `<w:jc w:val="${o.align}"/>` : '',
  ].join('');
  return `<w:p>${ppr ? `<w:pPr>${ppr}</w:pPr>` : ''}${runs}</w:p>`;
}

export const h1 = (t, o = {}) => p(t, { style: 'Heading1', ...o });
export const h2 = (t) => p(t, { style: 'Heading2' });
export const pageBreak = () => '<w:p><w:r><w:br w:type="page"/></w:r></w:p>';

/**
 * Tableau.
 * @param {Array<Array<string|{text,bold,fill,span}>>} rows
 * @param {object} o { widths: [en % de la largeur], header: true, minHeight: twips pour les lignes vides }
 */
export function table(rows, o = {}) {
  const total = o.total || 9638;
  const widths = (o.widths || rows[0].map(() => 100 / rows[0].length)).map((w) => Math.round((w / 100) * total));
  const border = '<w:top w:val="single" w:sz="6" w:color="7F7F7F"/><w:left w:val="single" w:sz="6" w:color="7F7F7F"/><w:bottom w:val="single" w:sz="6" w:color="7F7F7F"/><w:right w:val="single" w:sz="6" w:color="7F7F7F"/><w:insideH w:val="single" w:sz="4" w:color="A6A6A6"/><w:insideV w:val="single" w:sz="4" w:color="A6A6A6"/>';
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
      const tcpr = `<w:tcW w:w="${w}" w:type="dxa"/>${span > 1 ? `<w:gridSpan w:val="${span}"/>` : ''}${fill ? `<w:shd w:val="clear" w:color="auto" w:fill="${fill}"/>` : ''}`;
      const paras = Array.isArray(c.text) ? c.text : [c.text ?? ''];
      const content = paras.map((t) => (String(t).startsWith('<w:p') ? t : p([[t, { bold: c.bold || isHead, size: o.size || 10, color: c.color, italic: c.italic }]], { spaceBefore: 30, spaceAfter: 30 }))).join('');
      return `<w:tc><w:tcPr>${tcpr}</w:tcPr>${content}</w:tc>`;
    }).join('');
    const empty = r.every((cell) => !(typeof cell === 'object' && cell ? cell.text : cell)) || (ri > 0 && r.slice(1).every((cell) => !(typeof cell === 'object' && cell ? cell.text : cell)));
    const trpr = [isHead ? '<w:tblHeader/><w:cantSplit/>' : '<w:cantSplit/>', o.minHeight && !isHead && empty ? `<w:trHeight w:val="${o.minHeight}"/>` : ''].join('');
    return `<w:tr><w:trPr>${trpr}</w:trPr>${cells}</w:tr>`;
  }).join('');
  return `<w:tbl><w:tblPr><w:tblW w:w="${total}" w:type="dxa"/><w:tblBorders>${border}</w:tblBorders><w:tblLayout w:type="fixed"/><w:tblCellMar><w:left w:w="80" w:type="dxa"/><w:right w:w="80" w:type="dxa"/></w:tblCellMar></w:tblPr><w:tblGrid>${grid}</w:tblGrid>${body}</w:tbl>${p('', { spaceAfter: 60 })}`;
}

/** Image insérée (rId de la relation, taille en cm). */
export function image(rId, id, wCm, hCm, name = 'image') {
  const cx = Math.round(wCm * 360000);
  const cy = Math.round(hCm * 360000);
  return `<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="${id}" name="${x(name)}"/><wp:cNvGraphicFramePr><a:graphicFrameLocks xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" noChangeAspect="1"/></wp:cNvGraphicFramePr><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="${id}" name="${x(name)}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${rId}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`;
}

const STYLES = (accent) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:eastAsia="Arial" w:cs="Arial"/><w:sz w:val="21"/><w:szCs w:val="21"/><w:lang w:val="fr-CH"/></w:rPr></w:rPrDefault>
<w:pPrDefault><w:pPr><w:spacing w:after="100" w:line="264" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>
<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:before="0" w:after="120"/></w:pPr><w:rPr><w:b/><w:color w:val="${accent}"/><w:sz w:val="52"/><w:szCs w:val="52"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:pBdr><w:bottom w:val="single" w:sz="12" w:space="2" w:color="${accent}"/></w:pBdr><w:spacing w:before="360" w:after="140"/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:color w:val="${accent}"/><w:sz w:val="30"/><w:szCs w:val="30"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="200" w:after="80"/><w:outlineLvl w:val="1"/></w:pPr><w:rPr><w:b/><w:color w:val="404040"/><w:sz w:val="23"/><w:szCs w:val="23"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Footer"><w:name w:val="footer"/><w:basedOn w:val="Normal"/><w:rPr><w:color w:val="808080"/><w:sz w:val="16"/><w:szCs w:val="16"/></w:rPr></w:style>
</w:styles>`;

/**
 * Assemble le document.
 * @param {object} d { body: string (XML des paragraphes), images: [{rId, bytes}], footer: string, accent }
 */
export function buildDocx({ body, images = [], footer = '', accent = '7B3F00', title = '' }) {
  const NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"';
  const fld = (instr) => `<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> ${instr} </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>1</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r>`;
  const footerXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:ftr ${NS}><w:p><w:pPr><w:pStyle w:val="Footer"/><w:tabs><w:tab w:val="right" w:pos="9638"/></w:tabs></w:pPr>${run(footer)}<w:r><w:tab/></w:r>${run('Page ')}${fld('PAGE')}${run(' / ')}${fld('NUMPAGES')}</w:p></w:ftr>`;
  const sect = '<w:sectPr><w:footerReference w:type="default" r:id="rIdFooter"/><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="567" w:footer="567" w:gutter="0"/></w:sectPr>';
  const doc = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document ${NS}><w:body>${body}${sect}</w:body></w:document>`;
  const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
<Relationship Id="rIdSettings" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings" Target="settings.xml"/>
<Relationship Id="rIdFooter" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/>
${images.map((im) => `<Relationship Id="${im.rId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/${im.rId}.png"/>`).join('\n')}
</Relationships>`;
  const settings = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:settings xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:defaultTabStop w:val="708"/><w:decimalSymbol w:val="."/><w:listSeparator w:val=";"/></w:settings>`;
  const now = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
  const core = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${x(title)}</dc:title><dc:language>fr-CH</dc:language><dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified></cp:coreProperties>`;
  const types = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Default Extension="png" ContentType="image/png"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
<Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/>
<Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/>
<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
</Types>`;
  const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
</Relationships>`;
  return zip([
    { name: '[Content_Types].xml', data: types },
    { name: '_rels/.rels', data: rootRels },
    { name: 'docProps/core.xml', data: core },
    { name: 'word/document.xml', data: doc },
    { name: 'word/styles.xml', data: STYLES(accent) },
    { name: 'word/settings.xml', data: settings },
    { name: 'word/footer1.xml', data: footerXml },
    { name: 'word/_rels/document.xml.rels', data: rels },
    ...images.map((im) => ({ name: `word/media/${im.rId}.png`, data: im.bytes })),
  ]);
}
