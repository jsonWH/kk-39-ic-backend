const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  Header, Footer, AlignmentType, BorderStyle, WidthType, ShadingType,
  VerticalAlign, PageNumber, TabStopType, LevelFormat, PageBreak, ImageRun
} = require('docx');
const fs   = require('fs');
const path = require('path');

const data = JSON.parse(
  fs.readFileSync(process.env.IC_DATA_PATH || '/tmp/ic_paper_data.json', 'utf8')
);

// ── Colours ───────────────────────────────────────────────────────────────
const RED        = "C0392B";
const DARK       = "1A1A18";
const MUTED      = "6B6B65";
const BORDER_CLR = "DDDDDD";
const WHITE      = "FFFFFF";
const LIGHT_GRAY = "F7F7F5";

// ── Page dims (A4) ────────────────────────────────────────────────────────
const PAGE_W    = 11906;
const MARGIN    = 1134;
const CONTENT_W = PAGE_W - MARGIN * 2;  // 9638

// ── Core helpers ──────────────────────────────────────────────────────────
const bdr    = (c=BORDER_CLR, s=4) => ({ style:BorderStyle.SINGLE, size:s, color:c });
const noB    = ()                   => ({ style:BorderStyle.NONE,   size:0, color:WHITE });
const allB   = (c, s) => ({ top:bdr(c,s), bottom:bdr(c,s), left:bdr(c,s), right:bdr(c,s) });
const noAllB = ()     => ({ top:noB(), bottom:noB(), left:noB(), right:noB() });

function r(text, o={}) {
  return new TextRun({
    text, font:"Arial", size:o.size||20,
    bold:o.bold||false, italics:o.italics||false, color:o.color||DARK, ...o
  });
}
const sp = (pts=1) => new Paragraph({ children:[r("")], spacing:{before:0, after:pts*20} });

// ── Headings ──────────────────────────────────────────────────────────────
const h1 = text => new Paragraph({
  children:[r(text, {size:26, bold:true, color:RED})],
  spacing:{before:360, after:140},
  border:{bottom:{style:BorderStyle.SINGLE, size:8, color:RED}}
});
const h2 = text => new Paragraph({
  children:[r(text, {size:21, bold:true, color:DARK})],
  spacing:{before:240, after:80},
  border:{bottom:{style:BorderStyle.SINGLE, size:2, color:BORDER_CLR}}
});
const h3 = text => new Paragraph({
  children:[r(text, {size:20, bold:true, color:RED})],
  spacing:{before:180, after:60}
});

// ── Body paragraph with inline bold/italic ────────────────────────────────
function parseInline(text) {
  const runs  = [];
  const parts = text.split(/(\*\*[^*]+\*\*|\*[^*]+\*)/g);
  for (const p of parts) {
    if (p.startsWith('**') && p.endsWith('**'))
      runs.push(r(p.slice(2,-2), {bold:true, size:20}));
    else if (p.startsWith('*') && p.endsWith('*'))
      runs.push(r(p.slice(1,-1), {italics:true, size:20}));
    else if (p)
      runs.push(r(p, {size:20}));
  }
  return runs.length ? runs : [r(text, {size:20})];
}

const bodyP = (text, after=140) => new Paragraph({
  children:   parseInline(text),
  spacing:    {before:0, after, line:290},
  alignment:  AlignmentType.JUSTIFIED
});

// ── Markdown table → Word Table ───────────────────────────────────────────
function mdTable(text, colRatios, smallFont=false) {
  const lines    = text.split('\n').map(l=>l.trim()).filter(l=>l && !l.match(/^[\|\s\-:]+$/));
  if (lines.length < 2) return null;
  const parseRow = l => l.split('|').map(c=>c.trim()).filter(c=>c!=='');
  const headers  = parseRow(lines[0]);
  const bodyRows = lines.slice(1);
  const n        = headers.length;

  let cw;
  if (colRatios && colRatios.length === n) {
    const tot = colRatios.reduce((a,b)=>a+b, 0);
    cw = colRatios.map(r => Math.floor(CONTENT_W * r / tot));
  } else {
    cw = Array(n).fill(Math.floor(CONTENT_W / n));
  }
  cw[cw.length-1] += CONTENT_W - cw.reduce((a,b)=>a+b, 0);

  const fs = smallFont ? 16 : 18;

  const mkCell = (text, isHdr, w, alt) => new TableCell({
    borders:  allB(BORDER_CLR, 4),
    shading:  {fill: isHdr ? RED : (alt ? LIGHT_GRAY : WHITE), type:ShadingType.CLEAR},
    margins:  {top:80, bottom:80, left:140, right:140},
    width:    {size:w, type:WidthType.DXA},
    verticalAlign: VerticalAlign.CENTER,
    children: [new Paragraph({
      children:  [r(text, {bold:isHdr, color:isHdr?WHITE:DARK, size:fs})],
      spacing:   {before:0, after:0},
      alignment: AlignmentType.LEFT
    })]
  });

  return new Table({
    width:        {size:CONTENT_W, type:WidthType.DXA},
    columnWidths: cw,
    rows: [
      new TableRow({
        tableHeader: true,
        children:    headers.map((h,i) => mkCell(h, true, cw[i], false))
      }),
      ...bodyRows.map((line, ri) => {
        const cells = parseRow(line);
        while (cells.length < n) cells.push('');
        return new TableRow({
          children: cells.map((c,i) => mkCell(c, false, cw[i], ri%2===1))
        });
      })
    ]
  });
}

