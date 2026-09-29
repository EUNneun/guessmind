import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { randomBytes, createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const catalog=JSON.parse(readFileSync(new URL('../movies.json',import.meta.url),'utf8')).map((title,i)=>({id:i+1,title}));
let database;
function services(){
 if(!database){
  if(!process.env.FIREBASE_SERVICE_ACCOUNT_JSON)throw new ApiError(503,'Firebase 서버 인증 정보가 설정되지 않았습니다.');
  if(!getApps().length){let key;try{key=JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON.trim().replace(/^\uFEFF/,''));if(typeof key==='string')key=JSON.parse(key)}catch{throw new ApiError(503,'Firebase 서버 인증 정보가 JSON 형식이 아닙니다.')}
   if(key?.type!=='service_account'||!key?.private_key||!key?.client_email)throw new ApiError(503,'Firebase 웹 앱 설정이 아닌 서비스 계정 JSON 파일이 필요합니다.');
   initializeApp({credential:cert(key)});
  }
  database=getFirestore();
 }
 return {db:database,auth:getAuth()};
}
class ApiError extends Error{constructor(status,message){super(message);this.status=status}}
const check=(condition,message)=>{if(!condition)throw new ApiError(400,message)};
const nick=value=>typeof value==='string'&&[...value.trim()].length>=2&&[...value.trim()].length<=12?value.trim():null;
const digest=value=>createHash('sha256').update(value).digest('hex').slice(0,16);
const points=(a,b)=>[100,70,40,10][Math.abs(a-b)]||0;
const titleFor=score=>score>=85?'취향을 꿰뚫어 본 사이':score>=65?'꽤 오래 본 사이':score>=40?'이제 알아가는 사이':'새롭게 알아갈 사이';
const shuffle=items=>items.map(x=>({x,k:Math.random()})).sort((a,b)=>a.k-b.k).map(x=>x.x);
const validQuestion=q=>Number.isInteger(q?.movie?.id)&&catalog.find(m=>m.id===q.movie.id)?.title===q.movie.title&&Number.isInteger(q.rating)&&q.rating>=0&&q.rating<=10&&typeof q.review==='string'&&!!q.review.trim()&&q.review.length<=80&&Array.isArray(q.decoys)&&q.decoys.length===4&&q.decoys.every(x=>typeof x==='string'&&!!x.trim()&&x.length<=80&&x.trim()!==q.review.trim())&&new Set(q.decoys.map(x=>x.trim())).size===4;
async function quiz(db,code){check(typeof code==='string'&&/^[A-Za-z0-9_-]{8,16}$/.test(code),'퀴즈 주소를 확인해주세요.');const s=await db.collection('quizzes').doc(code).get();if(!s.exists)throw new ApiError(404,'퀴즈를 찾을 수 없습니다.');return s.data()}
async function ranking(db,code){const snap=await db.collection('quizzes').doc(code).collection('attempts').orderBy('score','desc').limit(20).get();return snap.docs.map(d=>({nickname:d.data().nickname,score:d.data().score,title:d.data().title}))}
async function generateDecoys(db,uid,{title,review}){
 check(typeof title==='string'&&title.length<=100&&typeof review==='string'&&!!review.trim()&&review.length<=80,'영화와 한줄평을 확인해주세요.');
 if(!process.env.OPENAI_API_KEY)throw new ApiError(503,'OpenAI 키 설정이 필요합니다.');
 const day=new Date().toISOString().slice(0,10),ref=db.collection('usage').doc(`${uid}_${day}`);
 await db.runTransaction(async tx=>{const s=await tx.get(ref);if((s.data()?.count||0)>=10)throw new ApiError(429,'오늘의 오답 생성 횟수를 모두 사용했습니다.');tx.set(ref,{count:FieldValue.increment(1),day},{merge:true})});
 const prompt=`영화 제목: ${title}\n출제자가 작성한 정답 한줄평: ${review}`;
 const instructions=`영화 퀴즈의 그럴듯한 오답 한줄평 4개를 한국어로 작성하세요. 가장 중요한 기준은 출제자의 실제 한줄평과 가까운 맥락, 유머 감각, 말투입니다. 원문이 대사 인용, 밈, 패러디, 농담, 반어, 말장난이면 이를 진지한 줄거리 평가로 오해하지 마세요. 그런 경우 오답도 짧고 장난스러운 감상이나 다른 말장난처럼 정답 옆에 자연스럽게 놓일 문장으로 만드세요. 인용의 출처를 확실히 알 수 없으면 특정 작품이나 캐릭터를 단정하지 마세요. 원문의 핵심 분위기를 파악한 뒤, 같은 영화를 본 사람이 조금씩 다르게 반응한 것처럼 쓰세요. 정답 문장을 그대로 반복하거나 단어만 바꾼 문장은 피하고, 네 문장이 서로 다른 관점을 조금씩 담게 하세요. 문체와 리듬은 서로 다르게 하되 원문과 비슷한 자연스러운 구어체 수준을 유지하세요. 원문이 짧고 담백하면 오답도 짧고 담백하게, 원문에 없는 장황한 분석·거창한 철학·우주/인간/희망 같은 추상적인 주제·평론가 말투는 쓰지 마세요. 영화의 장면·대사·줄거리 등 제공되지 않은 사실을 지어내거나 스포일러하지 마세요. 각 문장은 80자 이내로 작성하고, 원문과 어휘·의미가 완전히 같은 문장은 피하세요. 번호나 설명 없이 JSON 문자열 배열 하나만 반환하세요.`;
 let response;try{response=await fetch('https://api.openai.com/v1/chat/completions',{method:'POST',headers:{Authorization:`Bearer ${process.env.OPENAI_API_KEY}`,'Content-Type':'application/json'},body:JSON.stringify({model:process.env.OPENAI_MODEL||'gpt-4o-mini',messages:[{role:'system',content:instructions},{role:'user',content:prompt}],temperature:0.65}),signal:AbortSignal.timeout(20000)})}catch{throw new ApiError(502,'오답 생성 서비스에 연결할 수 없습니다.')}
 if(!response.ok)throw new ApiError(502,'오답 생성에 실패했습니다.');const data=await response.json();let decoys;try{decoys=JSON.parse(data.choices[0].message.content.replace(/^```(?:json)?\s*|\s*```$/g,''))}catch{throw new ApiError(502,'오답을 다시 생성해주세요.')}
 check(Array.isArray(decoys)&&decoys.length===4&&decoys.every(x=>typeof x==='string'&&!!x.trim()&&x.length<=80&&x.trim()!==review.trim())&&new Set(decoys.map(x=>x.trim())).size===4,'오답을 다시 생성해주세요.');return {decoys};
}
async function dispatch(db,uid,action,payload,origin){
 if(action==='movies')return {movies:catalog};
 if(action==='session'){const name=nick(payload.nickname);check(!!name,'닉네임은 2~12자로 입력해주세요.');await db.collection('profiles').doc(uid).set({nickname:name,updatedAt:FieldValue.serverTimestamp()},{merge:true});return {nickname:name}}
 if(action==='decoys')return generateDecoys(db,uid,payload);
 if(action==='create'){
  const questions=payload.questions;check(Array.isArray(questions)&&questions.length===3&&questions.every(validQuestion)&&new Set(questions.map(q=>q.movie.id)).size===3,'서로 다른 영화 세 편의 문제를 완성해주세요.');
  const profile=await db.collection('profiles').doc(uid).get(),owner=profile.data()?.nickname;check(!!owner,'닉네임을 입력해주세요.');const code=randomBytes(9).toString('base64url');
  await db.collection('quizzes').doc(code).create({ownerUid:uid,owner,questions:questions.map(q=>({movie:{id:q.movie.id,title:q.movie.title},rating:q.rating,review:q.review.trim(),decoys:q.decoys.map(d=>d.trim())})),createdAt:FieldValue.serverTimestamp()});return {code,url:`${origin}/quiz/${code}`};
 }
 if(action==='quiz'){const {code}=payload,q=await quiz(db,code);return {code,owner:q.owner,questions:q.questions.map((item,i)=>({movie:item.movie,choices:shuffle([item.review,...item.decoys]).map(text=>({id:digest(code+i+text),text}))}))}}
 if(action==='ranking'){await quiz(db,payload.code);return {ranking:await ranking(db,payload.code)}}
 if(action==='attempt'){
  const {code,answers}=payload,q=await quiz(db,code);check(Array.isArray(answers)&&answers.length===3,'세 문제를 모두 풀어주세요.');const profile=await db.collection('profiles').doc(uid).get(),name=profile.data()?.nickname;check(!!name,'닉네임을 입력해주세요.');
  let total=0;const details=q.questions.map((item,i)=>{const answer=answers[i];check(Number.isInteger(answer?.rating)&&answer.rating>=0&&answer.rating<=10&&typeof answer.choiceId==='string','답안을 확인해주세요.');const valid=[item.review,...item.decoys].map(t=>digest(code+i+t));check(valid.includes(answer.choiceId),'선택지를 확인해주세요.');const ratingPoints=points(item.rating,answer.rating),reviewPoints=answer.choiceId===valid[0]?100:0;total+=ratingPoints+reviewPoints;return {ratingPoints,reviewPoints}});
  const score=Math.round(total/6),title=titleFor(score),ref=db.collection('quizzes').doc(code).collection('attempts').doc(uid);try{await ref.create({nickname:name,score,title,createdAt:FieldValue.serverTimestamp()})}catch(e){if(e.code===6||e.code==='already-exists')throw new ApiError(409,'이미 참여한 퀴즈입니다.');throw e}return {score,title,details,nickname:name,ranking:await ranking(db,code)};
 }
 throw new ApiError(404,'요청을 찾을 수 없습니다.');
}
export default async function handler(req,res){
 res.setHeader('Cache-Control','no-store');
 if(req.method!=='POST')return res.status(405).json({error:'POST 요청만 가능합니다.'});
 try{
  const {db,auth}=services(),token=req.headers.authorization?.match(/^Bearer (.+)$/)?.[1];if(!token)throw new ApiError(401,'Firebase 로그인이 필요합니다.');
  let uid;try{uid=(await auth.verifyIdToken(token)).uid}catch{throw new ApiError(401,'로그인이 만료됐습니다. 다시 시도해주세요.')}
  const {action,payload={}}=req.body||{};if(typeof action!=='string'||!payload||typeof payload!=='object')throw new ApiError(400,'요청 형식이 올바르지 않습니다.');
  const origin=`https://${req.headers.host}`;return res.status(200).json(await dispatch(db,uid,action,payload,origin));
 }catch(e){if(!e.status)console.error(e);return res.status(e.status||500).json({error:e.status?e.message:'서버 오류가 발생했습니다.'})}
}
