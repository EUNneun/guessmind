import {initializeApp} from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js';
import {getAuth,signInAnonymously,onAuthStateChanged,GoogleAuthProvider,linkWithPopup,signInWithPopup,signOut} from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js';
const config={apiKey:'AIzaSyCp6A_cd0dBUw1sOQg3kbWXFPVzBxaOKXs',authDomain:'guessmind-ed9a4.firebaseapp.com',projectId:'guessmind-ed9a4',storageBucket:'guessmind-ed9a4.firebasestorage.app',messagingSenderId:'197789294992',appId:'1:197789294992:web:ba32046c0d50ec9c9ed315'};
try{
 const auth=getAuth(initializeApp(config));
 await new Promise((resolve,reject)=>{const unsub=onAuthStateChanged(auth,user=>{unsub();user?resolve(user):signInAnonymously(auth).then(resolve,reject)},reject)});
 const request=async(path,options={})=>{
  const body=options.body?JSON.parse(options.body):{};let action,payload;
  if(path==='/config')return {kakaoKey:''};
  if(path==='/session'){action='session';payload=body}
  else if(path==='/movies'){action='movies';payload={}}
  else if(path==='/my-quizzes'){action='myQuizzes';payload={}}
  else if(path==='/merge-anonymous'){action='mergeAnonymous';payload=body}
  else if(path==='/decoys'){action='decoys';payload=body}
  else if(path==='/quizzes'&&options.method==='POST'){action='create';payload=body}
  else{const match=path.match(/^\/quizzes\/([\w-]+)(?:\/(attempts|ranking))?$/);if(!match)throw Error('요청을 찾을 수 없습니다.');action=match[2]==='attempts'?'attempt':match[2]==='ranking'?'ranking':'quiz';payload={code:match[1],...body}}
  const token=await auth.currentUser.getIdToken();const response=await fetch('/api/gateway',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},body:JSON.stringify({action,payload})});const result=await response.json();if(!response.ok)throw Error(result.error||'연결에 실패했습니다.');return result;
 };
 const pendingKey='guessmind-google-merge-v1';let memoryPending='';const readPending=()=>{try{return sessionStorage.getItem(pendingKey)||memoryPending}catch{return memoryPending}};const writePending=value=>{memoryPending=value;try{value?sessionStorage.setItem(pendingKey,value):sessionStorage.removeItem(pendingKey)}catch{}};
 const authState=()=>({isGoogle:!!auth.currentUser?.providerData.some(p=>p.providerId==='google.com'),email:auth.currentUser?.email||'',pendingMerge:!!readPending()});
 const notifyAuth=()=>window.onGuessmindAuthChanged?.(authState());
 async function mergePending(){const oldToken=readPending();if(!oldToken)return {migrated:0};const merged=await request('/merge-anonymous',{method:'POST',body:JSON.stringify({oldToken})});writePending('');notifyAuth();return merged}
 window.getGuessmindAuthState=authState;
 window.googleSignIn=async()=>{
  const user=auth.currentUser,provider=new GoogleAuthProvider();
  if(!user)throw Error('인증을 준비하는 중입니다. 다시 시도해 주세요.');
  if(authState().isGoogle){const result=await mergePending();return {email:auth.currentUser.email,migrated:result.migrated}}
  const pending=readPending();
  if(pending){const signed=await signInWithPopup(auth,provider);notifyAuth();const result=await mergePending();return {email:signed.user.email,migrated:result.migrated}}
  try{const linked=await linkWithPopup(user,provider);notifyAuth();return {email:linked.user.email,migrated:0}}
  catch(error){if(['auth/credential-already-in-use','auth/email-already-in-use','auth/account-exists-with-different-credential'].includes(error.code)){writePending(await user.getIdToken());notifyAuth();return {needsExisting:true}}throw error}
 };
 window.googleSignOut=async()=>{if(authState().pendingMerge)throw Error('게스트 문제 연결을 완료한 뒤 로그아웃해 주세요.');await signOut(auth);await signInAnonymously(auth);notifyAuth()};
 window.resolveFirebaseBridge(request);notifyAuth();
 if(authState().isGoogle&&authState().pendingMerge)mergePending().catch(e=>console.error('게스트 퀴즈 연결 실패',e));
}catch(e){window.rejectFirebaseBridge(e)}