// ── Image embed helper ────────────────────────────────────────────────────
function embedImage(imgPath, targetWidthDxa) {
  if (!fs.existsSync(imgPath)) return null;
  const buf = fs.readFileSync(imgPath);
  const ext = path.extname(imgPath).replace('.','').toLowerCase();
  const typeMap  = {png:'png', jpg:'jpg', jpeg:'jpg'};
  const imgType  = typeMap[ext] || 'png';

  let origW=800, origH=600;
  try {
    if (ext==='png') {
      origW = buf.readUInt32BE(16); origH = buf.readUInt32BE(20);
    } else if (ext==='jpg' || ext==='jpeg') {
      let i=2;
      while (i < buf.length) {
        if (buf[i] !== 0xFF) break;
        const marker = buf[i+1];
        if (marker===0xC0 || marker===0xC2) {
          origH=buf.readUInt16BE(i+5); origW=buf.readUInt16BE(i+7); break;
        }
        i += 2 + buf.readUInt16BE(i+2);
      }
    }
  } catch(e) {}

  const dxaToEmu  = 914400/1440;
  const widthEmu  = targetWidthDxa * dxaToEmu;
  const heightEmu = Math.round(widthEmu * (origH/origW));

  return new Paragraph({
    children:  [new ImageRun({data:buf, transformation:{width:widthEmu/9525, height:heightEmu/9525}, type:imgType})],
    spacing:   {before:80, after:120},
    alignment: AlignmentType.CENTER
  });
}

// ── Convert text blocks → Word elements ───────────────────────────────────
function toElements(text, colRatios, smallFont=false) {
  if (!text) return [bodyP("(Content not available)")];
  const els = [];

  for (const block of text.split(/\n{2,}/)) {
    const t = block.trim();
    if (!t) continue;

    // Table detection
    const tlines  = t.split('\n').filter(l => l.includes('|'));
    const nonSep  = t.split('\n').filter(l => l.trim() && !l.match(/^[\|\s\-:]+$/));
    if (tlines.length >= 2 && tlines.length >= nonSep.length - 1) {
      const tbl = mdTable(t, colRatios, smallFont);
      if (tbl) { els.push(tbl); els.push(sp(6)); continue; }
    }

    if (t.startsWith('### ')) { els.push(h3(t.slice(4)));  continue; }
    if (t.startsWith('## '))  { els.push(h2(t.slice(3)));  continue; }
    if (/^\*\*[^*]+\*\*$/.test(t)) { els.push(h3(t.replace(/\*\*/g,''))); continue; }

    // Bullet list
    const blines = t.split('\n');
    if (blines.length > 1 && blines.every(l => /^[\-•]\s/.test(l.trim()))) {
      for (const l of blines) {
        const txt = l.replace(/^[\s\-•]+/, '');
        if (txt) els.push(new Paragraph({
          children: parseInline(txt),
          spacing:  {before:0, after:80, line:276},
          indent:   {left:360, hanging:200}
        }));
      }
      continue;
    }

    els.push(bodyP(t));
  }
  return els.length ? els : [bodyP(text)];
}

