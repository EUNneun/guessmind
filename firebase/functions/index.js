import { initializeApp } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { defineSecret } from 'firebase-functions/params';
import { randomBytes, createHash } from 'node:crypto';
import movieTitles from './movies.json' with { type: 'json' };

initializeApp();
const db=getFirestore();
const openaiKey=defineSecret('OPENAI_API_KEY');
const catalog=movieTitles.map((title,index)=>({id:index+1,title}));
const digest=value=>createHash('sha256').update(value).digest('hex').slice(0,16);
const error=(code,message)=>{throw new HttpsError(code,message)};
const nickname=value=>typeof value==='string'&&[...value.trim()].length>=2&&[...value.trim()].length<=12?value.trim():null;
const ratingPoints=(actual,guess)=>[100,70,40,10][Math.abs(actual-guess)]||0;
const titleFor=score=>score>=85?'취향을 꿰뚫어 본 사이':score>=65?'꽤 오래 본 사이':score>=40?'이제 알아가는 사이':'새롭게 알아갈 사이';
const shuffle=arr=>arr.map(x=>({x,k:Math.random()})).sort((a,b)=>a.k-b.k).map(x=>x.x);
const check=(condition,message)=>{if(!condition)error('invalid-argument',message)};
const validQuestion=q=>Number.isInteger(q?.movie?.id)&&catalog.find(m=>m.id===q.movie.id)?.title===q.movie.title&&Number.isInteger(q.rating)&&q.rating>=0&&q.rating<=10&&typeof q.review==='string'&&!!q.review.trim()&&q.review.length<=80&&Array.isArray(q.decoys)&&q.decoys.length===4&&q.decoys.every(x=>typeof x==='string'&&!!x.trim()&&x.length<=80&&x.trim()!==q.review.trim())&&new Set(q.decoys.map(x=>x.trim())).size===4;
const ordered=async code=>{const snap=await db.collection('quizzes').doc(code).get();if(!snap.exists)error('not-found','퀴즈를 찾을 수 없습니다.');return snap.data()};
const rank=async code=>{const snap=await db.collection('quizzes').doc(code).collection('attempts').orderBy('score','desc').limit(20).get();return snap.docs.map(d=>({nickname:d.data().nickname,score:d.data().score,title:d.data().title}))};

