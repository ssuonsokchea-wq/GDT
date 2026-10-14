/* KhmerProof proof-of-concept checking engine.
   Intentional scope: auditable heuristics, NOT an authoritative Khmer grammar parser.
   Every issue is a suggestion with a source/evidence field. No document leaves the browser. */
(function (root) {
  'use strict';

  const STARTER_WORDS = [
    'ខ្ញុំ','យើង','អ្នក','គាត់','ពួកគេ','គេ','និង','ទៅ','មក','នៅ','គឺ','បាន','មាន','មិន','នឹង','កំពុង',
    'សូម','ឱ្យ','អនុញ្ញាត','ការ','ការងារ','ការសិក្សា','សិក្សា','សាលារៀន','ផ្សារ','ផ្ទះ','ប្រទេស',
    'កម្ពុជា','ខ្មែរ','ភាសា','ភាសាខ្មែរ','អត្ថបទ','ឯកសារ','ព័ត៌មាន','បច្ចុប្បន្ន','សុវត្ថិភាព',
    'ពាក្យ','វេយ្យាករណ៍','សំណេរ','សរសេរ','ន័យ','ច្បាប់','មាត្រា','កិច្ចសន្យា','រដ្ឋាភិបាល',
    'ប្រជាជន','ស្ថាប័ន','ច្បាស់លាស់','ត្រឹមត្រូវ','យល់','ចង់','នេះ','នោះ','ទាំងអស់','សួស្តី',
    'សេចក្ដី','សេចក្តី','ជំនួយ','អាច','នូវ','ដល់','អំពី','សម្រាប់','ប៉ុន្តែ','ព្រោះ','ដោយសារ',
    'របស់','ទទួល','ខុសត្រូវ','ចំពោះ','លើ','ត្រូវ','ធ្វើ','ប្រើ','ការប្រើប្រាស់','កិរិយាសព្ទ',
    'ប្រធាន','ល្បះ','ប្រយោគ','ដូច្នេះ','យ៉ាងដូចម្តេច','ស្រឡាញ់','ស្រលាញ់'
  ];

  const CATEGORIES = {
    spelling: 'អក្ខរាវិរុទ្ធ', grammar: 'វេយ្យាករណ៍', structure: 'រចនាសម្ព័ន្ធល្បះ',
    wording: 'ការប្រើប្រាស់ពាក្យ', style: 'រចនាប័ទ្មសំណេរ',
    punctuation: 'សញ្ញាវណ្ណយុត្ត / ដកឃ្លា', unicode: 'អក្សរយូនីកូដ',
    consistency: 'ភាពស៊ីសង្វាក់នៃពាក្យ', unverified: 'ពាក្យមិនទាន់ផ្ទៀងផ្ទាត់'
  };
  const SEVERITIES = {high:'សំខាន់', medium:'មធ្យម', low:'តិចតួច', suggestion:'សំណើកែលម្អ'};
  const CONFIDENCE = {high:'ខ្ពស់', medium:'មធ្យម', low:'ទាប'};

  // Preliminarily curated typo pairs. NOT misrepresented as confirmed dictionary quotations.
  const TYPO_PAIRS = [
    ['សួរស្តី','សួស្តី'],
    ['ពត៌មាន','ព័ត៌មាន'],
    ['អនុញ្ញាតិ','អនុញ្ញាត'],
    ['បច្ចប្បន្ន','បច្ចុប្បន្ន'],
    ['សុវត្តិភាព','សុវត្ថិភាព'],
    ['ប្រសិទ្ឋភាព','ប្រសិទ្ធភាព'],
    ['ប្រទេសកំពូជា','ប្រទេសកម្ពុជា']
  ];

  const COLLATIONS = [
    {a:'សេចក្តី',b:'សេចក្ដី',message:'អត្ថបទនេះប្រើទម្រង់អក្ខរាវិរុទ្ធពីរបែប។ ប្រសិនបើជាឯកសារផ្លូវការ គួរជ្រើសរើសទម្រង់មួយឱ្យស៊ីសង្វាក់។'},
    {a:'ស្រលាញ់',b:'ស្រឡាញ់',message:'មានការប្រើទម្រង់ពាក្យពីរបែបក្នុងឯកសារតែមួយ។ ពិនិត្យប្រភពយោង និងរក្សាភាពស៊ីសង្វាក់។'},
    {a:'អោយ',b:'ឱ្យ',message:'សំណេរមានទម្រង់ពាក្យពីរបែប។ ពិនិត្យបែបបទដែលអង្គភាពអ្នកប្រើ មុនធ្វើការកែ។'}
  ];

  function allOccurrences(text, needle) {
    const hits = []; let at = 0;
    if (!needle) return hits;
    while ((at = text.indexOf(needle, at)) !== -1) {hits.push(at);at += needle.length;}
    return hits;
  }
  function khmerCount(text) {return Array.from(text).filter(x => /[\u1780-\u17FF]/u.test(x)).length;}
  function dictionarySupport(dictionary, word) {
    return dictionary && dictionary.size >= 1000 && dictionary.has(word);
  }
  function analyze(text, options) {
    options = options || {};
    const mode = options.mode || 'general';
    const dictionary = options.dictionary || new Set(STARTER_WORDS);
    const includeUnknown = Boolean(options.includeUnknown) && dictionary.size >= 1000;
    const findings = [], fingerprints = new Set();
    let idCounter=0;
    function add(start,end,category,severity,confidence,explanation,replacement,ruleId,source) {
      if(start < 0 || end > text.length || start >= end) return;
      const original = text.slice(start,end);
      const key = `${start}:${end}:${ruleId}`;
      if(fingerprints.has(key)) return;
      fingerprints.add(key);
      findings.push({id:`issue-${++idCounter}`,start,end,category,severity,confidence,original,
        replacement:replacement == null ? null : String(replacement),explanation,ruleId,
        source:source || 'Heuristic checking rule written for this prototype; no external rule attribution verified.'});
    }

    for (const [bad,good] of TYPO_PAIRS) {
      for (const at of allOccurrences(text,bad)) {
        const supported = dictionarySupport(dictionary,good);
        const source = supported
          ? `ពាក្យ «${good}» មាននៅក្នុងបញ្ជីពាក្យដែលបានផ្ទុក។ ការផ្ទៀងផ្ទាត់នេះមិនបញ្ជាក់អំពីវេយ្យាករណ៍ ឬបរិបទទេ។`
          : 'Preliminary editorial correction pair (not a verified quotation from Chuon Nath). Review before accepting.';
        add(at,at+bad.length,'spelling','medium',supported?'high':'medium',
          `ពាក្យ «${bad}» អាចជាការវាយ ឬសរសេរមិនត្រឹមត្រូវ។ សូមផ្ទៀងផ្ទាត់មុនជំនួស។`,good,`typo:${bad}`,source);
      }
    }

    // Context-sensitive demonstration only: not generalized as a Khmer syntactic parser.
    const orderExample = 'ខ្ញុំសាលារៀនទៅ';
    for(const at of allOccurrences(text,orderExample)){
      add(at,at+orderExample.length,'structure','medium','medium',
        'លំដាប់ពាក្យក្នុងឧទាហរណ៍នេះមិនសូវធម្មជាតិទេ។ អាចដាក់កិរិយាសព្ទ «ទៅ» មុខទីកន្លែង «សាលារៀន»។',
        'ខ្ញុំទៅសាលារៀន','example:word-order',
        'Demonstration of a manually curated sentence example; not a validated general Khmer sentence parser or a quotation from the textbook.');
    }

    // Double connectors are likely unintentional even when words touch in Khmer.
    for(const m of text.matchAll(/(និង|ដែល|គឺ|សូម)([ \t\u200B]*)(\1)/gu)) {
      const at=m.index;
      add(at,at+m[0].length,'grammar','low','medium',
        'ពាក្យភ្ជាប់ ឬពាក្យបំពេញនេះលេចឡើងជាប់គ្នា។ ប្រសិនបើមិនមែនជាចេតនាសង្កត់ន័យ គួរលុបមួយចេញ។',m[1],
        'grammar:double-function-word','Project-authored repetition heuristic; verify intent and context.');
    }

    // Textbook-grounded *illustrative* question punctuation advice:
    // The user-provided scanned Khmer grammar textbook, PDF p. 104,
    // section 1.2 on interrogative sentences, gives examples with '?' punctuation.
    // This DOES NOT make a question mark compulsory in every writing context.
    for(const m of text.matchAll(/(^|[។៕\n])([ \t]*)(តើ[^\n។?!]{3,160})(។)/gmu)){
      const at=m.index+m[1].length+m[2].length+m[3].length;
      add(at,at+1,'punctuation','suggestion','medium',
        'ល្បះនេះផ្ដើមដោយ «តើ» ប៉ុន្តែបញ្ចប់ដោយ «។»។ ប្រសិនបើវាជាល្បះសំណួរផ្ទាល់ អាចប្រើ «?» ដើម្បីបង្ហាញទម្រង់សំណួរឱ្យច្បាស់។',
        '?','textbook:question-example',
        'សៀវភៅវេយ្យាករណ៍ភាសាខ្មែរ ដែលអ្នកបានផ្ដល់៖ PDF ទំព័រ ១០៤ ផ្នែក ១.២ «ល្បះសំណួរ» (ឧទាហរណ៍មានសញ្ញា ?); នេះជាសំណើរចនាប័ទ្ម មិនមែនវិធានបង្ខំ។');
    }

    // Typographic/punctuation issues with narrowly defined, clear patterns.
    for(const m of text.matchAll(/[ \t]{2,}/gu)) {
      add(m.index,m.index+m[0].length,'punctuation','low','high',
        'មានចន្លោះទទេជាប់គ្នាច្រើន។ ប្រសិនបើមិនមែនជាការតម្រឹមទ្រង់ទ្រាយ គួរប្រើចន្លោះមួយ។',
        ' ','punctuation:spaces','Visible duplicate-space check; formatting may justify multiple spaces.');
    }
    for(const m of text.matchAll(/។{2,}/gu)){
      add(m.index,m.index+m[0].length,'punctuation','low','high',
        'សញ្ញា «។» លេចឡើងជាប់គ្នាច្រើនដង។ ពិនិត្យថាជាការវាយបញ្ចូលដោយចៃដន្យឬទេ។',
        '។','punctuation:periods','Direct punctuation repetition observation; contextual exception possible.');
    }
    for(const m of text.matchAll(/\u200B{2,}/gu)){
      add(m.index,m.index+m[0].length,'unicode','low','medium',
        'មានសញ្ញាបំបែកពាក្យលាក់ (zero-width space) ជាប់គ្នាច្រើន។ មិនចាំបាច់លុប ប្រសិនបើកម្មវិធីផ្សេងតម្រូវ។',
        '\u200B','unicode:zwsp-double','Unicode U+200B repeated in source text.');
    }
    for(const m of text.matchAll(/\uFFFD/gu)){
      add(m.index,m.index+1,'unicode','high','high',
        'តួអក្សរ U+FFFD បង្ហាញថាមានទិន្នន័យអក្សរដែលមិនអាចអានបានត្រឹមត្រូវ។ សូមពិនិត្យឯកសារដើម។',
        null,'unicode:replacement-char','Unicode U+FFFD replacement character observed.');
    }
    for(const m of text.matchAll(/[\u202A-\u202E\u2066-\u2069]/gu)){
      add(m.index,m.index+1,'unicode','medium','high',
        'មានសញ្ញាកំណត់ទិសបង្ហាញអក្សរលាក់។ វាអាចប៉ះពាល់ដល់លំដាប់បង្ហាញនៃអត្ថបទ។',
        null,'unicode:bidi-control','Unicode bidirectional formatting/control character observed.');
    }
    for(const m of text.matchAll(/(^|[\s។៕៖])([\u17B6-\u17C5\u17C6-\u17D3])/gmu)){
      const start=m.index+m[1].length;
      add(start,start+m[2].length,'unicode','medium','medium',
        'សញ្ញាស្រៈ/សញ្ញាអក្សរខ្មែរមួយលេចនៅដើមពាក្យ ឬបន្ទាប់ពីចន្លោះទទេ ដោយគ្មានតួមេឱ្យភ្ជាប់។',
        null,'unicode:leading-mark','Khmer dependent-sign position heuristic; inspect glyph sequence manually.');
    }

    // Formal register alternatives are suggestions, not errors.
    if(mode==='formal'){
      const formal = [
        ['អត់','មិន','ពាក្យនេះមានលក្ខណៈសន្ទនា។ ក្នុងឯកសារផ្លូវការ ពាក្យ «មិន» អាចសមស្របជាង ដោយអាស្រ័យលើបរិបទ។'],
        ['ម៉េច','យ៉ាងដូចម្តេច','ពាក្យសន្ទនានេះអាចប្ដូរទៅជាឃ្លាផ្លូវការជាងមុន ប្រសិនបើន័យស្របគ្នា។'],
        ['ចឹង','ដូច្នេះ','ការសរសេរផ្លូវការអាចប្រើ «ដូច្នេះ» ជំនួសបានក្នុងបរិបទសមស្រប។']
      ];
      for(const [word,replace,explanation] of formal){
        for(const at of allOccurrences(text,word)){
          // This is not a Khmer word-boundary classifier, so possible false matches remain.
          add(at,at+word.length,'style','suggestion','low',explanation,replace,
            `style:formal:${word}`,'Prototype formal-register recommendation; not an authoritative legal-language rule.');
        }
      }
    }

    // Cross-document form consistency: avoid claiming either variant is wrong.
    for(const item of COLLATIONS){
      if(text.includes(item.a) && text.includes(item.b)){
        const at=text.indexOf(item.b);
        add(at,at+item.b.length,'consistency','suggestion','high',item.message,null,
          `consistency:${item.a}:${item.b}`,'Document-internal comparison of two spellings; both may be acceptable.');
      }
    }

    // Long paragraph warning (not proof of a grammar fault); detect only prose-sized chunks.
    const paragraphs = text.split(/\n/);
    let paragraphOffset=0;
    for(const para of paragraphs){
      if(khmerCount(para)>=115 && !/[។៕?!]/u.test(para)){
        const firstNonBlank=para.search(/\S/u);
        const start=paragraphOffset+Math.max(0,firstNonBlank);
        add(start,Math.min(start+Math.min(45,para.length),paragraphOffset+para.length),
          'structure','suggestion','low',
          'កថាខណ្ឌវែងនេះគ្មានសញ្ញាបញ្ចប់ប្រយោគច្បាស់លាស់។ ពិនិត្យថាគួរបំបែកល្បះ ឬបន្ថែមសញ្ញាវណ្ណយុត្តឬទេ។',
          null,'structure:long-paragraph',
          'Project-authored readability heuristic (115+ Khmer characters and no visible sentence stop); not a formal grammatical test.');
      }
      paragraphOffset+=para.length+1;
    }

    if(includeUnknown && text.length<=50000){
      // Conservative lexicon coverage: highlight only long spans with no matching lexicon word.
      // Word segmentation for Khmer needs a validated statistical model; this is an EXPLORATORY fallback.
      const runs=text.matchAll(/[\u1780-\u17B3\u17B6-\u17D3\u17DD]+/gu);
      let flagged=0;
      for(const m of runs){
        if(flagged>=22) break;
        if(m[0].length<6 || m[0].length>65) continue;
        const pieces=heuristicUnknownChunks(m[0],dictionary);
        for(const segment of pieces){
          if(flagged>=22) break;
          if(segment.value.length>=5 && segment.value.length<=35 && !dictionary.has(segment.value)){
            const ix=m.index+segment.offset;
            // Do not flag entire words simply because the historic dictionary lacks modern vocabulary.
            add(ix,ix+segment.value.length,'unverified','suggestion','low',
              'ក្រុមអក្សរនេះមិនត្រូវបានរកឃើញក្នុងបញ្ជីពាក្យដែលបានផ្ទុក។ វាអាចជាពាក្យថ្មី ឈ្មោះផ្ទាល់ខ្លួន ឬលទ្ធផលពីការបំបែកពាក្យមិនត្រឹមត្រូវ។',
              null,'lexicon:unverified',
              `Dictionary membership check (${dictionary.size} loaded entries); NOT proof of misspelling. Segmentation is experimental.`);
            flagged++;
          }
        }
      }
    }

    // Stable order plus priority when two rules overlap; render is allowed to keep best visual mark.
    const priority={high:0,medium:1,low:2,suggestion:3};
    findings.sort((a,b)=>a.start-b.start || priority[a.severity]-priority[b.severity] || b.end-a.end);
    return findings;
  }

  function heuristicUnknownChunks(run, dict){
    // A greedy *illustration*, deliberately not represented as fully fledged Khmer segmentation.
    // Penalizes unknown spans, emits only after whole-word lookups have been tried.
    // Bound word-lookups so large word lists do not cause quadratic setup work.
    const maxWord=35;
    const result=[];let i=0;
    while(i<run.length){
      let matched=0;
      for(let n=Math.min(maxWord,run.length-i);n>0;n--){
        if(dict.has(run.slice(i,i+n))){matched=n;break;}
      }
      if(matched){i+=matched;continue;}
      const st=i; i++;
      while(i<run.length){
        let nextFound=false;
        for(let n=Math.min(maxWord,run.length-i);n>0;n--){
          if(dict.has(run.slice(i,i+n))){nextFound=true;break;}
        }
        if(nextFound) break;
        i++;
      }
      result.push({offset:st,value:run.slice(st,i)});
    }
    return result;
  }

  function parseWordList(raw, filename){
    let parsed=[];
    if((filename||'').toLowerCase().endsWith('.json')){
      try {const data=JSON.parse(raw);parsed=Array.isArray(data)?data:Array.isArray(data.words)?data.words:[];}
      catch(e){throw new Error('ឯកសារ JSON មិនត្រឹមត្រូវ។');}
    } else {
      parsed=raw.replace(/^\uFEFF/,'').split(/\r?\n/u).map(line=>{
        // CSV from Open Institute contains one word per row, sometimes quoted.
        const val=line.trim();
        if(val.startsWith('"')) {const end=val.lastIndexOf('"');return end>0?val.slice(1,end).replace(/""/g,'"'):val;}
        return val.split(/[\t,]/)[0].trim();
      });
    }
    const words=parsed.map(x=>String(x||'').trim()).filter(x=>x && x.length<=95 && /[\u1780-\u17FF]/u.test(x) && !/^word$|^headword$/i.test(x));
    return new Set(words);
  }
  const api={analyze,parseWordList,STARTER_WORDS,CATEGORIES,SEVERITIES,CONFIDENCE,heuristicUnknownChunks};
  if(typeof module!=='undefined' && module.exports) module.exports=api;
  root.KhmerProofEngine=api;
})(typeof window!=='undefined'?window:globalThis);