// ── Cover block ───────────────────────────────────────────────────────────
function coverBlock() {
  const cw3 = [
    Math.floor(CONTENT_W/3),
    Math.floor(CONTENT_W/3),
    CONTENT_W - Math.floor(CONTENT_W/3)*2
  ];
  const metaCell = (lbl, val, w) => new TableCell({
    borders:  noAllB(),
    margins:  {top:60, bottom:60, left:0, right:140},
    width:    {size:w, type:WidthType.DXA},
    children: [
      new Paragraph({children:[r(lbl, {size:15, color:MUTED})],     spacing:{after:30}}),
      new Paragraph({children:[r(val||"—", {size:20, bold:true})],  spacing:{after:0}}),
    ]
  });
  return [
    new Paragraph({
      children: [r(data.meta.fundName+" Investment Memo", {size:32, bold:true, color:RED})],
      spacing:  {before:200, after:80}
    }),
    new Paragraph({
      children: [r("KK39 Ventures  ·  Confidential  ·  "+data.meta.submissionDate, {size:18, color:MUTED})],
      spacing:  {before:0, after:200},
      border:   {bottom:{style:BorderStyle.SINGLE, size:8, color:RED}}
    }),
    sp(10),
    new Table({
      width: {size:CONTENT_W, type:WidthType.DXA}, columnWidths:cw3,
      rows: [new TableRow({children:[
        metaCell("Proposed Allocation", data.meta.allocation,  cw3[0]),
        metaCell("Written By",          data.meta.writtenBy,   cw3[1]),
        metaCell("Endorsed By",         data.meta.endorsedBy,  cw3[2]),
      ]})]
    }),
    sp(14),
  ];
}

// ── Executive Summary ─────────────────────────────────────────────────────
function execSummary() {
  const S   = data.sections;
  const els = [];

  const sub = (label, content, colRatios) => {
    if (!content) return;
    if (content.includes('|')) {
      const tbl = mdTable(content, colRatios || [1.2,3]);
      els.push(h3(label));
      if (tbl) { els.push(tbl); els.push(sp(4)); }
      else      { els.push(bodyP(content)); els.push(sp(4)); }
    } else {
      els.push(new Paragraph({
        children:  [r(label+"  ", {bold:true, size:20, color:RED}), ...parseInline(content)],
        spacing:   {before:80, after:140, line:290},
        alignment: AlignmentType.JUSTIFIED
      }));
    }
  };

  sub("The Opportunity",   S.exec_summary_opportunity);
  sub("Management Team",   S.exec_summary_management);
  sub("The Fund",          S.exec_summary_fund);
  sub("Track Record",      S.exec_summary_track_record);
  sub("Value Proposition", S.exec_summary_value_prop, [1.2,3]);
  sub("Due Diligence",     S.exec_summary_dd);

  return els;
}

