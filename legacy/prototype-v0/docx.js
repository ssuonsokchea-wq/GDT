/* Small, dependency-free ZIP/DOCX support for plain-text import and report export.
   DOCX upload extracts paragraphs; complex layout, annotations and formatting are NOT preserved. */
(function(root){
'use strict';
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8');
const WNS='http://schemas.openxmlformats.org/wordprocessingml/2006/main';
function xml(value){return String(value==null?'':value).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&apos;');}
function html(value){return String(value==null?'':value).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');}
function indexZipEOCD(bytes){for(let i=bytes.length-22;i>=Math.max(0,bytes.length-65557);i--)if(read32(bytes,i)===0x06054b50)return i;return -1;}
function read16(bytes,at){return bytes[at]|bytes[at+1]<<8;}
function read32(bytes,at){return (bytes[at]|bytes[at+1]<<8|bytes[at+2]<<16|bytes[at+3]<<24)>>>0;}
async function unzipEntry(zipBytes,name){
  const end=indexZipEOCD(zipBytes);if(end<0) throw new Error('DOCX ZIP invalid: no end record.');
  const total=read16(zipBytes,end+10);let offset=read32(zipBytes,end+16);
  if(total>3000) throw new Error('Document contains too many parts.');
  for(let i=0;i<total;i++){
    if(read32(zipBytes,offset)!==0x02014b50)throw new Error('DOCX central directory invalid.');
    const method=read16(zipBytes,offset+10),size=read32(zipBytes,offset+20),uSize=read32(zipBytes,offset+24);
    const fnLen=read16(zipBytes,offset+28),extraLen=read16(zipBytes,offset+30),commentLen=read16(zipBytes,offset+32);
    const localOffset=read32(zipBytes,offset+42);
    const filename=decoder.decode(zipBytes.slice(offset+46,offset+46+fnLen));
    offset+=46+fnLen+extraLen+commentLen;
    if(filename!==name)continue;
    if(uSize>12_000_000 || size>12_000_000)throw new Error('The document part exceeds the 12 MB safety limit.');
    if(read32(zipBytes,localOffset)!==0x04034b50) throw new Error('DOCX local file header missing.');
    const localNameLen=read16(zipBytes,localOffset+26),localExtraLen=read16(zipBytes,localOffset+28);
    const start=localOffset+30+localNameLen+localExtraLen;
    const payload=zipBytes.slice(start,start+size);
    if(method===0)return payload;
    if(method===8){
      if(typeof DecompressionStream==='undefined')throw new Error('This browser does not support DOCX inflation; please use a modern Chrome, Edge or Firefox browser.');
      const stream=new Blob([payload]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
      const inflated=await new Response(stream).arrayBuffer();
      if(inflated.byteLength>12_000_000)throw new Error('The document exceeds the size limit.');
      return new Uint8Array(inflated);
    }
    throw new Error('Unsupported DOCX compression method.');
  }
  throw new Error('word/document.xml not found. Is this really a DOCX file?');
}
async function readDocx(file){
  if(file.size>24_000_000)throw new Error('Maximum DOCX file size is 24 MB.');
  const bytes=new Uint8Array(await file.arrayBuffer());
  const body=decoder.decode(await unzipEntry(bytes,'word/document.xml'));
  const dom=new DOMParser().parseFromString(body,'application/xml');
  if(dom.getElementsByTagName('parsererror').length)throw new Error('The Word XML is malformed.');
  const paragraphs=dom.getElementsByTagNameNS(WNS,'p'), result=[];
  for(const p of paragraphs){
    let line='';
    const walk=el=>{
      for(const node of el.childNodes){
        if(node.nodeType!==1)continue;
        if(node.namespaceURI===WNS && node.localName==='t') line+=node.textContent;
        else if(node.namespaceURI===WNS && node.localName==='tab')line+='\t';
        else if(node.namespaceURI===WNS && (node.localName==='br'||node.localName==='cr'))line+='\n';
        else walk(node);
      }
    };
    walk(p);result.push(line);
  }
  return result.join('\n');
}
let crcTable=null;
function crc32(bytes){
  if(!crcTable){crcTable=new Uint32Array(256);for(let n=0;n<256;n++){let c=n;for(let k=0;k<8;k++)c=c&1?0xedb88320^(c>>>1):c>>>1;crcTable[n]=c>>>0;}}
  let crc=0xffffffff;for(const b of bytes)crc=crcTable[(crc^b)&255]^(crc>>>8);return (crc^0xffffffff)>>>0;
}
function w16(n){return [n&255,n>>>8&255];}function w32(n){return [n&255,n>>>8&255,n>>>16&255,n>>>24&255];}
function makeZip(files){
  const local=[],central=[];let pos=0;
  for(const [name,data] of Object.entries(files)){
    const n=encoder.encode(name),content=encoder.encode(data),crc=crc32(content);
    const loc=new Uint8Array([
      ...w32(0x04034b50),...w16(20),...w16(0x800),...w16(0),...w16(0),...w16(0),...w32(crc),
      ...w32(content.length),...w32(content.length),...w16(n.length),...w16(0),...n,...content
    ]);
    local.push(loc);
    const cent=new Uint8Array([
      ...w32(0x02014b50),...w16(20),...w16(20),...w16(0x800),...w16(0),...w16(0),...w16(0),...w32(crc),
      ...w32(content.length),...w32(content.length),...w16(n.length),...w16(0),...w16(0),...w16(0),
      ...w16(0),...w32(0),...w32(pos),...n
    ]);
    central.push(cent);pos+=loc.length;
  }
  const centralStart=pos;
  const centSize=central.reduce((n,b)=>n+b.length,0);
  const eocd=new Uint8Array([
    ...w32(0x06054b50),...w16(0),...w16(0),...w16(central.length),...w16(central.length),
    ...w32(centSize),...w32(centralStart),...w16(0)
  ]);
  return new Blob([...local,...central,eocd],{type:'application/vnd.openxmlformats-officedocument.wordprocessingml.document'});
}
function para(text,opts){opts=opts||{};const type=opts.heading?'<w:pPr><w:pStyle w:val="Heading1"/></w:pPr>':'';
  return `<w:p>${type}<w:r><w:rPr><w:rFonts w:ascii="Noto Sans Khmer" w:hAnsi="Noto Sans Khmer" w:eastAsia="Noto Sans Khmer"/></w:rPr><w:t xml:space="preserve">${xml(text)}</w:t></w:r></w:p>`;
}
function buildDocx(title,paragraphs){
  const all=[para(title,{heading:true}),...paragraphs.map(v=>para(v.text,{heading:Boolean(v.heading)}))].join('');
  const document=`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="${WNS}"><w:body>${all}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1200" w:right="1100" w:bottom="1200" w:left="1100"/></w:sectPr></w:body></w:document>`;
  return makeZip({
    '[Content_Types].xml':'<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
    '_rels/.rels':'<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
    'word/document.xml':document
  });
}
function buildReportHtml(text,issues,settings){
  settings=settings||{};
  const title='របាយការណ៍ពិនិត្យសំណេរភាសាខ្មែរ';
  const mode=settings.mode==='formal'?'ផ្លូវការ / ច្បាប់':'ទូទៅ';
  const timestamp=new Date().toLocaleString('en-GB');
  const dictionaryMeta=`${settings.dictionaryName||'starter'} (${settings.dictionarySize||0} entries)`;
  const count=(cat)=>issues.filter(x=>x.category===cat).length;
  const headers=issues.map((i,n)=>`<tr><td>${n+1}</td><td>${html(KhmerProofEngine.CATEGORIES[i.category])}</td><td>${html(i.original)}</td><td>${html(i.replacement||'—')}</td><td>${html(i.status||'unresolved')}</td></tr>`).join('');
  const details=issues.map((i,n)=>`<div class="finding">
    <div class="finding-head"><b>ល.រ. ${n+1} · ${html(KhmerProofEngine.CATEGORIES[i.category])}</b><span>${html(i.status||'unresolved')}</span></div>
    <div class="pair"><div><small>អត្ថបទដើម</small><strong>${html(i.original)}</strong></div><div><small>សំណើកែ</small><strong>${html(i.replacement||'ត្រូវពិនិត្យបន្ថែម')}</strong></div></div>
    <p><b>ការពន្យល់៖</b> ${html(i.explanation)}</p>
    <p class="meta"><b>កម្រិត៖</b> ${html(KhmerProofEngine.SEVERITIES[i.severity])} · <b>ភាពប្រាកដ៖</b> ${html(KhmerProofEngine.CONFIDENCE[i.confidence])} · <b>ទីតាំង UTF-16៖</b> ${i.start+1}–${i.end}</p>
    <p class="source"><b>ប្រភព/មូលដ្ឋាន៖</b> ${html(i.source)}</p>
    </div>`).join('');
  return `<!doctype html><html lang="km"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><style>
    @page{size:A4;margin:18mm 16mm}*{box-sizing:border-box}body{font-family:"Noto Sans Khmer","Khmer OS",Arial,sans-serif;color:#263f38;line-height:1.85;font-size:11px}h1{font-size:23px;color:#065244;margin:0 0 5px;line-height:1.8}h2{color:#065244;font-size:15px;margin:26px 0 12px}.muted{color:#718a81}.meta-head{border-bottom:2px solid #c7e7d8;padding-bottom:15px}.meta-head p{margin:4px 0}.statline{display:flex;gap:20px;flex-wrap:wrap;margin:14px 0}.statline b{font-size:14px;color:#075346}.statline span{color:#758b80;font-size:10px}table{border-collapse:collapse;width:100%;table-layout:fixed;font-size:10px}th,td{border:1px solid #d6e7de;padding:7px 8px;vertical-align:top;overflow-wrap:anywhere}th{background:#e5f4ed;color:#175845;text-align:left}th:nth-child(1){width:40px}th:nth-child(2){width:105px}th:nth-child(5){width:85px}tr{break-inside:avoid}pre{font-family:inherit;background:#f7faf7;border:1px solid #e2eae6;padding:14px;white-space:pre-wrap;overflow-wrap:anywhere}.note{border-left:4px solid #c99448;padding:10px 13px;background:#fff6e7;line-height:1.9}.finding{border:1px solid #d8e7de;border-radius:8px;padding:13px 14px;margin-bottom:12px;break-inside:avoid;background:#fff}.finding-head{display:flex;align-items:center;justify-content:space-between;gap:10px;color:#075744;border-bottom:1px solid #e5eee9;padding-bottom:7px}.finding-head span{font:700 9px Arial,sans-serif;color:#6c8c7c}.pair{display:flex;gap:10px;margin:9px 0}.pair>div{flex:1;min-width:0;background:#f6faf6;border-radius:5px;padding:7px 10px;overflow-wrap:anywhere}.pair small{display:block;font-size:9px;color:#7e9487}.pair strong{display:block;font-size:12px;color:#25493d}.finding p{margin:7px 0;font-size:10px;line-height:1.9}.finding p.meta,.finding p.source{color:#5f7d70;font-size:9px}.endnote{margin-top:12px;color:#809389;font-size:9px}@media screen{body{max-width:920px;margin:30px auto;padding:18px}}@media print{button{display:none}}
  </style></head><body>
    <div class="meta-head"><h1>${title}</h1><p class="muted">KhmerProof · ${html(timestamp)} · របៀប ${html(mode)}</p><p class="muted">បញ្ជីពាក្យ៖ ${html(dictionaryMeta)} · ចំនួនកំណត់ត្រា៖ ${issues.length}</p></div>
    <div class="statline"><div><b>${issues.length}</b><br><span>កំណត់ត្រា</span></div><div><b>${count('spelling')}</b><br><span>អក្ខរាវិរុទ្ធ</span></div><div><b>${count('grammar')+count('structure')}</b><br><span>វេយ្យាករណ៍/ល្បះ</span></div><div><b>${issues.filter(i=>i.status==='accepted').length}</b><br><span>បានទទួលយក</span></div></div>
    <div class="note"><b>សេចក្ដីជូនដំណឹង៖</b> របាយការណ៍នេះជាលទ្ធផលពីវិធានកុំព្យូទ័រដែលមានកម្រិត។ ពាក្យមិនមានក្នុងបញ្ជីពាក្យមិនស្មើនឹងពាក្យខុសទេ។ ការវិភាគន័យនិងវេយ្យាករណ៍ស្មុគស្មាញត្រូវការអ្នកជំនាញពិនិត្យ។ មិនត្រូវយល់ថាការណែនាំទាំងអស់ជាវិធានច្បាប់ ឬវិធានវេយ្យាករណ៍ជាផ្លូវការឡើយ។</div>
    <h2>តារាងសង្ខេបបញ្ហា</h2><table><thead><tr><th>ល.រ.</th><th>ប្រភេទ</th><th>អត្ថបទដើម</th><th>សំណើកែ</th><th>ស្ថានភាព</th></tr></thead><tbody>${headers||'<tr><td colspan="5">គ្មានបញ្ហាដែលវិធានបច្ចុប្បន្នរកឃើញ។</td></tr>'}</tbody></table>
    <h2>ព័ត៌មានលម្អិត និងប្រភពនៃកំណត់ត្រា</h2>${details||'<p>គ្មានកំណត់ត្រាលម្អិត។</p>'}
    <p class="endnote">* ទីតាំងគិតតាមតួអក្សរ UTF-16 ចាប់ពី ១។ កំណត់ត្រាដែលបានទទួលយក/មិនអើពើ ប្រើទីតាំងនៅពេលកត់ត្រា ហើយអាចខុសពីទីតាំងក្នុងអត្ថបទបច្ចុប្បន្នបន្ទាប់ពីមានការកែសម្រួល។</p>
    <h2>អត្ថបទបច្ចុប្បន្នដែលបានពិនិត្យ</h2><pre>${html(text)}</pre>
    <p class="endnote">របាយការណ៍ត្រូវបានបង្កើតក្នុង browser។ សូមផ្ទៀងផ្ទាត់ពាក្យ និងប្រភពមុនប្រើសម្រាប់ការងារផ្លូវការ។</p><button onclick="print()">Print / Save as PDF</button></body></html>`;
}
function buildReportDocx(text,issues,settings){
  const paragraphs=[
    {text:`ថ្ងៃបង្កើត៖ ${new Date().toLocaleString('en-GB')}`},
    {text:`របៀបពិនិត្យ៖ ${settings.mode==='formal'?'ផ្លូវការ / ច្បាប់':'ទូទៅ'} | ចំនួនកំណត់ត្រា៖ ${issues.length} | បញ្ជីពាក្យ៖ ${settings.dictionaryName||'starter'} (${settings.dictionarySize||0})`},
    {text:'សម្គាល់៖ វិធានពិនិត្យនេះមិនមែនជាភស្តុតាងនៃភាពត្រឹមត្រូវទាំងស្រុងនៃវេយ្យាករណ៍ ឬន័យទេ។ ពាក្យមិនមានក្នុងវចនានុក្រមមិនចាំបាច់ជាពាក្យខុស។'},
    {text:'តារាងកំណត់ត្រាបញ្ហា (បង្ហាញជាផ្នែកនីមួយៗ)',heading:true}
  ];
  for(let n=0;n<issues.length;n++){
    const i=issues[n];paragraphs.push({text:`${n+1}. ${KhmerProofEngine.CATEGORIES[i.category]} — ${i.original} (ទីតាំង ${i.start+1}–${i.end})`,heading:true});
    paragraphs.push({text:`សំណើ៖ ${i.replacement||'គ្មានការជំនួសដោយស្វ័យប្រវត្តិ'}`});
    paragraphs.push({text:`មូលហេតុ៖ ${i.explanation}`});
    paragraphs.push({text:`កម្រិត៖ ${KhmerProofEngine.SEVERITIES[i.severity]} | ភាពប្រាកដ៖ ${KhmerProofEngine.CONFIDENCE[i.confidence]} | ស្ថានភាព៖ ${i.status||'unresolved'}`});
    paragraphs.push({text:`ប្រភព/កំណត់ចំណាំ៖ ${i.source}`});
  }
  paragraphs.push({text:'អត្ថបទដើមទាំងស្រុង',heading:true});
  for(const line of text.split('\n'))paragraphs.push({text:line||' '});
  return buildDocx('របាយការណ៍ពិនិត្យសំណេរភាសាខ្មែរ',paragraphs);
}
root.KhmerProofDocs={readDocx,buildDocx,buildReportDocx,buildReportHtml,html,xml};
if(typeof module!=='undefined'&&module.exports) module.exports={buildDocx,makeZip,crc32};
})(typeof window!=='undefined'?window:globalThis);
