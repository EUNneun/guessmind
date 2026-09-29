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
 const day=new Date().toISOString().slice(0,10),daily=db.collection('usage').doc(`${uid}_${day}`),question=db.collection('decoy_usage').doc(digest(`${uid}:${day}:${title}:${review.trim()}`));
 await db.runTransaction(async tx=>{const [d,q]=await Promise.all([tx.get(daily),tx.get(question)]);if((d.data()?.count||0)>=30)throw new ApiError(429,'오늘의 오답 생성 횟수를 모두 사용했습니다.');if((q.data()?.count||0)>=4)throw new ApiError(429,'이 문제의 오답은 세 번까지 다시 만들 수 있어요.');tx.set(daily,{count:FieldValue.increment(1),day},{merge:true});tx.set(question,{count:FieldValue.increment(1),day},{merge:true})});
 try{
  const reviewLength=[...review.trim()].length,minimumLength=Math.max(4,Math.floor(reviewLength*0.7)),maximumLength=Math.min(80,Math.max(12,Math.ceil(reviewLength*1.3)));
  const prompt=`영화 제목: ${title}\n출제자가 작성한 정답 한줄평 (${reviewLength}자): ${review}\n각 오답 길이 목표: ${minimumLength}~${maximumLength}자`;
  const instructions=`영화 퀴즈의 오답 한줄평 4개를 한국어로 작성하세요. 정답은 한 사람이 쓴 문장이고 오답은 서로 다른 네 사람이 같은 영화를 보고 남긴 감상처럼 보여야 합니다. 네 문장은 각각 다른 생각, 감정, 관점과 문체·리듬을 가져야 합니다. 다만 각 문장의 길이는 정답 한줄평과 비슷하게 유지하고, 제공된 글자 수 범위에 맞추세요. 짧은 원문을 장문의 평론으로 늘리지 마세요. 정답의 단어를 바꿔 쓰거나 의미가 같은 말을 다시 하거나 정답의 문장 구조·어미를 따라 하지 마세요. 영화와 관계없는 추상적인 격언은 피하세요. 원문이 인용, 밈, 패러디, 농담이면 진지한 평론으로 오해하지 말고, 그 영화에 어울리는 다른 가벼운 농담이나 반응을 만들되 원문의 농담을 반복하거나 같은 인용을 변형하지 마세요. 원문이 담백하면 오답도 자연스러운 일상어로 쓰세요. 구체적인 장면·대사·줄거리 등 제공되지 않은 사실을 지어내거나 스포일러하지 마세요. 각 문장은 80자 이내로 쓰고 번호나 설명 없이 JSON 문자열 배열 하나만 반환하세요.`;
  let response;try{response=await fetch('https://api.openai.com/v1/chat/completions',{method:'POST',headers:{Authorization:`Bearer ${process.env.OPENAI_API_KEY}`,'Content-Type':'application/json'},body:JSON.stringify({model:process.env.OPENAI_MODEL||'gpt-4o-mini',messages:[{role:'system',content:instructions},{role:'user',content:prompt}],temperature:0.8}),signal:AbortSignal.timeout(20000)})}catch{throw new ApiError(502,'오답 생성 서비스에 연결할 수 없습니다.')}
  if(!response.ok)throw new ApiError(502,'오답 생성에 실패했습니다.');const data=await response.json();let decoys;try{decoys=JSON.parse(data.choices[0].message.content.replace(/^```(?:json)?\s*|\s*```$/g,''))}catch{throw new ApiError(502,'오답을 다시 생성해주세요.')}
  const tokens=s=>new Set((s.toLowerCase().replace(/[^\p{L}\p{N}]/gu,'').match(/.{2}/gu)||[]));
  const similarity=(a,b)=>{const x=tokens(a),y=tokens(b);if(!x.size||!y.size)return 0;return [...x].filter(t=>y.has(t)).length/Math.min(x.size,y.size)};
  check(Array.isArray(decoys)&&decoys.length===4&&decoys.every(x=>typeof x==='string'&&!!x.trim()&&x.length<=80&&x.trim()!==review.trim())&&new Set(decoys.map(x=>x.trim())).size===4,'오답을 다시 생성해주세요.');
  check(decoys.every((d,i)=>similarity(d,review)<0.75&&decoys.slice(0,i).every(other=>similarity(d,other)<0.75)),'오답이 서로 너무 비슷해요. 다시 생성해주세요.');
  return {decoys};
 }catch(error){try{await db.runTransaction(async tx=>{const [d,q]=await Promise.all([tx.get(daily),tx.get(question)]);if(d.exists)tx.update(daily,{count:FieldValue.increment(-1)});if(q.exists)tx.update(question,{count:FieldValue.increment(-1)})})}catch(refundError){console.error('오답 생성 횟수 복구 실패',refundError)}throw error}
}
async function dispatch(db,uid,action,payload,origin){
 if(action==='movies')return {movies:catalog};
 if(action==='myQuizzes'){const snap=await db.collection('quizzes').where('ownerUid','==',uid).get();const quizzes=snap.docs.map(doc=>{const q=doc.data();return {code:doc.id,owner:q.owner,movies:q.questions.map(item=>item.movie.title),createdAt:q.createdAt?.toDate?.().toISOString()||null,createdAtSeconds:q.createdAt?.seconds||0}}).sort((a,b)=>b.createdAtSeconds-a.createdAtSeconds).map(({createdAtSeconds,...item})=>item);return {quizzes}}

 if(action==='session'){const name=nick(payload.nickname);check(!!name,'닉네임은 2~12자로 입력해주세요.');await db.collection('profiles').doc(uid).set({nickname:name,updatedAt:FieldValue.serverTimestamp()},{merge:true});return {nickname:name}}
 if(action==='mergeAnonymous'){
  const oldToken=payload.oldToken;check(typeof oldToken==='string'&&oldToken.length<5000,'이전 게스트 인증 정보가 없습니다.');
  let old;try{old=await getAuth().verifyIdToken(oldToken)}catch{throw new ApiError(401,'이전 게스트 세션이 만료됐습니다. 기존 브라우저에서 다시 로그인해 주세요.')}
  if(old.firebase?.sign_in_provider!=='anonymous'||old.uid===uid)throw new ApiError(403,'게스트 계정의 퀴즈만 옮길 수 있습니다.');
  const destination=await getAuth().getUser(uid);if(!destination.providerData.some(p=>p.providerId==='google.com'))throw new ApiError(403,'Google 로그인 후 퀴즈를 옮길 수 있습니다.');
  const source=await db.collection('quizzes').where('ownerUid','==',old.uid).get();
  for(let i=0;i<source.docs.length;i+=400){const batch=db.batch();source.docs.slice(i,i+400).forEach(doc=>batch.update(doc.ref,{ownerUid:uid}));await batch.commit()}
  const previous=await db.collection('profiles').doc(old.uid).get(),current=await db.collection('profiles').doc(uid).get();if(previous.exists&&!current.exists)await db.collection('profiles').doc(uid).set(previous.data());
  return {migrated:source.size};
 }
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
