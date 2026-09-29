import {initializeApp} from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js';
import {getAuth,signInAnonymously,onAuthStateChanged} from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js';
const config={apiKey:'AIzaSyCp6A_cd0dBUw1sOQg3kbWXFPVzBxaOKXs',authDomain:'guessmind-ed9a4.firebaseapp.com',projectId:'guessmind-ed9a4',storageBucket:'guessmind-ed9a4.firebasestorage.app',messagingSenderId:'197789294992',appId:'1:197789294992:web:ba32046c0d50ec9c9ed315'};
try{
 const auth=getAuth(initializeApp(config));
 await new Promise((resolve,reject)=>{const unsub=onAuthStateChanged(auth,user=>{unsub();user?resolve(user):signInAnonymously(auth).then(resolve,reject)},reject)});
 window.resolveFirebaseBridge(async(path,options={})=>{
  const body=options.body?JSON.parse(options.body):{};let action,payload;
  if(path==='/config')return {kakaoKey:''};
  if(path==='/session'){action='session';payload=body}
  else if(path==='/movies'){action='movies';payload={}}
  else if(path==='/decoys'){action='decoys';payload=body}
  else if(path==='/quizzes'&&options.method==='POST'){action='create';payload=body}
  else{const match=path.match(/^\/quizzes\/([\w-]+)(?:\/(attempts|ranking))?$/);if(!match)throw Error('요청을 찾을 수 없습니다.');action=match[2]==='attempts'?'attempt':match[2]==='ranking'?'ranking':'quiz';payload={code:match[1],...body}}
  const token=await auth.currentUser.getIdToken();const response=await fetch('/api/gateway',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},body:JSON.stringify({action,payload})});const result=await response.json();if(!response.ok)throw Error(result.error||'연결에 실패했습니다.');return result;
 });
}catch(e){window.rejectFirebaseBridge(e)}
