/* Browser-only KhmerProof prototype. No analytics, server submission or API secrets. */
(function(){
'use strict';
const engine=window.KhmerProofEngine,docs=window.KhmerProofDocs;
const $=id=>document.getElementById(id);
const editor=$('editor'),layer=$('highlightLayer'),issuesContainer=$('issueList');
const state={issues:[],dictionary:new Set(engine.STARTER_WORDS),dictionaryName:'បញ្ជីពាក្យគំរូ',
  primaryCount:0,ignored:new Set(),audit:[],filter:'all',mode:'general'};
const sourceUrl='https://raw.githubusercontent.com/interscript/khmer-dict-spice/main/kh_dictionary_words.csv';
const SAMPLE='សួរស្តី! ខ្ញុំសាលារៀនទៅ។ ខ្ញុំចង់អានពត៌មានអំពីប្រទេសកម្ពុជា។\n\nបច្ចប្បន្ន ខ្ញុំសូមអនុញ្ញាតិឱ្យអ្នកពិនិត្យឯកសារនេះ។ និងនិង សូមពិនិត្យសេចក្តីណែនាំ និងសេចក្ដីស្នើសុំ។';
let debounce=null,toastTimer=null;
function toast(message){const el=$('toast');el.textContent=message;el.classList.add('visible');clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.classList.remove('visible'),3500);}
function kmInt(n){return String(n).replace(/[0-9]/g,x=>'០១២៣៤៥៦៧៨៩'[Number(x)]);}
function displayStatus(){
  $('dictionaryStatus').textContent=`${state.dictionaryName} · ${state.dictionary.size.toLocaleString()} ពាក្យ`;
  $('dictMessage').textContent=state.primaryCount>0
    ? `បានផ្ទុក ${state.primaryCount.toLocaleString()} ធាតុពីបញ្ជីពាក្យបឋម។ ពាក្យទំនើបបន្ថែមត្រូវបានរក្សាទុកដោយឡែក។ បញ្ជីពាក្យមិនបញ្ជាក់បញ្ហាវេយ្យាករណ៍ដោយខ្លួនឯងទេ។`
    : `កំពុងប្រើបញ្ជីពាក្យគំរូ ${state.dictionary.size} ធាតុ។ សូមផ្ទុកបញ្ជីពាក្យពេញលេញពីប្រភពដែលអ្នកទុកចិត្ត។`;
}
function activeIssues(){return state.issues.filter(issue=>!state.ignored.has(key(issue)));}
function key(issue){return `${issue.ruleId}|${issue.start}|${issue.original}`;}
function review(){
  const text=editor.value;
  const all=engine.analyze(text,{mode:state.mode,dictionary:state.dictionary,includeUnknown:$('showUnknown').checked});
  state.issues=all;
  const visible=activeIssues();
  renderHighlights(text,visible);renderIssues(visible);renderStats(visible);
  $('charCount').textContent=`${kmInt(Array.from(text).length)} តួអក្សរ`;
  $('issueTotal').textContent=String(visible.length);
  $('analysisNote').textContent=state.primaryCount>0
    ? 'បានបន្ថែមការផ្ទៀងផ្ទាត់បញ្ជីពាក្យ។ ការវិនិច្ឆ័យវេយ្យាករណ៍ និងអត្ថន័យបរិបទនៅតែមានកម្រិត។'
    : 'បច្ចុប្បន្នប្រើតែវិធានបឋម និងបញ្ជីពាក្យគំរូ។ សូមផ្ទុកបញ្ជីពាក្យពេញលេញដើម្បីបន្ថែមការត្រួតពិនិត្យ។';
}
function renderHighlights(text,issues){
  layer.replaceChildren();let cursor=0;
  const frag=document.createDocumentFragment();
  // One visual mark per span to preserve the mirrored text's UTF-16 offsets.
  for(const issue of issues){
    if(issue.start<cursor)continue;
    frag.appendChild(document.createTextNode(text.slice(cursor,issue.start)));
    const mark=document.createElement('mark');mark.className=`type-${issue.category}`;
    mark.textContent=text.slice(issue.start,issue.end);frag.appendChild(mark);cursor=issue.end;
  }
  frag.appendChild(document.createTextNode(text.slice(cursor)+'\n'));
  layer.appendChild(frag);layer.scrollTop=editor.scrollTop;layer.scrollLeft=editor.scrollLeft;
}
function renderIssues(issues){
  issuesContainer.replaceChildren();
  const selected=issues.filter(i=>state.filter==='all'||(state.filter==='high'?i.severity==='high'||i.severity==='medium':i.severity==='suggestion'||i.severity==='low'));
  if(!selected.length){
    const empty=document.createElement('div');empty.className='empty-state';
    const icon=document.createElement('span');icon.textContent='✓';
    const title=document.createElement('b');title.textContent=issues.length?'គ្មានបញ្ហាក្នុងក្រុមនេះ':'មិនមានបញ្ហាដែលវិធានបច្ចុប្បន្នបានរកឃើញ';
    const desc=document.createElement('p');desc.textContent=issues.length?'សូមជ្រើសក្រុមផ្សេង។':'នេះមិនមែនជាការធានាថាអត្ថបទគ្មានកំហុសទេ។';
    empty.append(icon,title,desc);issuesContainer.appendChild(empty);return;
  }
  for(const issue of selected){
    const card=document.createElement('article');card.className='issue-card';card.tabIndex=0;
    card.setAttribute('aria-label',`${engine.CATEGORIES[issue.category]}: ${issue.original}`);
    const top=document.createElement('div');top.className='issue-top';
    const kind=document.createElement('div');kind.className=`issue-category type-${issue.category}`;kind.textContent=engine.CATEGORIES[issue.category];
    const confidence=document.createElement('div');confidence.className='issue-confidence';confidence.textContent=`${engine.SEVERITIES[issue.severity]} · ${engine.CONFIDENCE[issue.confidence]}`;
    top.append(kind,confidence);
    const word=document.createElement('div');word.className='issue-text';word.textContent=`«${issue.original.replace(/\u200B/g,'⟨ZWSP⟩')}»`;
    const explanation=document.createElement('p');explanation.className='issue-body';explanation.textContent=issue.explanation;
    card.append(top,word,explanation);
    if(issue.replacement!==null){const proposed=document.createElement('span');proposed.className='issue-suggest';proposed.textContent=`សំណើកែ → ${issue.replacement.replace(/\u200B/g,'⟨ZWSP⟩')}`;card.appendChild(proposed);}
    const source=document.createElement('div');source.className='issue-ref';source.textContent=`ប្រភព/មូលដ្ឋាន៖ ${issue.source}`;card.appendChild(source);
    const actions=document.createElement('div');actions.className='issue-actions';
    if(issue.replacement!==null){const apply=document.createElement('button');apply.className='apply-btn';apply.type='button';apply.textContent='✓ ទទួលយក';apply.addEventListener('click',ev=>{ev.stopPropagation();applyIssue(issue);});actions.appendChild(apply);}
    const ignore=document.createElement('button');ignore.className='ignore-btn';ignore.type='button';ignore.textContent='មិនអើពើ';ignore.addEventListener('click',ev=>{ev.stopPropagation();state.ignored.add(key(issue));state.audit.push({...issue,status:'ignored',actionDate:new Date().toISOString()});review();});actions.appendChild(ignore);
    card.appendChild(actions);
    card.addEventListener('click',()=>focusIssue(issue,card));
    card.addEventListener('keydown',ev=>{if(ev.key==='Enter')focusIssue(issue,card);});
    issuesContainer.appendChild(card);
  }
}
function focusIssue(issue,card){
  document.querySelectorAll('.issue-card.active').forEach(x=>x.classList.remove('active'));
  card.classList.add('active');editor.focus();editor.setSelectionRange(issue.start,issue.end);
}
function applyIssue(issue){
  if(editor.value.slice(issue.start,issue.end)!==issue.original){toast('អត្ថបទបានផ្លាស់ប្ដូរ។ សូមពិនិត្យឡើងវិញ។');review();return;}
  state.audit.push({...issue,status:'accepted',actionDate:new Date().toISOString()});
  editor.setRangeText(issue.replacement,issue.start,issue.end,'end');state.ignored.clear();review();toast('បានកែតម្រូវតាមការយល់ព្រមរបស់អ្នក។');
}
function renderStats(issues){
  const counts=kind=>issues.filter(x=>kind.includes(x.category)).length;
  $('statAll').textContent=String(issues.length);
  $('statSpelling').textContent=String(counts(['spelling']));
  $('statGrammar').textContent=String(counts(['grammar','structure']));
  $('statStyle').textContent=String(counts(['wording','style','punctuation','unicode','consistency','unverified']));
}
function filename(ext){const date=new Date().toISOString().slice(0,10);return `KhmerProof_Flagged_Report_${date}.${ext}`;}
function download(blob,name){const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),2500);}
function reportIssues(){return [...activeIssues().map(i=>({...i,status:'unresolved'})),...state.audit];}
function reportSettings(){return {mode:state.mode,dictionaryName:state.dictionaryName,dictionarySize:state.dictionary.size};}
function downloadHtml(){download(new Blob([docs.buildReportHtml(editor.value,reportIssues(),reportSettings())],{type:'text/html;charset=utf-8'}),filename('html'));}
function downloadDocx(){try{download(docs.buildReportDocx(editor.value,reportIssues(),reportSettings()),filename('docx'));}catch(e){toast('មិនអាចបង្កើត DOCX៖ '+e.message);}}
function csvCell(x){return `"${String(x==null?'':x).replace(/"/g,'""')}"`;}
function downloadCsv(){
  const headers=['No','Start_UTF16_1based','End_UTF16_1based','Category','Severity','Confidence','Status','Original','Suggested','Explanation','Source','Rule_ID','Action_Date'];
  const rows=reportIssues().map((i,n)=>[n+1,i.start+1,i.end,engine.CATEGORIES[i.category],engine.SEVERITIES[i.severity],engine.CONFIDENCE[i.confidence],i.status||'unresolved',i.original,i.replacement||'',i.explanation,i.source,i.ruleId,i.actionDate||'']);
  const csv='\uFEFF'+[headers,...rows].map(x=>x.map(csvCell).join(',')).join('\r\n');
  download(new Blob([csv],{type:'text/csv;charset=utf-8'}),filename('csv'));
}
function printPdf(){
  const html=docs.buildReportHtml(editor.value,reportIssues(),reportSettings());
  const blob=new Blob([html],{type:'text/html;charset=utf-8'});
  const url=URL.createObjectURL(blob);
  const windowRef=window.open(url,'_blank');
  if(!windowRef){toast('សូមអនុញ្ញាតបើកផ្ទាំងថ្មី ហើយជ្រើស Print → Save as PDF។');return;}
  windowRef.addEventListener('load',()=>setTimeout(()=>windowRef.print(),450),{once:true});
  setTimeout(()=>URL.revokeObjectURL(url),120000);
  toast('នៅក្នុងផ្ទាំងថ្មី សូមជ្រើស Print → Save as PDF។');
}
function setDocument(text){editor.value=text.slice(0,200000);state.ignored.clear();state.audit=[];review();editor.focus();}
async function uploadTextFile(file){
  if(!file) return;
  try{
    let text;
    if(/\.docx$/i.test(file.name))text=await docs.readDocx(file);
    else if(/\.txt$/i.test(file.name)||file.type.startsWith('text/')){
      if(file.size>10_000_000)throw new Error('TXT limit is 10 MB.');
      text=await file.text();
    } else throw new Error('សូមប្រើ .txt ឬ .docx។');
    if(text.length>200000)toast('ឯកសារវែងពេក។ ប្រើតែ 200,000 តួអក្សរដំបូង។');
    setDocument(text);toast('បានបញ្ចូលឯកសារ។ ប្លង់ DOCX ដើមមិនត្រូវបានរក្សាទុកក្នុង editor ទេ។');
  }catch(e){toast('បញ្ហាការនាំចូល៖ '+e.message);}
}
function saveDictionary(){
  try{
    const data=Array.from(state.dictionary).join('\n');
    if(data.length>4_000_000)return; // avoid localStorage quota exhaustion
    localStorage.setItem('khmerproof-dict-v1',data);
    localStorage.setItem('khmerproof-dict-label',JSON.stringify([state.dictionaryName,state.primaryCount]));
  }catch(e){toast('បញ្ជីពាក្យបានផ្ទុកសម្រាប់ពេលនេះ ប៉ុន្តែមិនអាចរក្សាទុកក្នុង browser បានទេ។');}
}
function restoreDictionary(){
  try{
    const cached=localStorage.getItem('khmerproof-dict-v1');
    if(!cached)return;
    const words=engine.parseWordList(cached,'words.txt');
    if(words.size<20)return;
    state.dictionary=new Set([...engine.STARTER_WORDS,...words]);
    const meta=JSON.parse(localStorage.getItem('khmerproof-dict-label')||'null');
    if(Array.isArray(meta)){state.dictionaryName=meta[0]||'បញ្ជីពាក្យ';state.primaryCount=Number(meta[1])||0;}
  }catch(e){}
}
function useDict(raw,name,isChuon){
  const parsed=engine.parseWordList(raw,name);
  if(parsed.size<5)throw new Error('រកឃើញពាក្យតិចជាង 5។ សូមពិនិត្យទ្រង់ទ្រាយឯកសារ។');
  for(const w of parsed)state.dictionary.add(w);
  if(isChuon){state.primaryCount=parsed.size;state.dictionaryName='Chuon Nath + modern starter';}
  else if(!state.primaryCount)state.dictionaryName='បញ្ជីពាក្យផ្ទាល់ខ្លួន + គំរូ';
  saveDictionary();displayStatus();review();toast(`បានបន្ថែមបញ្ជីពាក្យ ${parsed.size.toLocaleString()} ធាតុ។`);
}
async function fetchDictionary(){
  const b=$('loadRemoteDict');b.disabled=true;b.textContent='កំពុងផ្ទុក...';
  try{
    const ctrl=new AbortController();const t=setTimeout(()=>ctrl.abort(),30000);
    const response=await fetch(sourceUrl,{signal:ctrl.signal,mode:'cors',cache:'no-cache'});
    clearTimeout(t);
    if(!response.ok)throw new Error('HTTP '+response.status);
    const raw=await response.text();
    useDict(raw,'kh_dictionary_words.csv',true);
  }catch(e){toast('មិនអាចទាញយកវចនានុក្រម។ សូមទាញយក CSV ពី GitHub រួចនាំចូលដោយដៃ។ ('+e.message+')');}
  finally{b.disabled=false;b.textContent='↻ ផ្ទុកបញ្ជីពាក្យជួន ណាត (តាមអ៊ីនធឺណិត)';}
}
function init(){
  restoreDictionary();displayStatus();review();
  editor.addEventListener('input',()=>{clearTimeout(debounce);debounce=setTimeout(review,280);});
  editor.addEventListener('scroll',()=>{layer.scrollTop=editor.scrollTop;layer.scrollLeft=editor.scrollLeft;});
  $('reviewBtn').addEventListener('click',()=>{review();toast('ការពិនិត្យបានបញ្ចប់។ សូមជ្រើសបញ្ហានៅខាងស្ដាំ។');});
  $('mode').addEventListener('change',ev=>{state.mode=ev.target.value;state.ignored.clear();review();});
  $('showUnknown').addEventListener('change',()=>{if($('showUnknown').checked&&state.dictionary.size<1000)toast('ការពិនិត្យពាក្យមិនស្គាល់ត្រូវការបញ្ជីពាក្យយ៉ាងតិច 1,000 ធាតុ។');review();});
  $('sampleBtn').addEventListener('click',()=>setDocument(SAMPLE));
  $('clearBtn').addEventListener('click',()=>setDocument(''));
  $('uploadBtn').addEventListener('click',()=>$('textFile').click());
  $('textFile').addEventListener('change',ev=>{uploadTextFile(ev.target.files[0]);ev.target.value='';});
  $('dictUpload').addEventListener('click',()=>$('dictFile').click());
  $('dictFile').addEventListener('change',async ev=>{const file=ev.target.files[0];ev.target.value='';if(!file)return;try{
    if(file.size>12_000_000)throw new Error('Dictionary max 12 MB.');
    useDict(await file.text(),file.name,false);
  }catch(e){toast('មិនអាចផ្ទុកបញ្ជីពាក្យ៖ '+e.message);}});
  $('loadRemoteDict').addEventListener('click',fetchDictionary);
  $('downloadHtml').addEventListener('click',downloadHtml);
  $('downloadDocx').addEventListener('click',downloadDocx);
  $('downloadCsv').addEventListener('click',downloadCsv);
  $('printPdf').addEventListener('click',printPdf);
  $('downloadTxt').addEventListener('click',()=>download(new Blob([editor.value],{type:'text/plain;charset=utf-8'}),`KhmerProof_Reviewed_Text_${new Date().toISOString().slice(0,10)}.txt`));
  for(const btn of document.querySelectorAll('.filter'))btn.addEventListener('click',()=>{
    state.filter=btn.dataset.filter;document.querySelectorAll('.filter').forEach(x=>x.classList.toggle('active',x===btn));renderIssues(activeIssues());
  });
}
init();
})();
