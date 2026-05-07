const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  Header, Footer, AlignmentType, BorderStyle, WidthType, ShadingType,
  VerticalAlign, PageNumber, TabStopType, LevelFormat, PageBreak, ImageRun
} = require('docx');
const fs = require('fs');
const path = require('path');

const data = JSON.parse(fs.readFileSync(process.env.IC_DATA_PATH || '/tmp/ic_paper_data.json', 'utf8'));

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
const CONTENT_W = PAGE_W - MARGIN * 2;   // 9638

// ── Core helpers ──────────────────────────────────────────────────────────
const bdr  = (c=BORDER_CLR,s=4) => ({style:BorderStyle.SINGLE,size:s,color:c});
const noB  = () => ({style:BorderStyle.NONE,size:0,color:WHITE});
const allB = (c,s) => ({top:bdr(c,s),bottom:bdr(c,s),left:bdr(c,s),right:bdr(c,s)});
const noAllB = () => ({top:noB(),bottom:noB(),left:noB(),right:noB()});

function r(text, o={}) {
  return new TextRun({text, font:"Arial", size:o.size||20,
    bold:o.bold||false, italics:o.italics||false, color:o.color||DARK, ...o});
}
const sp = (pts=1) => new Paragraph({children:[r("")],spacing:{before:0,after:pts*20}});

// ── Headings ──────────────────────────────────────────────────────────────
const h1 = text => new Paragraph({
  children:[r(text,{size:26,bold:true,color:RED})],
  spacing:{before:360,after:140},
  border:{bottom:{style:BorderStyle.SINGLE,size:8,color:RED}}
});
const h2 = text => new Paragraph({
  children:[r(text,{size:21,bold:true,color:DARK})],
  spacing:{before:240,after:80},
  border:{bottom:{style:BorderStyle.SINGLE,size:2,color:BORDER_CLR}}
});
const h3 = text => new Paragraph({
  children:[r(text,{size:20,bold:true,color:RED})],
  spacing:{before:180,after:60}
});

// ── Body paragraph with inline bold/italic ────────────────────────────────
function parseInline(text) {
  const runs=[];
  const parts=text.split(/(\*\*[^*]+\*\*|\*[^*]+\*)/g);
  for(const p of parts){
    if(p.startsWith('**')&&p.endsWith('**')) runs.push(r(p.slice(2,-2),{bold:true,size:20}));
    else if(p.startsWith('*')&&p.endsWith('*')) runs.push(r(p.slice(1,-1),{italics:true,size:20}));
    else if(p) runs.push(r(p,{size:20}));
  }
  return runs.length?runs:[r(text,{size:20})];
}
const bodyP = (text,after=140) => new Paragraph({
  children:parseInline(text),
  spacing:{before:0,after,line:290},
  alignment:AlignmentType.JUSTIFIED
});

// ── Markdown table → Word Table ───────────────────────────────────────────
function mdTable(text, colRatios, smallFont=false) {
  const lines=text.split('\n').map(l=>l.trim()).filter(l=>l&&!l.match(/^[\|\s\-:]+$/));
  if(lines.length<2) return null;
  const parseRow = l=>l.split('|').map(c=>c.trim()).filter(c=>c!=='');
  const headers=parseRow(lines[0]);
  const bodyRows=lines.slice(1);
  const n=headers.length;
  let cw;
  if(colRatios&&colRatios.length===n){
    const tot=colRatios.reduce((a,b)=>a+b,0);
    cw=colRatios.map(r=>Math.floor(CONTENT_W*r/tot));
  } else {
    cw=Array(n).fill(Math.floor(CONTENT_W/n));
  }
  cw[cw.length-1]+=CONTENT_W-cw.reduce((a,b)=>a+b,0);
  const fs=smallFont?16:18;

  const mkCell=(text,isHdr,w,alt)=>new TableCell({
    borders:allB(BORDER_CLR,4),
    shading:{fill:isHdr?RED:(alt?LIGHT_GRAY:WHITE),type:ShadingType.CLEAR},
    margins:{top:80,bottom:80,left:140,right:140},
    width:{size:w,type:WidthType.DXA},
    verticalAlign:VerticalAlign.CENTER,
    children:[new Paragraph({
      children:[r(text,{bold:isHdr,color:isHdr?WHITE:DARK,size:fs})],
      spacing:{before:0,after:0},alignment:AlignmentType.LEFT
    })]
  });

  return new Table({
    width:{size:CONTENT_W,type:WidthType.DXA}, columnWidths:cw,
    rows:[
      new TableRow({tableHeader:true, children:headers.map((h,i)=>mkCell(h,true,cw[i],false))}),
      ...bodyRows.map((line,ri)=>{
        const cells=parseRow(line);
        while(cells.length<n) cells.push('');
        return new TableRow({children:cells.map((c,i)=>mkCell(c,false,cw[i],ri%2===1))});
      })
    ]
  });
}