export const guessmindApi=onCall({region:'asia-northeast3',secrets:[openaiKey],maxInstances:10},async request=>{
 if(!request.auth)error('unauthenticated','익명 인증이 필요합니다.');
 const {action,payload={}}=request.data||{},uid=request.auth.uid;
 if(action==='movies')return {movies:catalog};
 if(action==='session'){
  const name=nickname(payload.nickname);check(name,'닉네임은 2~12자로 입력해주세요.');
  await db.collection('profiles').doc(uid).set({nickname:name,updatedAt:FieldValue.serverTimestamp()},{merge:true});return {nickname:name};
 }
 if(action==='decoys'){
  const {title,review}=payload;check(typeof title==='string'&&title.length<=100&&typeof review==='string'&&!!review.trim()&&review.length<=80,'영화와 한줄평을 확인해주세요.');
  const key=openaiKey.value();if(!key)error('failed-precondition','AI 키 설정이 필요합니다.');
  const day=new Date().toISOString().slice(0,10),usage=db.collection('usage').doc(`${uid}_${day}`);
  await db.runTransaction(async transaction=>{const s=await transaction.get(usage);if((s.data()?.count||0)>=10)error('resource-exhausted','오늘의 오답 생성 횟수를 모두 사용했습니다.');transaction.set(usage,{count:FieldValue.increment(1),day},{merge:true})});
  const prompt=`영화: ${title}\n실제 한줄평: ${review}\n실제 문장과 겹치지 않는 오답 한줄평 4개를 JSON 문자열 배열로만 작성하세요. 각각 비슷한 문체의 다른 평가, 같은 관점의 다른 결론, 반대 평가, 다른 취향 관점으로 80자 이내.`;
  let response;try{response=await fetch('https://api.openai.com/v1/chat/completions',{method:'POST',headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json'},body:JSON.stringify({model:'gpt-4o-mini',messages:[{role:'user',content:prompt}],temperature:0.9}),signal:AbortSignal.timeout(20000)})}catch{error('unavailable','오답 생성 서비스에 연결할 수 없습니다.')}
  if(!response.ok)error('unavailable','오답 생성에 실패했습니다.');const data=await response.json();let decoys;try{decoys=JSON.parse(data.choices[0].message.content.replace(/^```(?:json)?\s*|\s*```$/g,''))}catch{error('internal','오답 형식을 확인할 수 없습니다.')}
  check(Array.isArray(decoys)&&decoys.length===4&&decoys.every(x=>typeof x==='string'&&!!x.trim()&&x.length<=80&&x.trim()!==review.trim())&&new Set(decoys.map(x=>x.trim())).size===4,'오답을 다시 생성해주세요.');return {decoys};
 }
 if(action==='create'){
  const questions=payload.questions;check(Array.isArray(questions)&&questions.length===3&&questions.every(validQuestion)&&new Set(questions.map(q=>q.movie.id)).size===3,'서로 다른 영화 세 편의 문제를 완성해주세요.');
  const profile=await db.collection('profiles').doc(uid).get(),owner=profile.data()?.nickname;check(!!owner,'닉네임을 입력해주세요.');
  const code=randomBytes(9).toString('base64url');await db.collection('quizzes').doc(code).create({ownerUid:uid,owner,questions:questions.map(q=>({movie:{id:q.movie.id,title:q.movie.title},rating:q.rating,review:q.review.trim(),decoys:q.decoys.map(d=>d.trim())})),createdAt:FieldValue.serverTimestamp()});return {code,url:`https://eunneun.github.io/guessmind/#quiz/${code}`};
 }
 if(action==='quiz'){
  const {code}=payload;check(typeof code==='string'&&/^[A-Za-z0-9_-]{8,16}$/.test(code),'퀴즈 주소를 확인해주세요.');const q=await ordered(code);
  return {code,owner:q.owner,questions:q.questions.map((item,i)=>({movie:item.movie,choices:shuffle([item.review,...item.decoys]).map(text=>({id:digest(code+i+text),text}))}))};
 }
 if(action==='ranking')return {ranking:await rank(payload.code)};
 if(action==='attempt'){
  const {code,answers}=payload,q=await ordered(code);check(Array.isArray(answers)&&answers.length===3,'세 문제를 모두 풀어주세요.');
  const profile=await db.collection('profiles').doc(uid).get(),name=profile.data()?.nickname;check(!!name,'닉네임을 입력해주세요.');
  let total=0;const details=q.questions.map((item,i)=>{const answer=answers[i];check(Number.isInteger(answer?.rating)&&answer.rating>=0&&answer.rating<=10&&typeof answer.choiceId==='string','답안을 확인해주세요.');const valid=[item.review,...item.decoys].map(t=>digest(code+i+t));check(valid.includes(answer.choiceId),'선택지를 확인해주세요.');const ratingPointsValue=ratingPoints(item.rating,answer.rating),reviewPoints=answer.choiceId===valid[0]?100:0;total+=ratingPointsValue+reviewPoints;return {ratingPoints:ratingPointsValue,reviewPoints}});
  const score=Math.round(total/6),title=titleFor(score),ref=db.collection('quizzes').doc(code).collection('attempts').doc(uid);
  try{await ref.create({nickname:name,score,title,createdAt:FieldValue.serverTimestamp()})}catch(e){if(e.code===6||e.code==='already-exists')error('already-exists','이미 참여한 퀴즈입니다.');throw e}
  return {score,title,details,nickname:name,ranking:await rank(code)};
 }
 error('not-found','요청을 찾을 수 없습니다.');
});
