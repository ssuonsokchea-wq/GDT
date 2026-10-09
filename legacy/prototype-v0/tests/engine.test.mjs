import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require=createRequire(import.meta.url);
const engine=require('../checker.js');
const inspect=(x,mode='general',dict=new Set(engine.STARTER_WORDS),includeUnknown=false)=>engine.analyze(x,{mode,dictionary:dict,includeUnknown});
const sample='សួរស្តី ខ្ញុំសាលារៀនទៅ។ បច្ចប្បន្ន សូមអនុញ្ញាតិ។';
const hits=inspect(sample);
assert.ok(hits.length>=4,`Expected >=4 issues, got ${hits.length}`);
assert.ok(hits.some(i=>i.category==='spelling'&&i.replacement==='សួស្តី'));
assert.ok(hits.some(i=>i.category==='structure'&&i.replacement==='ខ្ញុំទៅសាលារៀន'));
for(const item of hits){assert.equal(sample.slice(item.start,item.end),item.original);assert.ok(item.source);assert.ok(item.confidence);}
assert.equal(inspect('ខ្ញុំទៅសាលារៀន។').length,0);
assert.ok(inspect('ខ្ញុំអត់ដឹង។','formal').some(i=>i.category==='style'));
assert.ok(!inspect('ខ្ញុំអត់ដឹង។','general').some(i=>i.category==='style'));
assert.ok(inspect('គឺគឺ').some(i=>i.category==='grammar'));
const questions=inspect('តើអ្នកសុខសប្បាយទេ។');
assert.ok(questions.some(i=>i.ruleId==='textbook:question-example'&&i.replacement==='?'&&i.source.includes('១០៤')));
assert.ok(inspect('សេចក្តី និងសេចក្ដី').some(i=>i.category==='consistency'));
assert.ok(inspect('\uFFFD').some(i=>i.category==='unicode'));
const d=engine.parseWordList('ក\n"ក៏"\n"ពាក្យ"\n"កម្ពុជា"\n"ភាសា"\n','file.csv');
assert.ok(d.has('ពាក្យ'));assert.ok(d.has('ក៏'));
const j=engine.parseWordList('{"words":["ភាសា","ពាក្យ"]}','dict.json');assert.equal(j.size,2);
// HTML rules do not claim a textbook page unless verified.
assert.ok(!hits.some(i=>/grammar textbook page [0-9]/i.test(i.source)));
console.log(`PASS: ${hits.length} sample issues, accurate spans, grammar suggestion, mode toggle, Unicode and dictionary import.`);