// ── Image embed helper ────────────────────────────────────────────────────
function embedImage(imgPath, targetWidthDxa) {
  if(!fs.existsSync(imgPath)) return null;
  const buf = fs.readFileSync(imgPath);
  const ext = path.extname(imgPath).replace('.','').toLowerCase();
  const typeMap = {png:'png', jpg:'jpg', jpeg:'jpg'};
  const imgType = typeMap[ext]||'png';

  // Read actual dimensions using basic PNG/JPEG header parsing
  let origW=800, origH=600;
  try {
    if(ext==='png'){
      origW=buf.readUInt32BE(16); origH=buf.readUInt32BE(20);
    } else if(ext==='jpg'||ext==='jpeg'){
      let i=2;
      while(i<buf.length){
        if(buf[i]!==0xFF) break;
        const marker=buf[i+1];
        if(marker===0xC0||marker===0xC2){origH=buf.readUInt16BE(i+5);origW=buf.readUInt16BE(i+7);break;}
        i+=2+buf.readUInt16BE(i+2);
      }
    }
  } catch(e){}

  const dxaToEmu = 914400/1440;
  const widthEmu = targetWidthDxa * dxaToEmu;
  const aspectRatio = origH/origW;
  const heightEmu = Math.round(widthEmu * aspectRatio);

  return new Paragraph({
    children:[new ImageRun({data:buf, transformation:{width:widthEmu/9525,height:heightEmu/9525}, type:imgType})],
    spacing:{before:80,after:120},
    alignment:AlignmentType.CENTER
  });
}

// ── Convert text blocks → Word elements ──────────────────────────────────
function toElements(text, colRatios, smallFont=false) {
  if(!text) return [bodyP("(Content not available)")];
  const els=[];
  for(const block of text.split(/\n{2,}/)){
    const t=block.trim();
    if(!t) continue;

    // Table detection
    const tlines=t.split('\n').filter(l=>l.includes('|'));
    if(tlines.length>=2){
      const nonSep=t.split('\n').filter(l=>l.trim()&&!l.match(/^[\|\s\-:]+$/));
      if(tlines.length>=nonSep.length-1){
        const tbl=mdTable(t,colRatios,smallFont);
        if(tbl){els.push(tbl);els.push(sp(6));continue;}
      }
    }

    if(t.startsWith('### ')){els.push(h3(t.slice(4)));continue;}
    if(t.startsWith('## ')){ els.push(h2(t.slice(3)));continue;}
    if(/^\*\*[^*]+\*\*$/.test(t)){els.push(h3(t.replace(/\*\*/g,'')));continue;}

    // Bullet list
    const blines=t.split('\n');
    if(blines.length>1&&blines.every(l=>/^[\-•]\s/.test(l.trim()))){
      for(const l of blines){
        const txt=l.replace(/^[\s\-•]+/,'');
        if(txt) els.push(new Paragraph({
          children:parseInline(txt),
          spacing:{before:0,after:80,line:276},
          indent:{left:360,hanging:200}
        }));
      }
      continue;
    }

    els.push(bodyP(t));
  }
  return els.length?els:[bodyP(text)];
}