// ── Legends Scoring Table ─────────────────────────────────────────────────
// Now built programmatically from per-criterion opinions (p1a–p4b).
// Falls back gracefully if opinions are missing.
function legendsScoringTable() {
  const sc  = data.scores          || {};
  const op  = data.scoringOpinions || {};  // 12-key object: p1a … p4b

  // ── Compute pillar averages ──
  const p1avg = ((+sc.p1a + +sc.p1b) / 2);
  const p2avg = ((+sc.p2a + +sc.p2b + +sc.p2c + +sc.p2d) / 4);
  const p3avg = ((+sc.p3a + +sc.p3b + +sc.p3c + +sc.p3d) / 4);
  const p4avg = ((+sc.p4a + +sc.p4b) / 2);
  const final = (p1avg + p2avg*2 + p3avg*2 + p4avg) / 6;

  const verdict =
    final <= 2 ? "Pass" :
    final <= 3 ? "Needs Work" :
    final <= 4 ? "Conditional" : "Recommend";

  // ── Build per-section opinion strings from 12-key opinions ──
  // Each opinion cell shows the criterion-level rationales concatenated.
  const joinOps = (...keys) =>
    keys.map(k => op[k] || "").filter(Boolean).join("  ") ||
    keys.map(k => `${k.toUpperCase()}: ${sc[k]||"—"}/5`).join("  ·  ");

  const rows = [
    { section:"The Opportunity",  opinion:joinOps("p1a","p1b"),              score:p1avg },
    { section:"Management Team",  opinion:joinOps("p2a","p2b","p2c","p2d"),  score:p2avg },
    { section:"The Fund",         opinion:joinOps("p3a","p3b","p3c","p3d"),  score:p3avg },
    { section:"Track Record",     opinion:op.p2c || joinOps("p2c"),          score:+(sc.p2c||0) },
    { section:"Value Proposition",opinion:joinOps("p1a","p3a","p3d"),        score:final },
    { section:"Due Diligence",    opinion:op.p3c || joinOps("p3c"),          score:+(sc.p3c||0) },
    { section:"Legal",            opinion:joinOps("p4a","p4b"),              score:p4avg },
  ];

  // ── Column widths: Section 20%, Opinion 68%, Score 12% ──
  const cw = [
    Math.floor(CONTENT_W * 0.20),
    Math.floor(CONTENT_W * 0.68),
    CONTENT_W - Math.floor(CONTENT_W*0.20) - Math.floor(CONTENT_W*0.68)
  ];

  const hdrCell = (text, w) => new TableCell({
    borders:  allB(RED, 4),
    shading:  {fill:RED, type:ShadingType.CLEAR},
    margins:  {top:80, bottom:80, left:140, right:140},
    width:    {size:w, type:WidthType.DXA},
    children: [new Paragraph({
      children:  [r(text, {bold:true, color:WHITE, size:18})],
      spacing:   {before:0, after:0}
    })]
  });

  const sectionCell = (text, w, alt) => new TableCell({
    borders:  allB(BORDER_CLR, 4),
    shading:  {fill: alt ? LIGHT_GRAY : WHITE, type:ShadingType.CLEAR},
    margins:  {top:80, bottom:80, left:140, right:140},
    width:    {size:w, type:WidthType.DXA},
    verticalAlign: VerticalAlign.CENTER,
    children: [new Paragraph({
      children:  [r(text, {bold:true, size:18, color:DARK})],
      spacing:   {before:0, after:0}
    })]
  });

  // Opinion cell: wraps long text across multiple paragraphs if needed
  const opinionCell = (text, w, alt) => {
    // Split into sentences for better readability within the cell
    const sentences = text.match(/[^.!?]+[.!?]+/g) || [text];
    const paras = [];
    let chunk = "";
    for (const s of sentences) {
      chunk += s.trim() + " ";
      if (chunk.length > 180) {
        paras.push(chunk.trim()); chunk = "";
      }
    }
    if (chunk.trim()) paras.push(chunk.trim());

    return new TableCell({
      borders:  allB(BORDER_CLR, 4),
      shading:  {fill: alt ? LIGHT_GRAY : WHITE, type:ShadingType.CLEAR},
      margins:  {top:80, bottom:80, left:140, right:140},
      width:    {size:w, type:WidthType.DXA},
      children: paras.map((p, i) => new Paragraph({
        children:  parseInline(p),
        spacing:   {before:0, after: i < paras.length-1 ? 60 : 0, line:270},
        alignment: AlignmentType.LEFT
      }))
    });
  };

  const scoreCell = (score, w, alt) => new TableCell({
    borders:  allB(BORDER_CLR, 4),
    shading:  {fill: alt ? LIGHT_GRAY : WHITE, type:ShadingType.CLEAR},
    margins:  {top:80, bottom:80, left:140, right:140},
    width:    {size:w, type:WidthType.DXA},
    verticalAlign: VerticalAlign.CENTER,
    children: [new Paragraph({
      children:  [r(score.toFixed(2), {bold:true, size:18, color:RED})],
      alignment: AlignmentType.CENTER,
      spacing:   {before:0, after:0}
    })]
  });

  // ── Legends key (small table above main table) ──
  const legendKeyRows = [
    ["1", "Flagged issues with major concerns"],
    ["2", "Neutral evaluation with minor concerns"],
    ["3", "Positive evaluation with aspects to be considered"],
    ["4", "Positive evaluation with no or negligible concerns"],
  ];
  const lkCw = [Math.floor(CONTENT_W*0.08), CONTENT_W - Math.floor(CONTENT_W*0.08)];
  const legendKey = new Table({
    width: {size:CONTENT_W, type:WidthType.DXA}, columnWidths:lkCw,
    rows: legendKeyRows.map((row, ri) => new TableRow({
      children: [
        new TableCell({
          borders: allB(BORDER_CLR, 4),
          shading: {fill: ri%2===1 ? LIGHT_GRAY : WHITE, type:ShadingType.CLEAR},
          margins: {top:60, bottom:60, left:100, right:100},
          width:   {size:lkCw[0], type:WidthType.DXA},
          verticalAlign: VerticalAlign.CENTER,
          children:[new Paragraph({
            children:[r(row[0], {bold:true, size:17, color:RED})],
            alignment:AlignmentType.CENTER, spacing:{before:0,after:0}
          })]
        }),
        new TableCell({
          borders: allB(BORDER_CLR, 4),
          shading: {fill: ri%2===1 ? LIGHT_GRAY : WHITE, type:ShadingType.CLEAR},
          margins: {top:60, bottom:60, left:140, right:140},
          width:   {size:lkCw[1], type:WidthType.DXA},
          children:[new Paragraph({
            children:[r(row[1], {size:17, color:DARK})],
            spacing:{before:0,after:0}
          })]
        }),
      ]
    }))
  });

  // ── Main scoring table ──
  const scoringTable = new Table({
    width: {size:CONTENT_W, type:WidthType.DXA}, columnWidths:cw,
    rows: [
      new TableRow({
        tableHeader: true,
        children: [
          hdrCell("Section",          cw[0]),
          hdrCell("KK39's Opinions",  cw[1]),
          hdrCell("Scoring",          cw[2]),
        ]
      }),
      ...rows.map((row, ri) => new TableRow({
        children: [
          sectionCell(row.section,  cw[0], ri%2===1),
          opinionCell(row.opinion,  cw[1], ri%2===1),
          scoreCell(row.score,      cw[2], ri%2===1),
        ]
      }))
    ]
  });

  return [
    legendKey,
    sp(6),
    scoringTable,
    sp(4),
    new Paragraph({
      children: [
        r("Final Weighted Score: ", {bold:true, size:20}),
        r(`${final.toFixed(2)} — ${verdict}`, {bold:true, size:20, color:RED}),
        r(`   [ (P1 × 1) + (P2 × 2) + (P3 × 2) + (P4 × 1) ] / 6`,
          {size:16, color:MUTED, italics:true}),
      ],
      spacing:{before:60, after:120}
    }),
    sp(4),
  ];
}

