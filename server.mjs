import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { randomBytes, createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

const port=Number(process.env.PORT||4173), origin=process.env.PUBLIC_ORIGIN||`http://localhost:${port}`;
const movieCatalog=JSON.parse(await readFile(new URL('./movies.json',import.meta.url),'utf8')).map((title,index)=>({id:index+1,title}));
await mkdir('data',{recursive:true});
const db=new DatabaseSync('data/guessmind.sqlite');
db.exec(`PRAGMA journal_mode=WAL;
CREATE TABLE IF NOT EXISTS sessions(id TEXT PRIMARY KEY,nickname TEXT NOT NULL,created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS movies(id INTEGER PRIMARY KEY,title TEXT NOT NULL,original_title TEXT,poster_path TEXT,year TEXT,genres TEXT);
CREATE TABLE IF NOT EXISTS quizzes(code TEXT PRIMARY KEY,owner_session TEXT NOT NULL,owner_name TEXT NOT NULL,created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS questions(id INTEGER PRIMARY KEY AUTOINCREMENT,code TEXT NOT NULL,position INTEGER NOT NULL,movie_id INTEGER NOT NULL,rating INTEGER NOT NULL,review TEXT NOT NULL,decoys TEXT NOT NULL,UNIQUE(code,position));
CREATE TABLE IF NOT EXISTS attempts(id INTEGER PRIMARY KEY AUTOINCREMENT,code TEXT NOT NULL,session_id TEXT NOT NULL,nickname TEXT NOT NULL,score INTEGER NOT NULL,title TEXT NOT NULL,created_at TEXT DEFAULT CURRENT_TIMESTAMP,UNIQUE(code,session_id));`);
const json=(res,status,data)=>{res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store'});res.end(JSON.stringify(data))};
const fail=(status,message)=>Object.assign(new Error(message),{status});
const nick=v=>typeof v==='string'&&Array.from(v.trim()).length>=2&&Array.from(v.trim()).length<=12?v.trim():null;
const hash=v=>createHash('sha256').update(v).digest('hex');
const cookies=req=>Object.fromEntries((req.headers.cookie||'').split(';').map(x=>x.trim().split('=').map(decodeURIComponent)).filter(x=>x.length===2));
const session=req=>{const token=cookies(req).gm_session;return token&&db.prepare('SELECT * FROM sessions WHERE id=?').get(hash(token))};
const requireSession=req=>session(req)||(()=>{throw fail(401,'닉네임을 입력해주세요.')})();
async function body(req){let chunks=[],size=0;for await(const chunk of req){size+=chunk.length;if(size>100_000)throw fail(413,'입력 크기가 너무 큽니다.');chunks.push(chunk)}try{return JSON.parse(Buffer.concat(chunks).toString()||'{}')}catch{throw fail(400,'요청 형식이 올바르지 않습니다.')}}
const scoreRating=(actual,guess)=>[100,70,40,10][Math.abs(actual-guess)]||0;
const titleFor=score=>score>=85?'취향을 꿰뚫어 본 사이':score>=65?'꽤 오래 본 사이':score>=40?'이제 알아가는 사이':'새롭게 알아갈 사이';
const shuffle=a=>a.map(x=>({x,r:Math.random()})).sort((a,b)=>a.r-b.r).map(y=>y.x);
async function api(req,res,url){
 const method=req.method, path=url.pathname;
 if(path==='/api/config'&&method==='GET')return json(res,200,{kakaoKey:process.env.KAKAO_JS_KEY||'',origin});
 if(path==='/api/session'&&method==='GET')return json(res,200,{nickname:session(req)?.nickname||null});
 if(path==='/api/session'&&method==='POST'){
  const name=nick((await body(req)).nickname);if(!name)throw fail(400,'닉네임은 2~12자로 입력해주세요.');
  const token=randomBytes(32).toString('hex');db.prepare('INSERT INTO sessions(id,nickname) VALUES(?,?)').run(hash(token),name);
  res.setHeader('Set-Cookie',`gm_session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000${process.env.NODE_ENV==='production'?'; Secure':''}`);
  return json(res,200,{nickname:name});
 }
 if(path==='/api/movies'&&method==='GET')return json(res,200,{movies:movieCatalog});
 if(path==='/api/decoys'&&method==='POST'){
  requireSession(req);const {title,review}=await body(req);
  if(typeof title!=='string'||typeof review!=='string'||!review.trim()||review.length>200)throw fail(400,'영화와 한줄평을 확인해주세요.');
  if(!process.env.OPENAI_API_KEY)throw fail(503,'OPENAI_API_KEY 설정이 필요합니다.');
  const prompt=`영화: ${title}\n실제 한줄평: ${review}\n서로 다른 오답 한줄평 정확히 4개를 JSON 문자열 배열로 작성하라. 유형은 비슷한 문체의 다른 평가, 같은 관점의 다른 결론, 반대 평가, 다른 취향 관점 순서. 실제 문장을 복사하거나 정답을 포함하지 말고 각각 80자 이내. JSON 배열만 반환.`;
  const response=await fetch('https://api.openai.com/v1/chat/completions',{method:'POST',headers:{Authorization:`Bearer ${process.env.OPENAI_API_KEY}`,'Content-Type':'application/json'},body:JSON.stringify({model:process.env.OPENAI_MODEL||'gpt-4o-mini',messages:[{role:'user',content:prompt}],temperature:0.9}),signal:AbortSignal.timeout(20000)});
  if(!response.ok)throw fail(502,'오답 생성에 실패했습니다.');
  const data=await response.json();let decoys;try{decoys=JSON.parse(data.choices[0].message.content.replace(/^```(?:json)?\s*|\s*```$/g,''))}catch{throw fail(502,'오답 형식이 올바르지 않습니다. 다시 생성해주세요.')}
  if(!Array.isArray(decoys)||decoys.length!==4||decoys.some(d=>typeof d!=='string'||!d.trim()||d.length>80||d.trim()===review.trim())||new Set(decoys.map(x=>x.trim())).size!==4)throw fail(502,'오답 생성 결과를 다시 요청해주세요.');
  return json(res,200,{decoys});
 }
 if(path==='/api/quizzes'&&method==='POST'){
  const owner=requireSession(req),{questions}=await body(req);
  if(!Array.isArray(questions)||questions.length!==3||new Set(questions.map(q=>q.movie?.id)).size!==3)throw fail(400,'서로 다른 영화 3편을 등록해주세요.');
  for(const q of questions)if(!Number.isInteger(q.movie?.id)||movieCatalog.find(m=>m.id===q.movie.id)?.title!==q.movie.title||!Number.isInteger(q.rating)||q.rating<0||q.rating>10||typeof q.review!=='string'||!q.review.trim()||q.review.length>80||!Array.isArray(q.decoys)||q.decoys.length!==4||q.decoys.some(d=>typeof d!=='string'||!d.trim()||d.length>80||d.trim()===q.review.trim())||new Set(q.decoys.map(d=>d.trim())).size!==4)throw fail(400,'문제 내용을 확인해주세요.');
  const code=randomBytes(9).toString('base64url');db.exec('BEGIN');try{
   db.prepare('INSERT INTO quizzes(code,owner_session,owner_name) VALUES(?,?,?)').run(code,owner.id,owner.nickname);
   for(let i=0;i<3;i++){const q=questions[i],m=q.movie;db.prepare('INSERT INTO movies(id,title,original_title,poster_path,year,genres) VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET title=excluded.title,original_title=excluded.original_title,poster_path=excluded.poster_path,year=excluded.year,genres=excluded.genres').run(m.id,m.title,m.original_title||'',m.poster_path||'',m.year||'',JSON.stringify(m.genre_ids||[]));db.prepare('INSERT INTO questions(code,position,movie_id,rating,review,decoys) VALUES(?,?,?,?,?,?)').run(code,i,m.id,q.rating,q.review.trim(),JSON.stringify(q.decoys.map(d=>d.trim())))}db.exec('COMMIT')
  }catch(e){db.exec('ROLLBACK');throw e}return json(res,201,{code,url:`${origin}/quiz/${code}`});
 }
 const match=path.match(/^\/api\/quizzes\/([A-Za-z0-9_-]+)(?:\/(attempts|ranking))?$/);
 if(match){const [,code,part]=match,quiz=db.prepare('SELECT * FROM quizzes WHERE code=?').get(code);if(!quiz)throw fail(404,'퀴즈를 찾을 수 없습니다.');
  if(!part&&method==='GET'){
   const rows=db.prepare('SELECT q.position,m.id,m.title,m.original_title,m.poster_path,m.year,m.genres,q.review,q.decoys FROM questions q JOIN movies m ON m.id=q.movie_id WHERE q.code=? ORDER BY q.position').all(code);
   return json(res,200,{code,owner:quiz.owner_name,questions:rows.map(r=>({movie:{id:r.id,title:r.title,original_title:r.original_title,poster_path:r.poster_path,year:r.year,genres:JSON.parse(r.genres)},choices:shuffle([r.review,...JSON.parse(r.decoys)]).map(text=>({id:hash(code+r.position+text).slice(0,16),text}))}))});
  }
  if(part==='ranking'&&method==='GET')return json(res,200,{ranking:db.prepare('SELECT nickname,score,title FROM attempts WHERE code=? ORDER BY score DESC,created_at ASC LIMIT 20').all(code)});
  if(part==='attempts'&&method==='POST'){
   const challenger=requireSession(req),{answers}=await body(req),rows=db.prepare('SELECT position,rating,review,decoys FROM questions WHERE code=? ORDER BY position').all(code);
   if(rows.length!==3||!Array.isArray(answers)||answers.length!==3)throw fail(400,'세 문제를 모두 풀어주세요.');
   const prior=db.prepare('SELECT score,title FROM attempts WHERE code=? AND session_id=?').get(code,challenger.id);if(prior)throw fail(409,'이미 참여한 퀴즈입니다.');
   let total=0;const details=rows.map((r,i)=>{const a=answers[i];if(!Number.isInteger(a?.rating)||a.rating<0||a.rating>10||typeof a.choiceId!=='string')throw fail(400,'답안을 확인해주세요.');const valid=[r.review,...JSON.parse(r.decoys)].map(t=>hash(code+i+t).slice(0,16));if(!valid.includes(a.choiceId))throw fail(400,'선택지를 확인해주세요.');const ratingPoints=scoreRating(r.rating,a.rating),reviewPoints=a.choiceId===valid[0]?100:0;total+=ratingPoints+reviewPoints;return {ratingPoints,reviewPoints}});
   const score=Math.round(total/6),title=titleFor(score);db.prepare('INSERT INTO attempts(code,session_id,nickname,score,title) VALUES(?,?,?,?,?)').run(code,challenger.id,challenger.nickname,score,title);
   return json(res,201,{score,title,details,nickname:challenger.nickname,ranking:db.prepare('SELECT nickname,score,title FROM attempts WHERE code=? ORDER BY score DESC,created_at ASC LIMIT 20').all(code)});
  }
 }
 throw fail(404,'요청을 찾을 수 없습니다.');
}
const root=resolve('.');const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8'};
createServer(async(req,res)=>{try{const url=new URL(req.url,'http://localhost');if(url.pathname.startsWith('/api/'))return await api(req,res,url);const file=url.pathname.startsWith('/quiz/')?'/index.html':url.pathname==='/'?'/index.html':url.pathname;const pathname=resolve(root,'.'+file);if(file.startsWith('/data/')||file.split('/').some(part=>part.startsWith('.'))||pathname!==root&&!pathname.startsWith(root+sep))throw fail(404,'Not found');const data=await readFile(pathname);res.writeHead(200,{'content-type':mime[extname(pathname)]||'application/octet-stream'});res.end(data)}catch(e){if(req.url?.startsWith('/api/'))json(res,e.status||500,{error:e.status?e.message:'서버 오류가 발생했습니다.'});else {res.writeHead(404);res.end('Not found')}if(!e.status)console.error(e)}}).listen(port,()=>console.log(`GuessMind: http://localhost:${port}`));