// ── Cover block ───────────────────────────────────────────────────────────
function coverBlock() {
  const cw3=[Math.floor(CONTENT_W/3),Math.floor(CONTENT_W/3),CONTENT_W-Math.floor(CONTENT_W/3)*2];
  const metaCell=(lbl,val,w)=>new TableCell({
    borders:noAllB(), margins:{top:60,bottom:60,left:0,right:140},
    width:{size:w,type:WidthType.DXA},
    children:[
      new Paragraph({children:[r(lbl,{size:15,color:MUTED})],spacing:{after:30}}),
      new Paragraph({children:[r(val||"—",{size:20,bold:true,color:DARK})],spacing:{after:0}}),
    ]
  });
  return [
    new Paragraph({
      children:[r(data.meta.fundName+" Investment Memo",{size:32,bold:true,color:RED})],
      spacing:{before:200,after:80}
    }),
    new Paragraph({
      children:[r("KK39 Ventures  ·  Confidential  ·  "+data.meta.submissionDate,{size:18,color:MUTED})],
      spacing:{before:0,after:200},
      border:{bottom:{style:BorderStyle.SINGLE,size:8,color:RED}}
    }),
    sp(10),
    new Table({
      width:{size:CONTENT_W,type:WidthType.DXA}, columnWidths:cw3,
      rows:[new TableRow({children:[
        metaCell("Proposed Allocation",data.meta.allocation,cw3[0]),
        metaCell("Written By",data.meta.writtenBy,cw3[1]),
        metaCell("Endorsed By",data.meta.endorsedBy,cw3[2]),
      ]})]
    }),
    sp(14),
  ];
}