// ── EXCO block ────────────────────────────────────────────────────────────
function excoBlock() {
  const names = ["Goh Yeow Lian","Goh Yew Tee","Goh Cheng Huah"];
  const cw    = names.map((_,i) =>
    i < 2 ? Math.floor(CONTENT_W/3) : CONTENT_W - Math.floor(CONTENT_W/3)*2
  );
  return [
    h2("EXCO Approval"),
    sp(4),
    new Table({
      width: {size:CONTENT_W, type:WidthType.DXA}, columnWidths:cw,
      rows: [new TableRow({children:names.map((name, i) => new TableCell({
        borders: noAllB(),
        margins: {top:80, bottom:80, left:0, right:200},
        width:   {size:cw[i], type:WidthType.DXA},
        children:[
          new Paragraph({
            children:[r(" ", {size:20})],
            spacing:{after:500},
            border:{bottom:{style:BorderStyle.SINGLE, size:4, color:BORDER_CLR}}
          }),
          new Paragraph({children:[r(name, {bold:true, size:19})], spacing:{after:30}}),
          new Paragraph({children:[r("EXCO Member", {size:17, color:MUTED})], spacing:{after:0}}),
        ]
      }))})]
    }),
    sp(10),
  ];
}

// ── Header & Footer ───────────────────────────────────────────────────────
const makeHeader = () => new Header({children:[new Paragraph({
  children:[
    r(data.meta.fundName+" Investment Memo", {size:16, color:MUTED}),
    new TextRun({children:["\t", PageNumber.CURRENT], size:16, color:MUTED, font:"Arial"})
  ],
  tabStops: [{type:TabStopType.RIGHT, position:CONTENT_W}],
  border:   {bottom:{style:BorderStyle.SINGLE, size:3, color:RED}},
  spacing:  {after:80}
})]});

const makeFooter = () => new Footer({children:[new Paragraph({
  children:[r(data.meta.fundName+"  ·  KK39 Ventures  ·  Confidential", {size:15, color:MUTED})],
  border:  {top:{style:BorderStyle.SINGLE, size:3, color:BORDER_CLR}},
  spacing: {before:80}
})]});

// ── Management team photo grid ────────────────────────────────────────────
function mgmtPhotoGrid(images) {
  if (!images || images.length === 0) return [];
  const headshots = images.filter(img => {
    const ratio = img.h / img.w;
    return ratio > 0.7 && ratio < 1.5 && img.w >= 150;
  });
  if (headshots.length === 0) return [];

  const perRow = Math.min(headshots.length, 3);
  const cellW  = Math.floor(CONTENT_W / perRow);
  const imgW   = Math.floor(cellW * 0.7);

  const cells = headshots.slice(0, perRow).map(img => {
    const imgEl = embedImage(img.path, imgW);
    return new TableCell({
      borders:  noAllB(),
      margins:  {top:60, bottom:60, left:60, right:60},
      width:    {size:cellW, type:WidthType.DXA},
      children: imgEl
        ? [imgEl]
        : [new Paragraph({children:[r("(Photo)", {size:18, color:MUTED, italics:true})]})]
    });
  });

  return [
    new Table({
      width:        {size:CONTENT_W, type:WidthType.DXA},
      columnWidths: headshots.slice(0, perRow).map(() => cellW),
      rows:         [new TableRow({children:cells})]
    }),
    sp(8)
  ];
}

