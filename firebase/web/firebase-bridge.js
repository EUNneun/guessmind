import {initializeApp} from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js';
import {getAuth, signInAnonymously, onAuthStateChanged} from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js';
import {getFunctions, httpsCallable} from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-functions.js';
const config={apiKey:'AIzaSyCp6A_cd0dBUw1sOQg3kbWXFPVzBxaOKXs',authDomain:'guessmind-ed9a4.firebaseapp.com',projectId:'guessmind-ed9a4',storageBucket:'guessmind-ed9a4.firebasestorage.app',messagingSenderId:'197789294992',appId:'1:197789294992:web:ba32046c0d50ec9c9ed315'};
try{
 const app=initializeApp(config),auth=getAuth(app),call=httpsCallable(getFunctions(app,'asia-northeast3'),'guessmindApi');
 const user=await new Promise((resolve,reject)=>{const unsub=onAuthStateChanged(auth,u=>{unsub();u?resolve(u):signInAnonymously(auth).then(result=>resolve(result.user),reject)},reject)});
 if(!user)throw Error('익명 인증에 실패했습니다.');
 window.resolveFirebaseBridge(async(path,options={})=>{
  const body=options.body?JSON.parse(options.body):{};let action,payload;
  if(path==='/config')return {kakaoKey:''};
  if(path==='/session'){action='session';payload=body}
  else if(path==='/movies'){action='movies';payload={}}
  else if(path==='/decoys'){action='decoys';payload=body}
  else if(path==='/quizzes'&&options.method==='POST'){action='create';payload=body}
  else {const match=path.match(/^\/quizzes\/([\w-]+)(?:\/(attempts|ranking))?$/);if(!match)throw Error('요청을 찾을 수 없습니다.');action=match[2]==='attempts'?'attempt':match[2]==='ranking'?'ranking':'quiz';payload={code:match[1],...body}}
  try{return (await call({action,payload})).data}catch(e){throw Error(e.message||'연결에 실패했습니다.')}
 });
}catch(e){window.rejectFirebaseBridge(e)}