// ── Executive Summary ─────────────────────────────────────────────────────
// Flows as connected paragraphs with sub-labels inline, no sub-headers
function execSummary() {
  const S=data.sections;
  const els=[];

  // Each sub-section: bold label inline, then paragraph
  const sub=(label, content, colRatios)=>{
    if(!content) return;
    // Check if it's a table
    if(content.includes('|')){
      const tbl=mdTable(content, colRatios||[1.2,3]);
      els.push(h3(label));
      if(tbl){els.push(tbl);els.push(sp(4));}
      else {els.push(bodyP(content));els.push(sp(4));}
    } else {
      els.push(new Paragraph({
        children:[r(label+"  ",{bold:true,size:20,color:RED}), ...parseInline(content)],
        spacing:{before:80,after:140,line:290},
        alignment:AlignmentType.JUSTIFIED
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

// ── Scoring table ─────────────────────────────────────────────────────────
function scoringTable() {
  const sc=data.scores;
  const p1=(sc.p1a+sc.p1b)/2;
  const p2=(sc.p2a+sc.p2b+sc.p2c+sc.p2d)/4;
  const p3=(sc.p3a+sc.p3b+sc.p3c+sc.p3d)/4;
  const p4=(sc.p4a+sc.p4b)/2;
  const final=(p1+p2*2+p3*2+p4)/6;
  const verdict=final<=2?"Pass":final<=3?"Needs Work":final<=4?"Conditional":"Recommend";

  const cw=[Math.floor(CONTENT_W*0.22),Math.floor(CONTENT_W*0.63),CONTENT_W-Math.floor(CONTENT_W*0.22)-Math.floor(CONTENT_W*0.63)];
  const opinions = data.scoringOpinions || {};

  const rows=[
    ["The Opportunity",  opinions.p1 || `Sector trajectory: ${sc.p1a}/5.0  ·  Resilience: ${sc.p1b}/5.0`, p1.toFixed(2)],
    ["Management Team",  opinions.p2 || `Team: ${sc.p2a}/5.0  ·  Track record: ${sc.p2b}/5.0  ·  Investment record: ${sc.p2c}/5.0  ·  Value-add: ${sc.p2d}/5.0`, p2.toFixed(2)],
    ["The Fund",         opinions.p3 || `Strategy: ${sc.p3a}/5.0  ·  LP quality: ${sc.p3b}/5.0  ·  IC process: ${sc.p3c}/5.0  ·  Deal sourcing: ${sc.p3d}/5.0`, p3.toFixed(2)],
    ["Legal",            opinions.p4 || `Fund terms: ${sc.p4a}/5.0  ·  LP protections: ${sc.p4b}/5.0`, p4.toFixed(2)],
  ];

  const hdrCell=(t,w)=>new TableCell({
    borders:allB(RED,4), shading:{fill:RED,type:ShadingType.CLEAR},
    margins:{top:80,bottom:80,left:140,right:140}, width:{size:w,type:WidthType.DXA},
    children:[new Paragraph({children:[r(t,{bold:true,color:WHITE,size:18})],spacing:{before:0,after:0}})]
  });
  const dataCell=(t,w,ri,isScore)=>new TableCell({
    borders:allB(BORDER_CLR,4), shading:{fill:ri%2===1?LIGHT_GRAY:WHITE,type:ShadingType.CLEAR},
    margins:{top:80,bottom:80,left:140,right:140}, width:{size:w,type:WidthType.DXA},
    verticalAlign:VerticalAlign.CENTER,
    children:[new Paragraph({
      children:[r(t,{bold:isScore,color:isScore?RED:DARK,size:18})],
      alignment:isScore?AlignmentType.CENTER:AlignmentType.LEFT,
      spacing:{before:0,after:0}
    })]
  });

  return [
    new Table({
      width:{size:CONTENT_W,type:WidthType.DXA}, columnWidths:cw,
      rows:[
        new TableRow({tableHeader:true, children:["Section","KK39's Opinions","Scoring"].map((h,i)=>hdrCell(h,cw[i]))}),
        ...rows.map((row,i)=>new TableRow({children:[
          dataCell(row[0],cw[0],i,false),
          dataCell(row[1],cw[1],i,false),
          dataCell(row[2],cw[2],i,true),
        ]}))
      ]
    }),
    sp(4),
    new Paragraph({
      children:[
        r("Final Weighted Score: ",{bold:true,size:20}),
        r(`${final.toFixed(2)} — ${verdict}`,{bold:true,size:20,color:RED}),
        r(`   [ (P1 × 1) + (P2 × 2) + (P3 × 2) + (P4 × 1) ] / 6`,{size:16,color:MUTED,italics:true}),
      ],
      spacing:{before:60,after:200}
    })
  ];
}

// ── EXCO block ────────────────────────────────────────────────────────────
function excoBlock() {
  const names=["Goh Yeow Lian","Goh Yew Tee","Goh Cheng Huah"];
  const cw=names.map((_,i)=>i<2?Math.floor(CONTENT_W/3):CONTENT_W-Math.floor(CONTENT_W/3)*2);
  return [
    h2("EXCO Approval"),
    sp(4),
    new Table({
      width:{size:CONTENT_W,type:WidthType.DXA}, columnWidths:cw,
      rows:[new TableRow({children:names.map((name,i)=>new TableCell({
        borders:noAllB(), margins:{top:80,bottom:80,left:0,right:200},
        width:{size:cw[i],type:WidthType.DXA},
        children:[
          new Paragraph({children:[r(" ",{size:20})],spacing:{after:500},
            border:{bottom:{style:BorderStyle.SINGLE,size:4,color:BORDER_CLR}}}),
          new Paragraph({children:[r(name,{bold:true,size:19,color:DARK})],spacing:{after:30}}),
          new Paragraph({children:[r("EXCO Member",{size:17,color:MUTED})],spacing:{after:0}}),
        ]
      }))})]
    }),
    sp(10),
  ];
}

// ── Header & Footer ───────────────────────────────────────────────────────
const makeHeader=()=>new Header({children:[new Paragraph({
  children:[
    r(data.meta.fundName+" Investment Memo",{size:16,color:MUTED}),
    new TextRun({children:["\t",PageNumber.CURRENT],size:16,color:MUTED,font:"Arial"})
  ],
  tabStops:[{type:TabStopType.RIGHT,position:CONTENT_W}],
  border:{bottom:{style:BorderStyle.SINGLE,size:3,color:RED}},
  spacing:{after:80}
})]});

const makeFooter=()=>new Footer({children:[new Paragraph({
  children:[r(data.meta.fundName+"  ·  KK39 Ventures  ·  Confidential",{size:15,color:MUTED})],
  border:{top:{style:BorderStyle.SINGLE,size:3,color:BORDER_CLR}},
  spacing:{before:80}
})]});

// ── Management team photo grid ────────────────────────────────────────────
function mgmtPhotoGrid(images) {
  if(!images||images.length===0) return [];
  // Filter to portrait-ish square images (likely headshots)
  const headshots=images.filter(img=>{
    const ratio=img.h/img.w;
    return ratio>0.7&&ratio<1.5&&img.w>=150;
  });
  if(headshots.length===0) return [];

  const perRow=Math.min(headshots.length,3);
  const cellW=Math.floor(CONTENT_W/perRow);
  const imgW=Math.floor(cellW*0.7);

  const cells=headshots.slice(0,perRow).map(img=>{
    const imgEl=embedImage(img.path, imgW);
    return new TableCell({
      borders:noAllB(),
      margins:{top:60,bottom:60,left:60,right:60},
      width:{size:cellW,type:WidthType.DXA},
      children:imgEl?[imgEl]:[new Paragraph({children:[r("(Photo)",{size:18,color:MUTED,italics:true})]})]
    });
  });

  return [
    new Table({
      width:{size:CONTENT_W,type:WidthType.DXA},
      columnWidths:headshots.slice(0,perRow).map(()=>cellW),
      rows:[new TableRow({children:cells})]
    }),
    sp(8)
  ];
}

// ── Images catalogue from data ────────────────────────────────────────────
const imgs = data.images || [];
const getImgs = (types) => imgs.filter(i=>types.includes(i.type));

// ── Assemble document ─────────────────────────────────────────────────────
const S=data.sections;

// Inline images at right sections
const fundStructureImgs = getImgs(['fund_structure','diagram','chart']);
const portfolioImgs     = getImgs(['portfolio_table','schedule']);
const mgmtImgs          = getImgs(['headshot','management']);
const trackRecordImgs   = getImgs(['performance','track_record']);

const children=[
  ...coverBlock(),

  h1("Executive Summary"),
  ...execSummary(),
  sp(8),
  h2("KK39 Scoring"),
  ...scoringTable(),
  sp(6),
  ...excoBlock(),

  new Paragraph({children:[new PageBreak()],spacing:{after:0}}),

  // 1 — Opportunity
  h1("1   The Opportunity"),
  ...toElements(S.opportunity||""),
  // Embed fund structure / portfolio allocation diagrams
  ...fundStructureImgs.slice(0,2).flatMap(img=>{
    const el=embedImage(img.path,CONTENT_W);
    return el?[el,sp(4)]:[];
  }),
  sp(8),

  // 2 — Management Team
  h1("2   Management Team"),
  ...mgmtPhotoGrid(mgmtImgs),
  ...toElements(S.management||"",[2.5,2,2,1]),
  sp(8),

  // 3 — The Fund
  h1("3   The Fund"),
  ...toElements(S.fund||"",[1.2,2]),
  sp(8),

  // 4 — Track Record
  h1("4   Track Record"),
  ...toElements(S.track_record||""),
  ...trackRecordImgs.slice(0,1).flatMap(img=>{
    const el=embedImage(img.path,CONTENT_W);
    return el?[el,sp(4)]:[];
  }),
  // Portfolio schedule tables (large data tables from PDF)
  ...portfolioImgs.slice(0,2).flatMap(img=>{
    const el=embedImage(img.path,CONTENT_W);
    return el?[el,sp(4)]:[];
  }),
  sp(8),

  // 5 — Value Proposition
  h1("5   Value Proposition"),
  ...toElements(S.value_prop||""),
  sp(8),

  // 6 — Due Diligence
  h1("6   Due Diligence"),
  ...toElements(S.due_diligence||"",[1,1.2,1.5,2.5]),
  sp(8),

  // 7 — Legal
  h1("7   Legal"),
  ...toElements(S.legal||"",[1.2,1,2.5]),
  sp(8),

  // 8 — Final Recommendation
  h1("8   Final Recommendation"),
  ...toElements(S.recommendation||""),
  sp(12),
  ...excoBlock(),
];

const doc=new Document({
  numbering:{config:[{reference:"bullets",levels:[{
    level:0,format:LevelFormat.BULLET,text:"•",alignment:AlignmentType.LEFT,
    style:{paragraph:{indent:{left:360,hanging:200}}}
  }]}]},
  styles:{default:{document:{run:{font:"Arial",size:20,color:DARK}}}},
  sections:[{
    properties:{page:{
      size:{width:PAGE_W,height:16838},
      margin:{top:MARGIN,right:MARGIN,bottom:MARGIN,left:MARGIN}
    }},
    headers:{default:makeHeader()},
    footers:{default:makeFooter()},
    children
  }]
});

Packer.toBuffer(doc).then(buf=>{
  fs.writeFileSync(process.env.IC_OUTPUT_PATH || '/tmp/ic_paper_output.docx',buf);
  console.log('OK');
}).catch(e=>{console.error('ERROR:',e.message);process.exit(1);});