// ── Image catalogue ───────────────────────────────────────────────────────
const imgs       = data.images || [];
const getImgs    = types => imgs.filter(i => types.includes(i.type));

const fundStructureImgs = getImgs(['fund_structure','diagram','chart']);
const portfolioImgs     = getImgs(['portfolio_table','schedule']);
const mgmtImgs          = getImgs(['headshot','management']);
const trackRecordImgs   = getImgs(['performance','track_record']);

// ── Assemble document ─────────────────────────────────────────────────────
const S = data.sections;

const children = [

  // ── Cover ──
  ...coverBlock(),

  // ── Executive Summary ──
  h1("Executive Summary"),
  ...execSummary(),
  sp(8),

  // ── KK39 Legends Scoring ──
  // Placed between Executive Summary and EXCO block, matching house format.
  // Built programmatically from per-criterion scoringOpinions (p1a–p4b).
  h2("KK39 Scoring"),
  ...legendsScoringTable(),
  sp(6),

  // ── EXCO Approval (first instance — after exec summary) ──
  ...excoBlock(),

  new Paragraph({children:[new PageBreak()], spacing:{after:0}}),

  // ── 1 — The Opportunity ──
  h1("1   The Opportunity"),
  ...toElements(S.opportunity || ""),
  ...fundStructureImgs.slice(0,2).flatMap(img => {
    const el = embedImage(img.path, CONTENT_W);
    return el ? [el, sp(4)] : [];
  }),
  sp(8),

  // ── 2 — Management Team ──
  h1("2   Management Team"),
  ...mgmtPhotoGrid(mgmtImgs),
  ...toElements(S.management || "", [2.5,2,2,1]),
  sp(8),

  // ── 3 — The Fund ──
  h1("3   The Fund"),
  ...toElements(S.fund || "", [1.2,2]),
  sp(8),

  // ── 4 — Track Record ──
  h1("4   Track Record"),
  ...toElements(S.track_record || ""),
  ...trackRecordImgs.slice(0,1).flatMap(img => {
    const el = embedImage(img.path, CONTENT_W);
    return el ? [el, sp(4)] : [];
  }),
  ...portfolioImgs.slice(0,2).flatMap(img => {
    const el = embedImage(img.path, CONTENT_W);
    return el ? [el, sp(4)] : [];
  }),
  sp(8),

  // ── 5 — Value Proposition ──
  h1("5   Value Proposition"),
  ...toElements(S.value_prop || ""),
  sp(8),

  // ── 6 — Due Diligence ──
  h1("6   Due Diligence"),
  ...toElements(S.due_diligence || "", [1,1.2,1.5,2.5]),
  sp(8),

  // ── 7 — Legal ──
  h1("7   Legal"),
  ...toElements(S.legal || "", [1.2,1,2.5]),
  sp(8),

  // ── 8 — Final Recommendation ──
  h1("8   Final Recommendation"),
  ...toElements(S.recommendation || ""),
  sp(12),

  // ── EXCO Approval (second instance — end of paper) ──
  ...excoBlock(),
];

// ── Render ────────────────────────────────────────────────────────────────
const doc = new Document({
  numbering:{config:[{reference:"bullets", levels:[{
    level:0, format:LevelFormat.BULLET, text:"•", alignment:AlignmentType.LEFT,
    style:{paragraph:{indent:{left:360, hanging:200}}}
  }]}]},
  styles:{default:{document:{run:{font:"Arial", size:20, color:DARK}}}},
  sections:[{
    properties:{page:{
      size:   {width:PAGE_W, height:16838},
      margin: {top:MARGIN, right:MARGIN, bottom:MARGIN, left:MARGIN}
    }},
    headers: {default:makeHeader()},
    footers: {default:makeFooter()},
    children
  }]
});

Packer.toBuffer(doc)
  .then(buf => {
    fs.writeFileSync(process.env.IC_OUTPUT_PATH || '/tmp/ic_paper_output.docx', buf);
    console.log('OK');
  })
  .catch(e => { console.error('ERROR:', e.message); process.exit(1); });
